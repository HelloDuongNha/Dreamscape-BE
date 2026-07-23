import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { RuleV3GenerationProvider } from '../services/rules/ruleV3GenerationProvider.types';
import { extractRuleV3Candidates } from '../services/rules/ruleV3Extractor.service';
import { RuleV3OllamaProvider } from '../services/rules/providers/ruleV3OllamaProvider.service';
import { RuleV3GeminiProvider } from '../services/rules/providers/ruleV3GeminiProvider.service';
import { buildRuleV3PlanPreview, buildRuleV3PlanPreviewRaw } from '../services/rules/ruleV3PlanPreview.service';
import {
  getRuleV3FullRun,
  getRuleV3SourceSummary,
  startRuleV3FullExtraction
} from '../services/rules/ruleV3FullExtraction.service';
import KnowledgeRuleV3 from '../models/rulesV3/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../models/rulesV3/KnowledgeRuleEvidence';
import AcademicChunk from '../models/AcademicChunk';
import AcademicSource from '../models/AcademicSource';
import SourceContribution from '../models/SourceContribution';
import Dream from '../models/Dream';
import { RULE_V3_SCORING_VERSION, scoreRuleV3 } from '../services/rules/ruleV3Scoring.service';
import {
  assessRuleV3MergeCompatibility,
  buildRuleV3MergeClusters,
  classifyRuleV3Relationship,
  type RuleV3MergeCluster,
} from '../services/rules/ruleV3Relationship.service';
import { classifyRuleV3VerificationKind, requiresAggregateRuleValidation } from '../services/rules/ruleV3DreamApplication.service';
import { generateEmbedding } from '../services/infrastructure/llm.service';
import { reconcileOracleEvidenceGapsForRule } from '../services/oracle/oracleEvidenceGap.service';
import { mergePendingRuleV3Group, RuleV3MergeError } from '../services/rules/ruleV3Merge.service';

export interface RuleV3ControllerDependencies {
  planLoader: (id: string) => Promise<any>;
  planLoaderRaw: (id: string) => Promise<any>;
  providerFactory: (name: 'ollama' | 'gemini', model?: string) => RuleV3GenerationProvider;
  availabilityChecker: () => Promise<{
    defaultProvider: 'ollama' | 'gemini' | null;
    availableProviders: Array<'ollama' | 'gemini'>;
    providerStatuses: Array<{
      provider: 'ollama' | 'gemini';
      configured: boolean;
      available: boolean;
      model: string | null;
      reasonCode: 'not_allowed' | 'not_configured' | 'runtime_unreachable' | 'model_missing' | null;
    }>;
  }>;
  setTimeoutFn: (callback: (...args: any[]) => void, ms: number, ...args: any[]) => any;
  clearTimeoutFn: (id: any) => void;
  timeoutMs: number;
}

export async function checkOllamaAvailability(
  baseUrl: string,
  modelName: string
): Promise<{ available: boolean; reasonCode: 'runtime_unreachable' | 'model_missing' | null }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return { available: false, reasonCode: 'runtime_unreachable' };
    }
    const data = await response.json() as { models?: Array<{ name: string; model?: string }> };
    if (!data || !Array.isArray(data.models)) {
      return { available: false, reasonCode: 'model_missing' };
    }

    const trimmedModelName = modelName.trim();
    const getNormalizedNames = (name: string): string[] => {
      const trimmed = name.trim();
      if (!trimmed.includes(':')) {
        return [trimmed, `${trimmed}:latest`];
      }
      return [trimmed];
    };

    const isMatch = (targetModel: string): boolean => {
      const normTargets = getNormalizedNames(targetModel);
      const normConfigured = getNormalizedNames(trimmedModelName);
      return normTargets.some(t => normConfigured.includes(t));
    };

    const isModelLoaded = data.models.some(m => {
      const matchName = m.name && isMatch(m.name);
      const matchModel = m.model && isMatch(m.model);
      return matchName || matchModel;
    });

    if (isModelLoaded) {
      return { available: true, reasonCode: null };
    } else {
      return { available: false, reasonCode: 'model_missing' };
    }
  } catch {
    return { available: false, reasonCode: 'runtime_unreachable' };
  }
}

export async function getProductionAvailabilityConfig() {
  const allowed = (process.env.RULE_V3_ALLOWED_PREVIEW_PROVIDERS || '')
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);

  const providerStatuses: Array<{
    provider: 'ollama' | 'gemini';
    configured: boolean;
    available: boolean;
    model: string | null;
    reasonCode: 'not_allowed' | 'not_configured' | 'runtime_unreachable' | 'model_missing' | null;
  }> = [];

  const availableProviders: Array<'ollama' | 'gemini'> = [];

  // Gemini evaluation
  const geminiModel = process.env.RULE_V3_GEMINI_MODEL ? process.env.RULE_V3_GEMINI_MODEL.trim() : null;
  const geminiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : null;
  const isGeminiAllowed = allowed.includes('gemini');
  const isGeminiConfigured = isGeminiAllowed && !!geminiModel && !!geminiKey;

  if (!isGeminiAllowed) {
    providerStatuses.push({
      provider: 'gemini',
      configured: false,
      available: false,
      model: geminiModel,
      reasonCode: 'not_allowed'
    });
  } else if (!isGeminiConfigured) {
    providerStatuses.push({
      provider: 'gemini',
      configured: false,
      available: false,
      model: geminiModel,
      reasonCode: 'not_configured'
    });
  } else {
    providerStatuses.push({
      provider: 'gemini',
      configured: true,
      available: true,
      model: geminiModel,
      reasonCode: null
    });
    availableProviders.push('gemini');
  }

  // Ollama evaluation
  const ollamaModel = process.env.RULE_V3_OLLAMA_MODEL ? process.env.RULE_V3_OLLAMA_MODEL.trim() : null;
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ? process.env.OLLAMA_BASE_URL.trim() : null;
  const isOllamaAllowed = allowed.includes('ollama');
  const isOllamaConfigured = isOllamaAllowed && !!ollamaModel && !!ollamaBaseUrl;

  if (!isOllamaAllowed) {
    providerStatuses.push({
      provider: 'ollama',
      configured: false,
      available: false,
      model: ollamaModel,
      reasonCode: 'not_allowed'
    });
  } else if (!isOllamaConfigured) {
    providerStatuses.push({
      provider: 'ollama',
      configured: false,
      available: false,
      model: ollamaModel,
      reasonCode: 'not_configured'
    });
  } else {
    const health = await checkOllamaAvailability(ollamaBaseUrl!, ollamaModel!);
    providerStatuses.push({
      provider: 'ollama',
      configured: true,
      available: health.available,
      model: ollamaModel,
      reasonCode: health.reasonCode
    });
    if (health.available) {
      availableProviders.push('ollama');
    }
  }

  const rawDefault = (process.env.RULE_V3_PROVIDER || '').trim().toLowerCase();
  let defaultProvider: 'ollama' | 'gemini' | null = null;
  if (rawDefault === 'ollama' || rawDefault === 'gemini') {
    defaultProvider = rawDefault;
  }
  if (defaultProvider && !availableProviders.includes(defaultProvider)) {
    defaultProvider = null;
  }

  return {
    defaultProvider,
    availableProviders,
    providerStatuses
  };
}

export function createRuleV3ModerationController(deps: RuleV3ControllerDependencies) {
  const activeDryRuns = new Set<string>();

  const previewRuleV3Plan = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const plan = await deps.planLoader(String(req.params.id));
      const previewGeneration = await deps.availabilityChecker();
      res.status(200).json({ success: true, data: { ...plan, previewGeneration } });
    } catch (err: any) {
      res.status(400).json({
        success: false,
        errorCode: 'plan_unavailable',
        message: 'Không thể tải tài liệu hoặc kế hoạch phân tích.'
      });
    }
  };

  const dryRunRuleV3Extraction = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const moderatorId = String(req.user?._id || '');
    if (activeDryRuns.has(moderatorId)) {
      res.status(429).json({
        success: false,
        errorCode: 'dry_run_already_active',
        message: 'Bạn đang có một lượt chạy thử nghiệm trích xuất đang diễn ra.'
      });
      return;
    }

    activeDryRuns.add(moderatorId);

    const controller = new AbortController();
    const timerId = deps.setTimeoutFn(() => controller.abort(), deps.timeoutMs);

    try {
      const id = String(req.params.id);
      const workUnitId = String(req.params.workUnitId);
      const { provider } = req.body;

      const config = await deps.availabilityChecker();
      const chosenProviderName = provider || config.defaultProvider;

      if (!chosenProviderName) {
        res.status(400).json({
          success: false,
          errorCode: 'provider_unavailable',
          message: 'Không có provider cấu hình sẵn sàng.'
        });
        return;
      }

      if (chosenProviderName !== 'ollama' && chosenProviderName !== 'gemini') {
        res.status(400).json({
          success: false,
          errorCode: 'invalid_provider',
          message: 'Provider không hợp lệ.'
        });
        return;
      }

      const status = config.providerStatuses.find(p => p.provider === chosenProviderName);
      if (!status || !status.available) {
        res.status(400).json({
          success: false,
          errorCode: 'provider_unavailable',
          message: `Dịch vụ ${chosenProviderName} chưa được kích hoạt hoặc không sẵn sàng.`
        });
        return;
      }

      let rawPreview: any;
      try {
        rawPreview = await deps.planLoaderRaw(id);
      } catch (e: any) {
        res.status(400).json({
          success: false,
          errorCode: 'plan_unavailable',
          message: 'Không thể tải tài liệu hoặc kế hoạch phân tích.'
        });
        return;
      }

      let providerInstance: RuleV3GenerationProvider;
      try {
        providerInstance = deps.providerFactory(chosenProviderName);
      } catch (e: any) {
        if (e.message === 'invalid_provider') {
          res.status(400).json({
            success: false,
            errorCode: 'invalid_provider',
            message: 'Cấu hình model Gemini không đúng định dạng.'
          });
          return;
        }
        res.status(400).json({
          success: false,
          errorCode: 'provider_unavailable',
          message: 'Không thể khởi tạo provider.'
        });
        return;
      }

      const readerInput = {
        documentId: String(rawPreview.document._id),
        parserEngine: rawPreview.document.parserEngine || 'unknown',
        documentUpdatedAt: rawPreview.document.updatedAt ? new Date(rawPreview.document.updatedAt).toISOString() : null,
        sectionCount: rawPreview.sections.length,
        readerChunkCount: rawPreview.chunks.length,
      };

      const result = await extractRuleV3Candidates(
        rawPreview.profile,
        rawPreview.extractionPlan,
        rawPreview.evidencePlan,
        rawPreview.hierarchicalPlan,
        readerInput,
        workUnitId,
        providerInstance,
        controller.signal
      );

      res.status(200).json({ success: true, data: result });
    } catch (err: any) {
      let errorCode = 'provider_unavailable';
      let status = 400;
      let message = 'Không thể kết nối dịch vụ hoặc cấu hình không hợp lệ.';

      if (err.message === 'provider_timeout' || err.name === 'AbortError') {
        errorCode = 'provider_timeout';
        status = 504;
        message = 'Yêu cầu trích xuất thử nghiệm quá thời gian chờ (timeout).';
      } else if (err.message === 'provider_schema_invalid') {
        errorCode = 'provider_schema_invalid';
        status = 422;
        message = 'Phản hồi từ mô hình không khớp với cấu trúc schema yêu cầu.';
      } else if (err.message === 'input_too_large') {
        errorCode = 'input_too_large';
        status = 413;
        message = 'Dữ liệu đầu vào quá lớn (vượt quá 50,000 ký tự).';
      } else if (err.message === 'work_unit_not_found') {
        errorCode = 'work_unit_not_found';
        status = 404;
        message = 'Không tìm thấy đơn vị xử lý thông tin được chọn.';
      } else if (err.message === 'invalid_provider') {
        errorCode = 'invalid_provider';
        status = 400;
        message = 'Dịch vụ AI được chọn không hợp lệ hoặc không khả dụng.';
      }

      res.status(status).json({
        success: false,
        errorCode,
        message
      });
    } finally {
      deps.clearTimeoutFn(timerId);
      activeDryRuns.delete(moderatorId);
    }
  };

  return {
    previewRuleV3Plan,
    dryRunRuleV3Extraction
  };
}

// Instantiate default production controller using real services
export const { previewRuleV3Plan, dryRunRuleV3Extraction } = createRuleV3ModerationController({
  planLoader: buildRuleV3PlanPreview,
  planLoaderRaw: buildRuleV3PlanPreviewRaw,
  providerFactory: (name, model) => {
    if (name === 'ollama') return new RuleV3OllamaProvider(model);
    return new RuleV3GeminiProvider(model);
  },
  availabilityChecker: getProductionAvailabilityConfig,
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
  timeoutMs: 180000
});

export const startFullRuleV3Extraction = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const config = await getProductionAvailabilityConfig();
    const providerName = config.defaultProvider;
    if (!providerName || !config.availableProviders.includes(providerName)) {
      res.status(503).json({
        success: false,
        errorCode: 'provider_unavailable',
        message: 'Mô hình trích xuất cục bộ chưa sẵn sàng.'
      });
      return;
    }
    const provider = providerName === 'ollama'
      ? new RuleV3OllamaProvider()
      : new RuleV3GeminiProvider();
    const result = await startRuleV3FullExtraction(String(req.params.id), provider, {
      replaceExisting: req.body?.replaceExisting === true
    });
    res.status(result.status === 'success' ? 200 : 202).json({ success: true, data: result });
  } catch {
    res.status(400).json({
      success: false,
      errorCode: 'plan_unavailable',
      message: 'Không thể bắt đầu phân tích Rule V3 cho tài liệu này.'
    });
  }
};

export const getFullRuleV3ExtractionProgress = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  const run = await getRuleV3FullRun(String(req.params.runId));
  if (!run) {
    res.status(404).json({ success: false, message: 'Không tìm thấy lượt phân tích Rule V3.' });
    return;
  }
  res.status(200).json({ success: true, data: run });
};

export const getRuleV3SourceAnalysisSummary = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const summary = await getRuleV3SourceSummary(String(req.params.id));
    res.status(200).json({ success: true, data: summary });
  } catch {
    res.status(400).json({
      success: false,
      message: 'Không thể tải kết quả phân tích Rule V3 của tài liệu này.'
    });
  }
};

interface RuleV3SourceSummary {
  _id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
}

function cleanSourceMetadataText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toSourceSummary(source: any): RuleV3SourceSummary {
  const metadata = source?.metadata || {};
  return {
    _id: String(source?._id || ''),
    title: cleanSourceMetadataText(source?.title || metadata.title) || 'Tài liệu chưa có tiêu đề',
    authors: (source?.authors?.length ? source.authors : (metadata.authors || []))
      .map((author: unknown) => cleanSourceMetadataText(author))
      .filter(Boolean),
    year: source?.year || metadata.year,
    doi: source?.doi || metadata.doi
  };
}

async function loadRuleV3SourceSummaries(sourceIds: string[]): Promise<Map<string, RuleV3SourceSummary>> {
  const validIds = [...new Set(sourceIds)].filter(id => mongoose.Types.ObjectId.isValid(id));
  const objectIds = validIds.map(id => new mongoose.Types.ObjectId(id));
  const [approved, contributions] = await Promise.all([
    AcademicSource.find({ _id: { $in: objectIds } }).select('title authors year doi metadata').lean(),
    SourceContribution.find({ _id: { $in: objectIds } }).select('title authors year doi metadata').lean()
  ]);
  const summaries = new Map<string, RuleV3SourceSummary>();
  for (const source of [...approved, ...contributions]) summaries.set(String(source._id), toSourceSummary(source));
  return summaries;
}

function shortRuleLabel(rule: any): string {
  const subject = cleanSourceMetadataText(rule.subject);
  const outcome = cleanSourceMetadataText(rule.outcome);
  if (!subject || !outcome) return cleanSourceMetadataText(rule.statement).slice(0, 140);
  const isVietnamese = String(rule.sourceLanguage || '').toLowerCase() === 'vi';
  const relation = isVietnamese
    ? ({
        prediction: 'có thể dự báo', intervention_effect: 'có thể tác động đến', moderation: 'điều chỉnh',
        mediation: 'góp phần trung gian cho', null_finding: 'chưa cho thấy liên hệ với'
      } as Record<string, string>)[rule.claimType] || 'có liên hệ với'
    : ({
        prediction: 'may predict', intervention_effect: 'may affect', moderation: 'moderates',
        mediation: 'may mediate', null_finding: 'shows no established link with'
      } as Record<string, string>)[rule.claimType] || 'is associated with';
  const compact = `${subject} ${relation} ${outcome}`.replace(/\s+/g, ' ').trim();
  return compact.length <= 140 ? compact : `${compact.slice(0, 137).trimEnd()}…`;
}

function buildProbeBlueprint(rule: any) {
  const verificationKind = classifyRuleV3VerificationKind(rule);
  const condition = (rule.conditions || []).filter((item: string) => item.trim()).join('; ');
  const requiresAggregateComparison = requiresAggregateRuleValidation(rule);
  if (requiresAggregateComparison) {
    const subject = cleanSourceMetadataText(rule.subject) || 'chi tiết mục tiêu';
    const outcome = cleanSourceMetadataText(rule.outcome) || 'nhóm so sánh';
    const isNullFinding = rule.claimType === 'null_finding';
    const expectedPattern = cleanSourceMetadataText(rule.statement);
    return {
      verificationKind: 'aggregate_group_comparison',
      verificationMode: 'aggregate_dataset',
      checkable: false,
      conditionSummary: condition || null,
      explanation: 'Kết luận này so sánh tần suất giữa các nhóm và không thể được xác nhận bằng một câu trả lời Có/Không của một người.',
      requiredData: `Với mỗi nhóm trong “${outcome}”, cần ghi: tổng số báo cáo đủ điều kiện, số báo cáo có “${subject}”, tỷ lệ trên tổng số và metadata xác định nhóm. Mọi báo cáo phải dùng cùng một tiêu chuẩn mã hóa; kết quả phải kèm chênh lệch ước lượng và khoảng bất định.`,
      expectedPattern: expectedPattern || `${subject} được đối chiếu giữa ${outcome}.`,
      supportCriterion: isNullFinding
        ? `Phù hợp với kết luận khi phép so sánh đủ công suất vẫn không phát hiện chênh lệch đáng tin cậy về “${subject}” giữa “${outcome}”. Nếu khoảng bất định quá rộng, kết quả chỉ là chưa đủ thông tin—không được tính là xác nhận. `
        : `Phù hợp khi hướng và quy mô chênh lệch quan sát được nhất quán với kết luận: “${expectedPattern}”.`,
      weakeningCriterion: isNullFinding
        ? `Làm yếu kết luận nếu dữ liệu đủ lớn, được mã hóa nhất quán lại cho thấy chênh lệch ổn định và đáng tin cậy về “${subject}” giữa các nhóm.`
        : `Làm yếu kết luận nếu chênh lệch đáng tin cậy đi ngược hướng được nêu, hoặc biến mất khi kiểm soát cùng điều kiện và cách mã hóa.`,
      inconclusiveCriterion: 'Giữ ở trạng thái chưa đủ thông tin khi số ca quá ít, nhãn nhóm không rõ, cách mã hóa không nhất quán hoặc khoảng bất định còn quá rộng.',
      questionDimensions: [
        {
          type: 'dream_feature_confirmation',
          questionPattern: 'Trong giấc mơ này, bạn có thực sự cảm nhận __DREAM_FEATURE__ là một mối đe dọa không?',
          purpose: 'Xác nhận việc hệ thống mã hóa đúng đặc trưng trong lời kể, thay vì tự suy diễn từ khóa.',
          collectedField: `presence:${subject}`
        },
        {
          type: 'comparison_group_context',
          questionPattern: 'Giấc mơ này có thuộc __COMPARISON_CONTEXT__ không?',
          purpose: 'Xác nhận nhóm so sánh của từng quan sát; chỉ hỏi khi metadata thời gian hoặc bối cảnh chưa đủ rõ.',
          collectedField: `comparison_context:${outcome}`
        }
      ],
      feedbackEffect: 'Phản hồi cá nhân không củng cố hay làm yếu kết luận này. Chỉ kết quả tổng hợp đủ nhiều trường hợp mới có thể đối chiếu nó.'
    };
  }
  if (verificationKind === 'none') {
    const observableAnchor = cleanSourceMetadataText(rule.dreamFeatureTags?.[0])
      || cleanSourceMetadataText(rule.subject)
      || 'chi tiết liên quan';
    return {
      verificationKind,
      verificationMode: 'background_only',
      checkable: false,
      conditionSummary: condition || null,
      explanation: 'Quy luật này chỉ cung cấp kiến thức nền. Dữ liệu nguồn chưa nêu điều kiện có thể hỏi người kể để kiểm tra việc áp dụng vào một giấc mơ cụ thể.',
      expectedPattern: cleanSourceMetadataText(rule.statement),
      supportCriterion: 'Câu trả lời cá nhân chỉ xác nhận hệ thống đã nhận diện đúng chi tiết; chưa có tiêu chí từ nguồn để tính nó là một ca ủng hộ kết luận.',
      weakeningCriterion: 'Nếu người kể liên tục bác bỏ chi tiết mà hệ thống đã khớp, điều đó làm yếu cách truy hồi/áp dụng rule—không tự nó bác bỏ kết luận học thuật.',
      inconclusiveCriterion: 'Giữ rule ở vai trò kiến thức nền cho đến khi có điều kiện quan sát được và bằng chứng đủ mạnh để kiểm nghiệm.',
      questionDimensions: [{
        type: 'dream_feature_confirmation',
        questionPattern: 'Trong giấc mơ này, __DREAM_FEATURE__ có đúng là cách bạn nhớ và cảm nhận về tình tiết đó không?',
        purpose: 'Kiểm tra hệ thống có nhận diện đúng chi tiết trong lời kể hay không. Câu trả lời này chưa kiểm chứng được kết luận học thuật.',
        collectedField: `presence:${observableAnchor}`
      }, {
        type: 'dream_reaction_confirmation',
        questionPattern: 'Cảm xúc hoặc hành động của bạn ngay sau __DREAM_FEATURE__ có đúng là __DREAM_REACTION__ không?',
        purpose: 'Kiểm tra vai trò của chi tiết trong chuỗi sự kiện, tách việc nhận đúng hình ảnh khỏi việc hiểu đúng phản ứng của người kể.',
        collectedField: 'presence:dream_reaction'
      }],
      feedbackEffect: 'Phản hồi chỉ giúp xác nhận hệ thống đã nhận diện đúng chi tiết trong giấc mơ; nó không được tính là bằng chứng ủng hộ kết luận học thuật.'
    };
  }
  const descriptions: Record<string, string> = {
    multiple_future_horizons: 'Kiểm tra xem nhiều mốc tương lai trong mơ có tương ứng với nhiều kế hoạch thật đang cùng đòi hỏi sự chú ý hay không.',
    recent_experience_incorporation: 'Kiểm tra xem một chi tiết cụ thể trong mơ có nguồn trải nghiệm gần đây ngoài đời hay không.',
    anticipated_event: 'Kiểm tra xem sự kiện được dự kiến trong mơ có tương ứng với một việc thật đang được chờ đợi hay chuẩn bị hay không.',
    current_stress: 'Kiểm tra xem điều kiện căng thẳng đời thực mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    avoidance_pressure: 'Kiểm tra xem điều kiện né tránh hoặc trì hoãn mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    attachment_support_under_stress: 'Kiểm tra xem nhân vật được tìm tới trong lúc căng thẳng có thật sự từng là một người mang lại cảm giác an toàn hoặc hỗ trợ cho người kể hay không.',
    external_sleep_stimulus: 'Kiểm tra xem kích thích thật trong môi trường ngủ có được ghép vào nội dung giấc mơ hay không.',
    waking_concern_incorporation: 'Kiểm tra xem một chi tiết cụ thể trong giấc mơ có liên quan trực tiếp đến hoạt động hằng ngày hoặc mối bận tâm hiện tại của người kể hay không.',
    weak_association_recombination: 'Kiểm tra xem các mảnh hình ảnh được ghép trong mơ có đến từ những nguồn đời thực riêng biệt gần thời điểm ngủ hay không.',
    implausible_future_scenario: 'Kiểm tra xem kịch bản phi thực tế trong mơ có đang xoay quanh một sự kiện tương lai có thật hay không.',
    waking_prospective_difference: 'Phân biệt việc chuẩn bị có chủ đích khi thức với cách giấc mơ tự do kết hợp lại cùng chất liệu.'
  };
  const questionPatterns: Record<string, string> = {
    multiple_future_horizons: 'Hiện tại, bạn có đang đồng thời chuẩn bị cho __NEAR_TERM_EVENT__ và __LONG_TERM_PLAN__ không?',
    recent_experience_incorporation: 'Trong ba ngày trước giấc mơ, có sự việc thật nào gợi bạn nghĩ tới __DREAM_FEATURE__ không?',
    anticipated_event: 'Trong bảy ngày tới, bạn có __UPCOMING_EVENT__ không?',
    current_stress: 'Hiện tại, bạn có đang chịu __CURRENT_PRESSURE__ không?',
    avoidance_pressure: 'Trong hai tuần gần đây, bạn có đang trì hoãn hoặc né tránh __MATCHED_PROBLEM__ không?',
    attachment_support_under_stress: 'Trước đây, khi gặp khó khăn, __MATCHED_PERSON__ có thường khiến bạn cảm thấy an toàn hơn không?',
    external_sleep_stimulus: 'Trong đêm đó hoặc ngay lúc tỉnh dậy, bạn có nghe hoặc cảm nhận __SLEEP_STIMULUS__ không?',
    waking_concern_incorporation: 'Trong bảy ngày trước giấc mơ, bạn có thường xuyên nghĩ hoặc lo về một việc ngoài đời liên quan trực tiếp đến __DREAM_FEATURE__ không?',
    weak_association_recombination: 'Trong bảy ngày trước giấc mơ, ít nhất hai chi tiết trong __MATCHED_FRAGMENTS__ có được gợi lại từ những sự việc riêng biệt ngoài đời không?',
    implausible_future_scenario: 'Trong bảy ngày tới, bạn có __MATCHED_FUTURE_EVENT__ thật tương ứng với phần hướng tới tương lai trong giấc mơ không?',
    waking_prospective_difference: 'Trong hai mươi bốn giờ trước khi ngủ, bạn có chủ động diễn tập hoặc lập kế hoạch cho __MATCHED_FUTURE_EVENT__ không?'
  };
  const alternateQuestions: Record<string, { type: string; pattern: string; purpose: string; field: string }> = {
    multiple_future_horizons: { type: 'priority_pressure', pattern: 'Trong bảy ngày tới, bạn có một hạn chót cụ thể khiến bạn phải tạm gác __LONG_TERM_PLAN__ không?', purpose: 'Kiểm tra xung đột ưu tiên thay vì chỉ xác nhận hai kế hoạch cùng tồn tại.', field: 'case_applicability:priority_pressure' },
    recent_experience_incorporation: { type: 'recent_direct_exposure', pattern: 'Trong bảy ngày trước giấc mơ, bạn có nhìn thấy, nghe nhắc tới hoặc trực tiếp tiếp xúc với __DREAM_FEATURE__ không?', purpose: 'Tìm nguồn tiếp xúc trực tiếp khi người kể không nhớ một sự việc gợi nhớ cụ thể.', field: 'case_applicability:recent_direct_exposure' },
    anticipated_event: { type: 'preparation_behavior', pattern: 'Trong ba ngày gần đây, bạn có thực hiện một việc chuẩn bị cụ thể cho __UPCOMING_EVENT__ không?', purpose: 'Kiểm tra hành vi chuẩn bị hiện tại thay vì hỏi lại sự kiện có tồn tại hay không.', field: 'case_applicability:preparation_behavior' },
    current_stress: { type: 'stress_impact', pattern: 'Trong bảy ngày gần đây, __CURRENT_PRESSURE__ có làm bạn khó tập trung hoặc khó thư giãn trước khi ngủ không?', purpose: 'Kiểm tra ảnh hưởng cụ thể của áp lực thay vì lặp lại câu hỏi có căng thẳng hay không.', field: 'case_applicability:stress_impact' },
    avoidance_pressure: { type: 'approaching_consequence', pattern: 'Trong bảy ngày tới, __MATCHED_PROBLEM__ có một hậu quả hoặc hạn chót mà bạn không thể tiếp tục trì hoãn không?', purpose: 'Kiểm tra áp lực đang tiến gần, khác với việc chỉ xác nhận hành vi né tránh.', field: 'case_applicability:approaching_consequence' },
    attachment_support_under_stress: { type: 'recent_support_seeking', pattern: 'Trong lần gần nhất bạn gặp khó khăn, bạn có nghĩ tới hoặc muốn liên hệ __MATCHED_PERSON__ không?', purpose: 'Kiểm tra hành vi tìm hỗ trợ gần đây thay vì chỉ hỏi về vai trò trong quá khứ.', field: 'case_applicability:recent_support_seeking' },
    external_sleep_stimulus: { type: 'sleep_environment_context', pattern: 'Trong đêm đó, phòng ngủ có tiếng ồn, ánh sáng, nhiệt độ hoặc cảm giác cơ thể bất thường nào gần với __SLEEP_STIMULUS__ không?', purpose: 'Kiểm tra toàn bộ bối cảnh ngủ khi người kể không nhớ một âm thanh cụ thể.', field: 'case_applicability:sleep_environment_context' },
    waking_concern_incorporation: { type: 'recent_day_activity', pattern: 'Trong hai mươi bốn giờ trước khi ngủ, bạn có làm một hoạt động cụ thể liên quan tới __DREAM_FEATURE__ không?', purpose: 'Kiểm tra hoạt động gần giờ ngủ, khác với việc hỏi về mối lo lắng lặp lại.', field: 'case_applicability:recent_day_activity' },
    weak_association_recombination: { type: 'creative_problem_preoccupation', pattern: 'Trong ba ngày trước giấc mơ, bạn có chủ động tìm một cách trình bày hoặc giải quyết mới cho __MATCHED_PROBLEM__ không?', purpose: 'Kiểm tra có bài toán sáng tạo khi thức hay không, khác với việc xác định nguồn của các mảnh hình ảnh.', field: 'case_applicability:creative_problem_preoccupation' },
    waking_prospective_difference: { type: 'novel_solution_origin', pattern: 'Trước giấc mơ này, bạn đã từng nghĩ tới __MATCHED_SOLUTION__ khi thức chưa?', purpose: 'Kiểm tra giải pháp đã tồn tại khi thức hay chỉ xuất hiện lần đầu trong chuỗi mơ.', field: 'case_applicability:novel_solution_origin' }
  };
  const alternate = alternateQuestions[verificationKind];
  return {
    verificationKind,
    verificationMode: 'individual_question',
    checkable: true,
    conditionSummary: condition || null,
    applicabilityCheck: descriptions[verificationKind],
    questionPattern: questionPatterns[verificationKind],
    questionDimensions: [{
      type: verificationKind,
      questionPattern: questionPatterns[verificationKind],
      purpose: descriptions[verificationKind],
      collectedField: `case_applicability:${verificationKind}`
    }, ...(alternate ? [{ type: alternate.type, questionPattern: alternate.pattern, purpose: alternate.purpose, collectedField: alternate.field }] : [])],
    expectedPattern: cleanSourceMetadataText(rule.statement),
    supportCriterion: 'Phù hợp trong ca này khi người kể xác nhận đúng điều kiện ngoài đời mà câu hỏi đã nối với chi tiết trong mơ.',
    weakeningCriterion: 'Làm yếu việc áp dụng trong ca này khi người kể phủ nhận điều kiện đó; hệ thống phải loại hướng diễn giải tương ứng.',
    inconclusiveCriterion: 'Giữ chưa xác định khi người kể chọn Chưa biết hoặc câu trả lời không đủ phân biệt; nếu còn căn cứ, hệ thống chuyển sang một chiều hỏi khác.',
    feedbackEffect: 'Mỗi câu trả lời kiểm tra một mắt xích cụ thể: chi tiết trong mơ có thật sự nối với điều kiện ngoài đời mà tài liệu mô tả hay không. Có giữ hướng áp dụng cho ca này; Không loại hướng đó khỏi ca này; Chưa biết giữ trạng thái chưa xác định.'
  };
}

export function buildCompositeProbeBlueprint(rule: any) {
  const components = Array.isArray(rule?.compositeComponents) ? rule.compositeComponents : [];
  if (!rule?.isComposite || components.length < 2) return buildProbeBlueprint(rule);
  const blueprints = components.map((component: any) => ({
    component,
    blueprint: buildProbeBlueprint(component),
  }));
  const questionByPurpose = new Map<string, any>();
  for (const { component, blueprint } of blueprints) {
    for (const question of blueprint.questionDimensions || []) {
      const signature = [question.type, question.questionPattern, question.purpose]
        .map(value => cleanSourceMetadataText(String(value || '')).toLocaleLowerCase('vi'))
        .join('|');
      const existing = questionByPurpose.get(signature);
      if (existing) {
        existing.componentRuleCodes = [...new Set([...(existing.componentRuleCodes || []), component.ruleCode])];
      } else {
        questionByPurpose.set(signature, { ...question, componentRuleCodes: [component.ruleCode] });
      }
    }
  }
  const checkable = blueprints.some(({ blueprint }: any) => blueprint.checkable);
  return {
    verificationKind: 'composite_rule',
    verificationMode: checkable ? 'individual_question' : 'background_only',
    checkable,
    conditionSummary: [...new Set(blueprints.map(({ blueprint }: any) => blueprint.conditionSummary).filter(Boolean))].join('; ') || null,
    explanation: 'Quy luật tổng hợp giữ các mệnh đề nguyên tử và chỉ gộp những câu hỏi kiểm tra cùng một loại dữ kiện.',
    expectedPattern: components.map((component: any) => component.statement).join('\n'),
    supportCriterion: 'Mỗi mệnh đề con chỉ được giữ khi dữ liệu phù hợp với đúng điều kiện và trích dẫn gắn với mệnh đề đó.',
    weakeningCriterion: 'Một câu trả lời chỉ làm yếu mệnh đề con mà nó kiểm tra; không tự động bác bỏ toàn bộ quy luật tổng hợp.',
    inconclusiveCriterion: 'Mệnh đề chưa có dữ liệu phân biệt vẫn giữ trạng thái chưa đủ thông tin, không được suy rộng từ mệnh đề khác.',
    questionDimensions: [...questionByPurpose.values()],
    feedbackEffect: 'Các câu hỏi trùng mục đích được hợp nhất; câu hỏi thu một loại dữ kiện khác vẫn được giữ riêng và liên kết với mệnh đề tương ứng.',
  };
}

function groupEvidenceExcerpts(evidence: any[], chunkMap: Map<string, any>, sourceSummaries: Map<string, RuleV3SourceSummary>) {
  const byOwner = new Map<string, any[]>();
  for (const item of evidence) {
    const key = `${String(item.ruleId)}:${String(item.sourceId)}:${String(item.chunkId)}:${item.stance}`;
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key)!.push(item);
  }

  const groups: any[] = [];
  for (const [ownerKey, items] of byOwner) {
    const sorted = [...items].sort((a, b) => a.startOffset - b.startOffset);
    const clusters: any[][] = [];
    for (const item of sorted) {
      const current = clusters[clusters.length - 1];
      const previousEnd = current?.length ? Math.max(...current.map(entry => entry.endOffset)) : -1;
      if (!current || item.startOffset - previousEnd > 240) clusters.push([item]);
      else current.push(item);
    }
    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const cluster = clusters[clusterIndex];
      const first = cluster[0];
      const chunk: any = chunkMap.get(String(first.chunkId));
      const startOffset = Math.min(...cluster.map(item => item.startOffset));
      const endOffset = Math.max(...cluster.map(item => item.endOffset));
      const chunkText = String(chunk?.text || '');
      const excerpt = chunkText ? chunkText.slice(startOffset, endOffset) : cluster.map(item => item.exactQuote).join(' ');
      const source = sourceSummaries.get(String(first.sourceId));
      groups.push({
        evidenceGroupId: `${ownerKey}:${clusterIndex}`,
        ruleId: String(first.ruleId),
        sourceId: String(first.sourceId),
        sourceTitle: source?.title,
        sourceDoi: source?.doi,
        chunkId: String(first.chunkId),
        stance: first.stance,
        spanCount: cluster.length,
        excerpt,
        pageStart: chunk?.pageStart,
        pageEnd: chunk?.pageEnd,
        sectionTitle: chunk?.sectionTitle,
        sectionType: chunk?.sectionType || chunk?.blockType || 'paragraph'
      });
    }
  }
  return groups;
}

function expandRuleExplanation(component: any, language: string) {
  const vi = String(language || '').toLowerCase().startsWith('vi');
  const subject = cleanSourceMetadataText(component.subject);
  const outcome = cleanSourceMetadataText(component.outcome);
  const statement = cleanSourceMetadataText(component.statement);
  const normalizedTerms = `${subject} ${outcome} ${statement}`.toLocaleLowerCase('en');
  if (/reality simulation|realistic incorporation of waking life/u.test(normalizedTerms)) {
    return vi
      ? 'Tài liệu mô tả giấc mơ như một dạng mô phỏng thực tế. “Mô phỏng giấc mơ” là việc tâm trí dựng nên một cảnh trải nghiệm gồm con người, địa điểm, hành động, cảm giác và vị trí của chính người mơ trong cảnh đó. “Mô phỏng thực tế” có nghĩa cảnh mơ có cấu trúc và được trải nghiệm theo cách phần nào giống nhận thức khi thức; các chủ đề, nhân vật, mối quan tâm hoặc ký ức đời thường có thể được đưa vào rồi kết hợp lại. Khái niệm này không nói rằng sự việc trong mơ đã xảy ra thật, sẽ xảy ra, hay là bản sao nguyên vẹn của đời sống.'
      : 'The source describes dreaming as a form of reality simulation. A “dream simulation” is the mind constructing an experienced scene with people, places, actions, sensations, and the dreamer\'s own position within it. “Reality simulation” means that the scene has an organized, lived-through quality partly resembling waking perception; themes, characters, concerns, or memories from waking life may be incorporated and recombined. It does not mean that the dream events actually happened, will happen, or reproduce waking life exactly.';
  }
  if (/weak associations?/u.test(normalizedTerms)) {
    return vi
      ? 'Tài liệu đề xuất rằng việc kích hoạt các liên kết yếu có thể góp phần vào tư duy sáng tạo. “Liên kết yếu” là mối nối lỏng lẻo giữa những mảnh ký ức hoặc ý tưởng vốn không thường xuất hiện cùng nhau. Khi giấc mơ kết hợp các mảnh xa nhau như vậy, nó có thể tạo ra một chuỗi hình ảnh hoặc cách liên tưởng mới, nên đây được xem là một cơ chế có khả năng hỗ trợ tư duy linh hoạt và phân kỳ. Đây mới là một khả năng giải thích, không chứng minh rằng mọi giấc mơ đều sáng tạo hoặc người có giấc mơ đó chắc chắn sáng tạo hơn.'
      : 'The source proposes that activating weak associations may contribute to creative thinking. “Weak associations” are loose links between memory fragments or ideas that do not usually occur together. When a dream combines such distant elements, it may produce a novel chain of images or associations, which is why this is treated as a possible contributor to flexible and divergent thinking. This is a proposed explanation, not proof that every dream is creative or that the dreamer is necessarily more creative.';
  }
  if (/prospective (?:thought|cognition)/u.test(normalizedTerms)) {
    return vi
      ? 'Tài liệu so sánh giấc mơ với tư duy hướng tới tương lai khi thức nhưng không xem chúng là cùng một quá trình. “Tư duy hướng tới tương lai khi thức” là việc một người chủ động hình dung, lập kế hoạch hoặc chuẩn bị cho một sự việc có thể xảy ra. Giấc mơ cũng có thể lấy chất liệu từ ký ức và mối quan tâm tương lai, nhưng thường kết hợp chúng tự do hơn, ít chịu kiểm soát có chủ đích và có thể tạo thành kịch bản khó xảy ra. Vì vậy hai quá trình có điểm chung về chất liệu nhưng không hoàn toàn giống nhau.'
      : 'The source compares dreaming with waking prospective thought but does not treat them as the same process. “Waking prospective thought” is the deliberate process of imagining, planning, or preparing for a possible future event. Dreams may also draw on memories and future concerns, but often recombine that material more freely, with less deliberate control, and may form implausible scenarios. The two processes can therefore share material without being identical.';
  }
  if (/implausible|unrealistic|impossible/u.test(normalizedTerms)) {
    return vi
      ? 'Tài liệu cho rằng giấc mơ liên quan đến tương lai thường tạo ra những kịch bản khó tin. Đó là các tình huống có bối cảnh, nhân vật hoặc diễn biến khó hay không thể xảy ra trong đời thực, dù một số chi tiết vẫn bắt nguồn từ ký ức và mối quan tâm khi thức. Kết luận này mô tả đặc điểm của nội dung mơ; nó không coi cảnh mơ là dự báo và cũng không tự động cho thấy bất thường tâm lý.'
      : 'The source reports that future-related dreams often form implausible scenarios. These are situations whose setting, characters, or events would be unlikely or impossible in waking life, even though some details may still come from waking memories and concerns. This describes a feature of dream content; it does not treat the dream as a prediction or, by itself, as evidence of psychological abnormality.';
  }
  if (component.claimType === 'association') {
    return vi
      ? `${statement} Cụ thể, tài liệu ghi nhận “${subject}” và “${outcome}” xuất hiện cùng nhau trong phạm vi nghiên cứu được mô tả. Mối liên hệ này giúp xác định điều cần đối chiếu trong lời kể giấc mơ, nhưng chưa chứng minh “${subject}” trực tiếp gây ra “${outcome}”.`
      : `${statement} More specifically, the source reports that “${subject}” and “${outcome}” occur together within the studied scope. This identifies what may be compared with a dream report, but it does not establish that “${subject}” directly causes “${outcome}”.`;
  }
  return vi
    ? `${statement} Tài liệu dùng “${subject}” để mô tả hoặc giải thích “${outcome}”. Đây là phạm vi chính xác của kết luận; không nên suy rộng thành quan hệ nhân quả hay một hiệu ứng đã được đo trực tiếp nếu đoạn nguồn không nêu như vậy.`
    : `${statement} The source uses “${subject}” to describe or explain “${outcome}”. This is the claim's precise scope; it should not be expanded into a causal relationship or a directly measured effect unless the source states one.`;
}

function hasCuratedRuleExplanation(component: any): boolean {
  const normalizedTerms = `${component.subject || ''} ${component.outcome || ''} ${component.statement || ''}`.toLocaleLowerCase('en');
  return /reality simulation|realistic incorporation of waking life|weak associations?|prospective (?:thought|cognition)|implausible|unrealistic|impossible/u.test(normalizedTerms);
}

function componentsAreEvidenceEquivalent(components: any[]): boolean {
  if (components.length < 2) return false;
  const anchor = components[0];
  return components.slice(1).every(component =>
    assessRuleV3MergeCompatibility(anchor, component).reasons.includes('equivalent_subject_and_outcome'));
}

function mapRuleV3Candidate(
  rule: any,
  source: RuleV3SourceSummary | undefined,
  evidence: any[] = [],
  mergeCluster?: RuleV3MergeCluster,
) {
  const mappedStatus = rule.status === 'verified' ? 'approved' : rule.status;
  const components = Array.isArray(rule.compositeComponents) ? rule.compositeComponents : [];
  const componentScores: Array<{ sourceRuleId: string; score: ReturnType<typeof scoreRuleV3> }> = rule.isComposite && components.length > 1
    ? components.map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      score: scoreRuleV3(component, evidence.filter(item => String(item.ruleId) === String(component.sourceRuleId))),
    }))
    : [];
  const baseScore = scoreRuleV3(rule, evidence.filter(item => String(item.ruleId) === String(rule._id)));
  const pooledEquivalentScore = componentsAreEvidenceEquivalent(components)
    ? scoreRuleV3(components[0], evidence)
    : null;
  const weakestComponent = componentScores.reduce((weakest, current) =>
    !weakest || current.score.evidenceScore < weakest.score.evidenceScore ? current : weakest,
  null as (typeof componentScores[number] | null));
  const score = pooledEquivalentScore || (weakestComponent ? {
    ...weakestComponent.score,
    // A composite is only as review-ready as its weakest atomic claim. Counts
    // are kept per component below; the headline never averages a weak claim
    // into looking stronger.
    evidenceScore: weakestComponent.score.evidenceScore,
    oracleUsefulnessScore: Math.min(...componentScores.map(item => item.score.oracleUsefulnessScore)),
    oracleEligible: componentScores.every(item => item.score.oracleEligible),
    qualityAccepted: componentScores.every(item => item.score.qualityAccepted),
    supportingCitationCount: componentScores.reduce((sum, item) => sum + item.score.supportingCitationCount, 0),
    limitingCitationCount: componentScores.reduce((sum, item) => sum + item.score.limitingCitationCount, 0),
    contradictingCitationCount: componentScores.reduce((sum, item) => sum + item.score.contradictingCitationCount, 0),
    exactCitationCount: componentScores.reduce((sum, item) => sum + item.score.exactCitationCount, 0),
  } : baseScore);
  const sourceId = source?._id || String(evidence[0]?.sourceId || '');
  return {
    _id: String(rule._id),
    _engine: 'v3',
    academicSourceId: sourceId || null,
    evidenceChunkIds: evidence.map(item => String(item.chunkId)),
    proposedRuleId: rule.ruleCode,
    sourceLanguage: rule.sourceLanguage,
    label: shortRuleLabel(rule),
    fullStatement: rule.statement,
    expandedExplanation: expandRuleExplanation(rule, rule.sourceLanguage),
    ...(hasCuratedRuleExplanation(rule) ? {
      expandedExplanations: {
        vi: expandRuleExplanation(rule, 'vi'),
        en: expandRuleExplanation(rule, 'en'),
      },
    } : {}),
    probeBlueprint: buildCompositeProbeBlueprint(rule),
    group: 'dream_psychology',
    category: rule.claimType,
    factor: rule.subject,
    inputSource: rule.outcome,
    inputRequired: {},
    scientificBasis: 'Các trích dẫn bên dưới đã được đối chiếu nguyên văn với Bản đọc thông minh.',
    aiInstruction: '',
    limitations: (rule.limitations || []).join('; '),
    conditionsList: rule.conditions || [],
    limitationsList: rule.limitations || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
    claimTypeV3: rule.claimType,
    effectPolarityV3: rule.effectPolarity,
    evidenceInterpretationV3: rule.evidenceInterpretation,
    claimStrength: rule.evidenceInterpretation,
    confidenceCap: Math.min(0.65, score.evidenceScore / 100),
    evidenceRole: 'primary_support',
    evidenceSummary: rule.statement,
    status: mappedStatus,
    evidenceCredibilityScore: score.evidenceScore,
    oracleUsefulnessScore: score.oracleUsefulnessScore,
    oracleEligible: score.oracleEligible,
    legitimacyScore: score.evidenceScore,
    legitimacyLevel: score.certaintyTier,
    legitimacyReason: score.qualitySummary,
    exactCitationCount: score.exactCitationCount,
    supportingCitationCount: score.supportingCitationCount,
    limitingCitationCount: score.limitingCitationCount,
    contradictingCitationCount: score.contradictingCitationCount,
    independentSourceCount: score.independentSourceCount,
    qualityAccepted: score.qualityAccepted,
    qualityReasonCodes: score.qualityReasonCodes,
    qualitySummary: score.qualitySummary,
    applicationReadiness: score.applicationReadiness,
    scoreCriteria: score.scoreCriteria,
    scoringFormulaVersion: RULE_V3_SCORING_VERSION,
    sourceTitle: source?.title,
    sourceAuthors: source?.authors,
    sourceYear: source?.year,
    sourceDoi: source?.doi,
    isComposite: Boolean(rule.isComposite),
    compositeComponents: components.map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      ruleCode: component.ruleCode,
      statement: component.statement,
      claimType: component.claimType,
      effectPolarity: component.effectPolarity,
      evidenceInterpretation: component.evidenceInterpretation,
      subject: component.subject,
      outcome: component.outcome,
      conditions: component.conditions || [],
      limitations: component.limitations || [],
      dreamFeatureTags: component.dreamFeatureTags || [],
      evidenceScore: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.evidenceScore,
      qualityAccepted: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.qualityAccepted,
      supportingCitationCount: componentScores.find(item => item.sourceRuleId === String(component.sourceRuleId))?.score.supportingCitationCount,
      expandedExplanation: expandRuleExplanation(component, rule.sourceLanguage),
      ...(hasCuratedRuleExplanation(component) ? {
        expandedExplanations: {
          vi: expandRuleExplanation(component, 'vi'),
          en: expandRuleExplanation(component, 'en'),
        },
      } : {}),
    })),
    ...((pooledEquivalentScore || weakestComponent) ? {
      scoreAggregation: {
        method: pooledEquivalentScore ? 'pooled_equivalent_evidence' : 'minimum_component',
        weakestRuleCode: weakestComponent
          ? components.find((component: any) => String(component.sourceRuleId) === weakestComponent.sourceRuleId)?.ruleCode
          : undefined,
        explanation: pooledEquivalentScore
          ? (rule.sourceLanguage === 'vi'
            ? 'Các mệnh đề có cùng chủ thể và kết quả nên bằng chứng từ những tài liệu độc lập được gộp để chấm lại kết luận chung.'
            : 'The claims have equivalent subjects and outcomes, so evidence from independent documents is pooled to rescore the shared conclusion.')
          : (rule.sourceLanguage === 'vi'
            ? 'Điểm tổng hợp lấy theo mệnh đề yếu nhất. Việc gộp các mệnh đề từ cùng một tài liệu hoặc cùng một đoạn nguồn không tạo thêm nguồn độc lập và không làm điểm học thuật tăng.'
            : 'The composite score follows the weakest claim. Combining claims from the same document or source paragraph does not create independent evidence and therefore does not increase academic support.'),
      },
    } : {}),
    ...(mergeCluster && mergeCluster.memberCount > 1 ? { mergeCluster } : {}),
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt
  };
}

export const getRuleV3Candidates = async (req: Request, res: Response): Promise<void> => {
  const requestedStatus = String(req.query.status || 'pending');
  const status = requestedStatus === 'approved' ? 'verified' : requestedStatus;
  const sourceId = req.query.academicSourceId ? String(req.query.academicSourceId) : null;
  const filter: any = { status };
  if (sourceId) {
    if (!mongoose.Types.ObjectId.isValid(sourceId)) {
      res.status(400).json({ success: false, message: 'Mã tài liệu không hợp lệ.' });
      return;
    }
    const requestedId = new mongoose.Types.ObjectId(sourceId);
    const sourceAliases = [requestedId];
    const [approvedById, approvedByContribution] = await Promise.all([
      AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
      AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean()
    ]);
    if (approvedById?.sourceContributionId) sourceAliases.push(approvedById.sourceContributionId);
    if (approvedByContribution?._id) sourceAliases.push(approvedByContribution._id);
    const ruleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', { sourceId: { $in: sourceAliases } });
    filter._id = { $in: ruleIds };
  }
  const rules = await KnowledgeRuleV3.find(filter).sort({ createdAt: -1 }).lean();
  const evidenceOwnerIds = rules.flatMap(rule => [
    rule._id,
    ...(rule.compositeComponents || []).map((component: any) => component.sourceRuleId),
  ]);
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: evidenceOwnerIds } })
    .select('ruleId sourceId chunkId stance exactness verificationScore exactQuote researchType researchTypeConfidence sourceQuality')
    .lean();
  const evidenceByRule = new Map<string, any[]>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    if (!evidenceByRule.has(key)) evidenceByRule.set(key, []);
    evidenceByRule.get(key)!.push(item);
  }
  const sourceSummaries = await loadRuleV3SourceSummaries(evidence.map(item => String(item.sourceId)));
  const mergeClusters = buildRuleV3MergeClusters(rules
    .filter(rule => rule.status === 'pending' && !rule.isComposite)
    .map(rule => ({
    id: String(rule._id),
    statement: rule.statement,
    subject: rule.subject,
    outcome: rule.outcome,
    claimType: rule.claimType,
    effectPolarity: rule.effectPolarity,
    conditions: rule.conditions,
    questionKind: classifyRuleV3VerificationKind(rule),
    evidenceChunkIds: (evidenceByRule.get(String(rule._id)) || []).map(item => String(item.chunkId)),
  })));
  const data = rules.map(rule => {
    const ruleOwnerIds = [String(rule._id), ...(rule.compositeComponents || []).map((component: any) => String(component.sourceRuleId))];
    const ruleEvidence = ruleOwnerIds.flatMap(ownerId => evidenceByRule.get(ownerId) || []);
    const source = sourceSummaries.get(String(ruleEvidence[0]?.sourceId || sourceId || ''));
    return mapRuleV3Candidate(rule, source, ruleEvidence, mergeClusters.get(String(rule._id)));
  });
  res.status(200).json({ success: true, data });
};

export const getRuleV3CandidateDetail = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }
  const rule = await KnowledgeRuleV3.findById(req.params.id).lean();
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }
  const componentRuleIds = (rule.compositeComponents || [])
    .map((component: any) => component.sourceRuleId)
    .filter((id: unknown) => id && String(id) !== String(rule._id));
  const feedbackRuleIds = [rule._id, ...componentRuleIds];
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: feedbackRuleIds } }).sort({ createdAt: 1 }).lean();
  const chunks = await AcademicChunk.find({ _id: { $in: evidence.map(item => item.chunkId) } }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceSummaries = await loadRuleV3SourceSummaries(evidence.map(item => String(item.sourceId)));
  const source = sourceSummaries.get(String(evidence[0]?.sourceId || ''));
  const candidate = mapRuleV3Candidate(rule, source, evidence);
  const comparableRules = await KnowledgeRuleV3.find({
    _id: { $nin: feedbackRuleIds },
    sourceLanguage: rule.sourceLanguage,
    status: { $in: ['pending', 'verified'] }
  }).select('ruleCode status sourceLanguage statement subject outcome claimType effectPolarity conditions evidenceScore isComposite').lean();
  const comparableEvidence = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: comparableRules.map(item => item._id) },
  }).select('ruleId sourceId chunkId').lean();
  const selectedChunkIds = new Set(evidence.map(item => String(item.chunkId)));
  const selectedSourceIds = new Set(evidence.map(item => String(item.sourceId)));
  const chunkIdsByRule = new Map<string, Set<string>>();
  const sourceIdsByRule = new Map<string, Set<string>>();
  for (const item of comparableEvidence) {
    const key = String(item.ruleId);
    const ids = chunkIdsByRule.get(key) || new Set<string>();
    ids.add(String(item.chunkId));
    chunkIdsByRule.set(key, ids);
    const sourceIds = sourceIdsByRule.get(key) || new Set<string>();
    sourceIds.add(String(item.sourceId));
    sourceIdsByRule.set(key, sourceIds);
  }
  const ruleRelationships = comparableRules
    .map(other => {
      const sharedEvidenceChunkCount = [...(chunkIdsByRule.get(String(other._id)) || new Set<string>())]
        .filter(chunkId => selectedChunkIds.has(chunkId)).length;
      const selectedQuestionKind = classifyRuleV3VerificationKind(rule);
      const otherQuestionKind = classifyRuleV3VerificationKind(other);
      const sameSourceDocument = [...(sourceIdsByRule.get(String(other._id)) || new Set<string>())]
        .some(sourceId => selectedSourceIds.has(sourceId));
      const mergeAssessment = assessRuleV3MergeCompatibility(rule, other, {
        sharedEvidenceContext: sharedEvidenceChunkCount > 0,
        sameQuestionKind: selectedQuestionKind !== 'none' && selectedQuestionKind === otherQuestionKind,
        sameSourceDocument,
      });
      const relationship = classifyRuleV3Relationship(rule, other, {
        sharedEvidenceContext: sharedEvidenceChunkCount > 0,
      });
      const blockedByState = rule.isComposite || (other as any).isComposite
        ? 'composite_review_boundary'
        : other.status !== rule.status
          ? 'different_status'
          : null;
      const canMerge = ['pending', 'verified'].includes(rule.status)
        && !blockedByState && mergeAssessment.canMerge;
      return {
        other,
        sharedEvidenceChunkCount,
        relationship,
        mergeAssessment: {
          ...mergeAssessment,
          semanticCanMerge: mergeAssessment.canMerge,
          canMerge,
          blockedByState,
        },
      };
    })
    .filter(item => item.relationship !== 'unrelated')
    .map(({ other, relationship, sharedEvidenceChunkCount, mergeAssessment }) => ({
      ruleId: String(other._id),
      ruleCode: other.ruleCode,
      status: other.status === 'verified' ? 'approved' : other.status,
      label: shortRuleLabel(other),
      relationship,
      mergeEligibility: mergeAssessment,
      sharedEvidenceChunkCount,
      evidenceScore: other.evidenceScore,
      subject: other.subject,
      outcome: other.outcome,
      statement: other.statement,
      keepSeparateReason: mergeAssessment.canMerge ? null : relationship,
    }))
    .sort((left, right) => {
      const priority: Record<string, number> = {
        contradictory: 0,
        scope_tension: 1,
        equivalent: 2,
        overlapping: 3,
        reverse_direction: 4,
        complementary: 5,
        shared_context: 6,
      };
      return (priority[left.relationship] ?? 99) - (priority[right.relationship] ?? 99)
        || right.sharedEvidenceChunkCount - left.sharedEvidenceChunkCount
        || right.evidenceScore - left.evidenceScore;
    })
    .slice(0, 20);
  const feedbackRows = await Dream.aggregate<{ _id: 'supports' | 'weakens' | 'unresolved'; count: number }>([
    { $match: { 'realLifeHypothesesFeedback.ruleId': { $in: feedbackRuleIds.map(id => String(id)) } } },
    { $unwind: '$realLifeHypothesesFeedback' },
    { $match: { 'realLifeHypothesesFeedback.ruleId': { $in: feedbackRuleIds.map(id => String(id)) } } },
    { $sort: { 'realLifeHypothesesFeedback.updatedAt': -1 } },
    { $group: {
      _id: '$realLifeHypothesesFeedback.userId',
      effect: { $first: '$realLifeHypothesesFeedback.effect' },
    } },
    { $group: { _id: '$effect', count: { $sum: 1 } } },
  ]);
  const feedbackStats = {
    supports: 0,
    weakens: 0,
    unresolved: 0,
    total: 0,
    applicabilityRate: null as number | null,
    applicabilityScore: null as number | null,
  };
  for (const row of feedbackRows) {
    if (row._id in feedbackStats) feedbackStats[row._id] = row.count;
    feedbackStats.total += row.count;
  }
  const resolvedCount = feedbackStats.supports + feedbackStats.weakens;
  feedbackStats.applicabilityRate = resolvedCount > 0
    ? Math.round((feedbackStats.supports / resolvedCount) * 100)
    : null;
  feedbackStats.applicabilityScore = resolvedCount > 0
    ? Math.round(((feedbackStats.supports + 2) / (resolvedCount + 4)) * 100)
    : null;
  res.status(200).json({
    success: true,
    data: {
      candidate,
      ruleRelationships,
      feedbackStats,
      evidenceChunks: chunks.map((chunk: any) => ({
        chunkId: String(chunk._id),
        sectionTitle: chunk.sectionTitle,
        sectionType: chunk.sectionType || chunk.blockType || 'paragraph',
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sourceOrder: chunk.chunkOrder,
        chunkPreview: String(chunk.text || '').slice(0, 2000)
      })),
      evidenceExcerpts: groupEvidenceExcerpts(evidence, chunkMap, sourceSummaries)
    }
  });
};

export const mergeRuleV3CandidateGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    if (String(req.body?.confirmation || '') !== 'MERGE_COMPATIBLE_RULES') {
      res.status(400).json({ success: false, code: 'merge_confirmation_required', message: 'Thiếu xác nhận gộp quy luật.' });
      return;
    }
    const result = await mergePendingRuleV3Group(String(req.params.id));
    res.status(200).json({
      success: true,
      message: 'Đã tạo quy luật tổng hợp và lưu vết các mệnh đề nguồn.',
      data: result,
    });
  } catch (error) {
    if (error instanceof RuleV3MergeError) {
      const status = error.code === 'rule_not_found' ? 404 : 409;
      const messages = {
        rule_not_found: 'Không tìm thấy quy luật cần gộp.',
        rule_not_pending: 'Chỉ có thể gộp các quy luật nguyên tử cùng trạng thái chờ duyệt hoặc cùng trạng thái đã duyệt.',
        no_compatible_rules: 'Không có mệnh đề đủ tương thích để gộp an toàn với quy luật này.',
        merge_too_large: 'Cụm quy luật quá lớn để gộp an toàn trong một lần.',
      };
      res.status(status).json({ success: false, code: error.code, message: messages[error.code] });
      return;
    }
    res.status(500).json({ success: false, code: 'rule_merge_failed', message: 'Không thể gộp quy luật.' });
  }
};

async function approveRuleV3Record(existing: any): Promise<void> {
  const compositeComponents = Array.isArray(existing.compositeComponents)
    ? existing.compositeComponents
    : [];
  const componentIds = compositeComponents.map((component: any) => component.sourceRuleId).filter(Boolean);
  const evidence = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: componentIds.length ? componentIds : [existing._id] },
  }).lean();
  const score = componentsAreEvidenceEquivalent(compositeComponents)
    ? scoreRuleV3(compositeComponents[0], evidence)
    : scoreRuleV3(existing, evidence.filter(item => String(item.ruleId) === String(existing._id)));
  if (score.supportingCitationCount === 0) {
    throw new Error('missing_supporting_citation');
  }
  if (!score.qualityAccepted || score.semanticSupportLevel !== 'direct') {
    throw new Error('quality_gate_failed');
  }
  if (existing.isComposite && compositeComponents.length > 1) {
    const evidenceByRule = new Map<string, any[]>();
    for (const item of evidence) {
      const key = String(item.ruleId);
      const rows = evidenceByRule.get(key) || [];
      rows.push(item);
      evidenceByRule.set(key, rows);
    }
    const everyComponentPasses = compositeComponents.every((snapshot: any) => {
      // Score the immutable component snapshot, not the now-composite primary
      // document. This prevents another component's wording or scope from
      // making a weak atomic claim appear stronger than its own evidence.
      const componentScore = scoreRuleV3(snapshot, evidenceByRule.get(String(snapshot.sourceRuleId)) || []);
      return componentScore.supportingCitationCount > 0
        && componentScore.qualityAccepted
        && componentScore.semanticSupportLevel === 'direct';
    });
    if (!everyComponentPasses) throw new Error('composite_component_quality_gate_failed');
  }
  let embedding: number[];
  const embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const expectedDimension = Number.parseInt(process.env.RULE_V3_EMBEDDING_DIMENSION || '768', 10);
  try {
    embedding = await generateEmbedding([
      existing.statement,
      `Subject: ${existing.subject}`,
      `Outcome: ${existing.outcome}`,
      ...compositeComponents.flatMap((component: any) => [
        `Component: ${component.statement}`,
        `Component subject: ${component.subject}`,
        `Component outcome: ${component.outcome}`,
      ]),
      `Conditions: ${(existing.conditions || []).join('; ')}`,
      `Dream features: ${(existing.dreamFeatureTags || []).join('; ')}`
    ].join('\n'));
    if (!Array.isArray(embedding) || embedding.length !== expectedDimension || !embedding.every(Number.isFinite)) {
      throw new Error('invalid_embedding');
    }
  } catch {
    throw new Error('embedding_unavailable');
  }
  await KnowledgeRuleV3.findByIdAndUpdate(existing._id, {
    status: 'verified',
    evidenceScore: score.evidenceScore,
    certaintyTier: score.certaintyTier,
    supportingSourceCount: score.supportingSourceCount,
    contradictingSourceCount: score.contradictingSourceCount,
    embedding,
    embeddingModel
  }, { new: true, runValidators: true });
}

export const approveRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  const existing = await KnowledgeRuleV3.findById(req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Không tìm thấy quy luật Rule V3.' });
    return;
  }
  try {
    await approveRuleV3Record(existing);
  } catch (error: any) {
    const messages: Record<string, string> = {
      missing_supporting_citation: 'Không thể duyệt quy luật chưa có trích dẫn hỗ trợ nguyên văn.',
      quality_gate_failed: 'Quy luật chưa vượt qua kiểm tra chất lượng bắt buộc.',
      composite_component_quality_gate_failed: 'Chưa thể duyệt quy luật tổng hợp vì ít nhất một mệnh đề con chưa có dẫn chứng trực tiếp hoặc chưa vượt qua kiểm tra chất lượng.',
      embedding_unavailable: 'Chưa thể tạo chỉ mục truy hồi cho quy luật. Quy luật chưa được duyệt; vui lòng kiểm tra mô hình embedding.'
    };
    res.status(error?.message === 'embedding_unavailable' ? 503 : 422).json({ success: false, message: messages[error?.message] || 'Không thể duyệt quy luật.' });
    return;
  }
  const rule = await KnowledgeRuleV3.findById(existing._id);
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy quy luật Rule V3.' });
    return;
  }
  await reconcileOracleEvidenceGapsForRule({
    _id: rule._id,
    statement: rule.statement,
    subject: rule.subject,
    outcome: rule.outcome,
    evidenceScore: rule.evidenceScore,
    supportingSourceCount: rule.supportingSourceCount,
  }).catch(() => undefined);
  res.status(200).json({ success: true, message: 'Đã duyệt Rule V3.' });
};

async function bulkRuleIds(status: 'pending' | 'rejected', sourceId?: string): Promise<mongoose.Types.ObjectId[]> {
  if (!sourceId) return (await KnowledgeRuleV3.find({ status }).select('_id').lean()).map(item => item._id);
  if (!mongoose.Types.ObjectId.isValid(sourceId)) throw new Error('invalid_source_id');
  const requestedId = new mongoose.Types.ObjectId(sourceId);
  const aliases = [requestedId];
  const [approved, contribution] = await Promise.all([
    AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
    AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean()
  ]);
  if (approved?.sourceContributionId) aliases.push(approved.sourceContributionId);
  if (contribution?._id) aliases.push(contribution._id);
  const ownedRuleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', { sourceId: { $in: aliases } });
  return (await KnowledgeRuleV3.find({ _id: { $in: ownedRuleIds }, status }).select('_id').lean()).map(item => item._id);
}

export const bulkRuleV3Action = async (req: Request, res: Response): Promise<void> => {
  const action = String(req.body?.action || '');
  const expectedConfirmations: Record<string, string> = {
    approve_pending: 'APPROVE_ALL_PENDING_RULES', reject_pending: 'REJECT_ALL_PENDING_RULES',
    restore_rejected: 'RESTORE_ALL_REJECTED_RULES', delete_rejected: 'DELETE_ALL_REJECTED_RULES'
  };
  if (!expectedConfirmations[action] || req.body?.confirmation !== expectedConfirmations[action]) {
    res.status(400).json({ success: false, message: 'Xác nhận thao tác hàng loạt không hợp lệ.' });
    return;
  }
  try {
    const sourceId = req.body?.sourceId ? String(req.body.sourceId) : undefined;
    const status: 'pending' | 'rejected' = action.includes('pending') ? 'pending' : 'rejected';
    const ids = await bulkRuleIds(status, sourceId);
    if (action === 'reject_pending') await KnowledgeRuleV3.updateMany({ _id: { $in: ids } }, { status: 'rejected', $unset: { embedding: 1, embeddingModel: 1 } });
    if (action === 'restore_rejected') await KnowledgeRuleV3.updateMany({ _id: { $in: ids } }, { status: 'pending' });
    if (action === 'delete_rejected') {
      await KnowledgeRuleEvidenceV3.deleteMany({ ruleId: { $in: ids } });
      await KnowledgeRuleV3.deleteMany({ _id: { $in: ids }, status: 'rejected' });
    }
    const failures: Array<{ ruleId: string; reason: string }> = [];
    let processed = action === 'approve_pending' ? 0 : ids.length;
    if (action === 'approve_pending') {
      const rules = await KnowledgeRuleV3.find({ _id: { $in: ids }, status: 'pending' });
      for (const rule of rules) {
        try {
          await approveRuleV3Record(rule);
          const verified = await KnowledgeRuleV3.findById(rule._id);
          if (verified) {
            await reconcileOracleEvidenceGapsForRule({
              _id: verified._id,
              statement: verified.statement,
              subject: verified.subject,
              outcome: verified.outcome,
              evidenceScore: verified.evidenceScore,
              supportingSourceCount: verified.supportingSourceCount,
            }).catch(() => undefined);
          }
          processed += 1;
        }
        catch (error: any) { failures.push({ ruleId: String(rule._id), reason: String(error?.message || 'approval_failed') }); }
      }
    }
    res.status(200).json({ success: true, data: { processed, failed: failures.length, failures } });
  } catch {
    res.status(400).json({ success: false, message: 'Không thể thực hiện thao tác hàng loạt Rule V3.' });
  }
};

export const rejectRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  const rule = await KnowledgeRuleV3.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã từ chối Rule V3.' });
};

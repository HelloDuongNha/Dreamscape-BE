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
import { classifyRuleV3Relationship } from '../services/rules/ruleV3Relationship.service';
import { classifyRuleV3VerificationKind } from '../services/rules/ruleV3DreamApplication.service';
import { generateEmbedding } from '../services/infrastructure/llm.service';

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
  if (verificationKind === 'none') {
    return {
      verificationKind,
      checkable: false,
      conditionSummary: condition || null,
      explanation: 'Quy luật này chỉ cung cấp kiến thức nền. Dữ liệu nguồn chưa nêu điều kiện có thể hỏi người kể để kiểm tra việc áp dụng vào một giấc mơ cụ thể.',
      feedbackEffect: 'Không tạo câu hỏi và không nhận phản hồi áp dụng.'
    };
  }
  const descriptions: Record<string, string> = {
    multiple_future_horizons: 'Kiểm tra xem nhiều mốc tương lai trong mơ có tương ứng với nhiều kế hoạch thật đang cùng đòi hỏi sự chú ý hay không.',
    recent_experience_incorporation: 'Kiểm tra xem một chi tiết cụ thể trong mơ có nguồn trải nghiệm gần đây ngoài đời hay không.',
    anticipated_event: 'Kiểm tra xem sự kiện được dự kiến trong mơ có tương ứng với một việc thật đang được chờ đợi hay chuẩn bị hay không.',
    current_stress: 'Kiểm tra xem điều kiện căng thẳng đời thực mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    avoidance_pressure: 'Kiểm tra xem điều kiện né tránh hoặc trì hoãn mà nghiên cứu nêu có tồn tại trong trường hợp này hay không.',
    attachment_support_under_stress: 'Kiểm tra xem nhân vật được tìm tới trong lúc căng thẳng có thật sự từng là một người mang lại cảm giác an toàn hoặc hỗ trợ cho người kể hay không.',
    external_sleep_stimulus: 'Kiểm tra xem kích thích thật trong môi trường ngủ có được ghép vào nội dung giấc mơ hay không.'
  };
  return {
    verificationKind,
    checkable: true,
    conditionSummary: condition || null,
    applicabilityCheck: descriptions[verificationKind],
    feedbackEffect: 'Có làm tăng số trường hợp áp dụng phù hợp; Không làm tăng số trường hợp không phù hợp; Chưa biết không tác động. Phản hồi không thay đổi điểm bằng chứng học thuật.'
  };
}

function groupEvidenceExcerpts(evidence: any[], chunkMap: Map<string, any>, sourceSummaries: Map<string, RuleV3SourceSummary>) {
  const byOwner = new Map<string, any[]>();
  for (const item of evidence) {
    const key = `${String(item.sourceId)}:${String(item.chunkId)}:${item.stance}`;
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

function mapRuleV3Candidate(rule: any, source: RuleV3SourceSummary | undefined, evidence: any[] = []) {
  const mappedStatus = rule.status === 'verified' ? 'approved' : rule.status;
  const score = scoreRuleV3(rule, evidence);
  const sourceId = source?._id || String(evidence[0]?.sourceId || '');
  return {
    _id: String(rule._id),
    _engine: 'v3',
    academicSourceId: sourceId || null,
    evidenceChunkIds: evidence.map(item => String(item.chunkId)),
    proposedRuleId: rule.ruleCode,
    label: shortRuleLabel(rule),
    fullStatement: rule.statement,
    probeBlueprint: buildProbeBlueprint(rule),
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
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: rules.map(rule => rule._id) } })
    .select('ruleId sourceId chunkId stance exactness verificationScore exactQuote researchType researchTypeConfidence sourceQuality')
    .lean();
  const evidenceByRule = new Map<string, any[]>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    if (!evidenceByRule.has(key)) evidenceByRule.set(key, []);
    evidenceByRule.get(key)!.push(item);
  }
  const sourceSummaries = await loadRuleV3SourceSummaries(evidence.map(item => String(item.sourceId)));
  const data = rules.map(rule => {
    const ruleEvidence = evidenceByRule.get(String(rule._id)) || [];
    const source = sourceSummaries.get(String(ruleEvidence[0]?.sourceId || sourceId || ''));
    return mapRuleV3Candidate(rule, source, ruleEvidence);
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
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: rule._id }).sort({ createdAt: 1 }).lean();
  const chunks = await AcademicChunk.find({ _id: { $in: evidence.map(item => item.chunkId) } }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceSummaries = await loadRuleV3SourceSummaries(evidence.map(item => String(item.sourceId)));
  const source = sourceSummaries.get(String(evidence[0]?.sourceId || ''));
  const candidate = mapRuleV3Candidate(rule, source, evidence);
  const comparableRules = await KnowledgeRuleV3.find({
    _id: { $ne: rule._id },
    sourceLanguage: rule.sourceLanguage,
    status: { $ne: 'rejected' }
  }).select('ruleCode status sourceLanguage statement subject outcome claimType effectPolarity conditions evidenceScore').lean();
  const ruleRelationships = comparableRules
    .map(other => ({ other, relationship: classifyRuleV3Relationship(rule, other) }))
    .filter(item => item.relationship !== 'unrelated')
    .map(({ other, relationship }) => ({
      ruleId: String(other._id),
      ruleCode: other.ruleCode,
      status: other.status === 'verified' ? 'approved' : other.status,
      label: shortRuleLabel(other),
      relationship,
      evidenceScore: other.evidenceScore
    }));
  const feedbackRows = await Dream.aggregate<{ _id: 'supports' | 'weakens' | 'unresolved'; count: number }>([
    { $match: { 'realLifeHypothesesFeedback.ruleId': String(rule._id) } },
    { $unwind: '$realLifeHypothesesFeedback' },
    { $match: { 'realLifeHypothesesFeedback.ruleId': String(rule._id) } },
    { $group: { _id: '$realLifeHypothesesFeedback.effect', count: { $sum: 1 } } }
  ]);
  const feedbackStats = { supports: 0, weakens: 0, unresolved: 0, total: 0, applicabilityRate: null as number | null };
  for (const row of feedbackRows) {
    if (row._id in feedbackStats) feedbackStats[row._id] = row.count;
    feedbackStats.total += row.count;
  }
  const resolvedCount = feedbackStats.supports + feedbackStats.weakens;
  feedbackStats.applicabilityRate = resolvedCount > 0
    ? Math.round((feedbackStats.supports / resolvedCount) * 100)
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

async function approveRuleV3Record(existing: any): Promise<void> {
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: existing._id }).lean();
  const score = scoreRuleV3(existing, evidence);
  if (score.supportingCitationCount === 0) {
    throw new Error('missing_supporting_citation');
  }
  if (!score.qualityAccepted || score.semanticSupportLevel !== 'direct') {
    throw new Error('quality_gate_failed');
  }
  let embedding: number[];
  const embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const expectedDimension = Number.parseInt(process.env.RULE_V3_EMBEDDING_DIMENSION || '768', 10);
  try {
    embedding = await generateEmbedding([
      existing.statement,
      `Subject: ${existing.subject}`,
      `Outcome: ${existing.outcome}`,
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
        try { await approveRuleV3Record(rule); processed += 1; }
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

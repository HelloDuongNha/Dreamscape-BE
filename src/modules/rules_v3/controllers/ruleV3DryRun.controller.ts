import { Request, Response } from 'express';
import { parseRuleV3ExtractionRequest } from '../dto';
import { extractRuleV3Candidates } from '../services/extraction/ruleV3Extractor.service';
import { RuleV3GenerationProvider } from '../services/providers/ruleV3GenerationProvider.types';
import { buildRuleV3PlanPreview, buildRuleV3PlanPreviewRaw } from '../services/planning/ruleV3PlanPreview.service';
import { getRuleV3DryRunErrorResponse } from '../services/extraction/ruleV3DryRunError.service';
import {
  createRuleV3Provider,
  getProductionAvailabilityConfig,
} from '../services/providers/ruleV3ProviderRuntime.service';

export interface RuleV3DryRunDependencies {
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

export function createRuleV3DryRunController(deps: RuleV3DryRunDependencies) {
  const activeDryRuns = new Set<string>();

  const previewRuleV3Plan = async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const plan = await deps.planLoader(String(req.params.id));
      const previewGeneration = await deps.availabilityChecker();
      res.status(200).json({ success: true, data: { ...plan, previewGeneration } });
    } catch {
      res.status(400).json({
        success: false,
        errorCode: 'plan_unavailable',
        message: 'Không thể tải tài liệu hoặc kế hoạch phân tích.',
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
        message: 'Bạn đang có một lượt chạy thử nghiệm trích xuất đang diễn ra.',
      });
      return;
    }

    activeDryRuns.add(moderatorId);
    const controller = new AbortController();
    const timerId = deps.setTimeoutFn(() => controller.abort(), deps.timeoutMs);

    try {
      const id = String(req.params.id);
      const workUnitId = String(req.params.workUnitId);
      const { provider } = parseRuleV3ExtractionRequest(req.body);
      const config = await deps.availabilityChecker();
      const chosenProviderName = provider || config.defaultProvider;

      if (!chosenProviderName) {
        res.status(400).json({
          success: false,
          errorCode: 'provider_unavailable',
          message: 'Không có provider cấu hình sẵn sàng.',
        });
        return;
      }
      if (chosenProviderName !== 'ollama' && chosenProviderName !== 'gemini') {
        res.status(400).json({
          success: false,
          errorCode: 'invalid_provider',
          message: 'Provider không hợp lệ.',
        });
        return;
      }

      const providerStatus = config.providerStatuses.find(item => item.provider === chosenProviderName);
      if (!providerStatus?.available) {
        res.status(400).json({
          success: false,
          errorCode: 'provider_unavailable',
          message: `Dịch vụ ${chosenProviderName} chưa được kích hoạt hoặc không sẵn sàng.`,
        });
        return;
      }

      let rawPreview: any;
      try {
        rawPreview = await deps.planLoaderRaw(id);
      } catch {
        res.status(400).json({
          success: false,
          errorCode: 'plan_unavailable',
          message: 'Không thể tải tài liệu hoặc kế hoạch phân tích.',
        });
        return;
      }

      let providerInstance: RuleV3GenerationProvider;
      try {
        providerInstance = deps.providerFactory(chosenProviderName);
      } catch (error: any) {
        res.status(400).json({
          success: false,
          errorCode: error.message === 'invalid_provider' ? 'invalid_provider' : 'provider_unavailable',
          message: error.message === 'invalid_provider'
            ? 'Cấu hình model Gemini không đúng định dạng.'
            : 'Không thể khởi tạo provider.',
        });
        return;
      }

      const readerInput = {
        documentId: String(rawPreview.document._id),
        parserEngine: rawPreview.document.parserEngine || 'unknown',
        documentUpdatedAt: rawPreview.document.updatedAt
          ? new Date(rawPreview.document.updatedAt).toISOString()
          : null,
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
        controller.signal,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error: any) {
      sendDryRunError(res, error);
    } finally {
      deps.clearTimeoutFn(timerId);
      activeDryRuns.delete(moderatorId);
    }
  };

  return { previewRuleV3Plan, dryRunRuleV3Extraction };
}

function sendDryRunError(res: Response, error: any): void {
  const response = getRuleV3DryRunErrorResponse(error);
  res.status(response.status).json({
    success: false,
    errorCode: response.errorCode,
    message: response.message,
  });
}

export const {
  previewRuleV3Plan,
  dryRunRuleV3Extraction,
} = createRuleV3DryRunController({
  planLoader: buildRuleV3PlanPreview,
  planLoaderRaw: buildRuleV3PlanPreviewRaw,
  providerFactory: createRuleV3Provider,
  availabilityChecker: getProductionAvailabilityConfig,
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
  timeoutMs: 180000,
});

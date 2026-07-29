import { Request, Response } from 'express';
import {
  createRuleV3Provider,
  getProductionAvailabilityConfig,
} from '../services/providers/ruleV3ProviderRuntime.service';
import {
  getRuleV3FullRun,
  startRuleV3FullExtraction,
  cancelRuleV3FullExtraction,
} from '../services/extraction/ruleV3FullExtraction.service';
import { getRuleV3SourceSummary } from '../services/extraction/ruleV3ExtractionSummary.service';
import { parseRuleV3ExtractionRequest } from '../dto';

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
    const provider = createRuleV3Provider(providerName);
    const { replaceExisting } = parseRuleV3ExtractionRequest(req.body);
    const result = await startRuleV3FullExtraction(String(req.params.id), provider, {
      replaceExisting
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

export const cancelFullRuleV3Extraction = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  const cancelled = await cancelRuleV3FullExtraction(String(req.params.runId));
  if (!cancelled) {
    res.status(409).json({ success: false, message: 'Lượt phân tích không còn chạy hoặc không tồn tại.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã hủy phân tích lập luận.' });
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

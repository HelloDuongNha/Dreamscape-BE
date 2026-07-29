import { Request, Response } from 'express';
import Dream from '../models/Dream';
import { Types }         from 'mongoose';
import {
  enrichScientificNotesForResponse,
} from '../services/analysis/grounding/dreamAnalysisGrounding.service';
import { composeDreamNarrative } from '../services/content/dreamNarrative.service';
import {
  applyDreamHypothesisFeedback,
  DreamFeedbackError,
} from '../services/analysis/execution/dreamFeedback.service';
import { parseDreamFeedbackRequest } from '../dto/dreamFeedback.dto';

// Applies an answer to its linked hypotheses and validation rules.
export const saveHypothesisFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseDreamFeedbackRequest(req.params, req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ success: false, message: parsed.message });
      return;
    }
    const {
      dreamId,
      hypothesisIndex,
      verificationKey: cleanRequestedKey = '',
      answer,
    } = parsed.value;
    const userId = String(req.user!._id);
    const isClearingAnswer = answer === null;

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Không tìm thấy giấc mơ.' });
      return;
    }

    if (dream.userId.toString() !== userId) {
      res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện hành động này.' });
      return;
    }

    const activeAnalysis = dream.ai_result || (dream as any).aiAnalysis || {};
    const completeNarrative = composeDreamNarrative(dream.content || '', dream.additions || []);
    const renderedAnalysis = enrichScientificNotesForResponse(
      activeAnalysis,
      dream.retrievedContext,
      completeNarrative,
    );
    const hypotheses = (renderedAnalysis as any).real_life_hypotheses;
    const matchedIndex = Array.isArray(hypotheses)
      ? (cleanRequestedKey
          ? hypotheses.findIndex((item: any) => String(item?.verificationKey || '') === cleanRequestedKey)
          : Number(hypothesisIndex))
      : -1;
    if (!Array.isArray(hypotheses) || matchedIndex < 0 || matchedIndex >= hypotheses.length) {
      res.status(400).json({ success: false, message: 'Không tìm thấy câu hỏi tương ứng.' });
      return;
    }

    const data = await applyDreamHypothesisFeedback({
      dream,
      userId,
      hypotheses,
      matchedIndex,
      requestedIndex: hypothesisIndex,
      answer,
      renderedAnalysis,
      completeNarrative,
    });

    res.status(200).json({
      success: true,
      message: isClearingAnswer ? 'Đã bỏ lựa chọn.' : 'Đã ghi nhận phản hồi.',
      data,
    });
  } catch (err: any) {
    if (err instanceof DreamFeedbackError) {
      res.status(400).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({ success: false, message: 'Không thể lưu phản hồi.', error: err.message });
  }
};

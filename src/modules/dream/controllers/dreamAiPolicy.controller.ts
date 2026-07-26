import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { parseDreamAiPolicy } from '../dto/dreamAiPolicy.dto';
import {
  DreamAiPolicyError,
  setDreamAiPolicy,
} from '../services/content/dreamAiPolicy.service';
import { dispatchPreparedDreamAnalysis } from '../services/analysis/execution/dreamAnalysisDispatch.service';
import { abortDreamAnalysisExecution } from '../services/analysis/execution/dreamAnalysisRuntime.service';

export async function updateDreamAiPolicy(req: Request, res: Response): Promise<void> {
  const parsed = parseDreamAiPolicy(req.params, req.body);
  if (!parsed.ok) {
    res.status(parsed.status).json({ success: false, message: parsed.message });
    return;
  }
  try {
    const result = await setDreamAiPolicy({
      ...parsed.value,
      ownerId: req.user!._id as Types.ObjectId,
    });
    if (result.abortRunId) {
      abortDreamAnalysisExecution(parsed.value.dreamId, result.abortRunId);
    }
    if (result.prepared) dispatchPreparedDreamAnalysis(result.prepared);
    res.status(result.prepared ? 202 : 200).json({
      success: true,
      message: parsed.value.enabled
        ? 'AI analysis enabled.'
        : 'AI analysis disabled.',
      data: result.prepared?.response || result.response,
    });
  } catch (error) {
    if (error instanceof DreamAiPolicyError) {
      res.status(error.status).json({ success: false, message: error.message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update AI analysis preference.',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

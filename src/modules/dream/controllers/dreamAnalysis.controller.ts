import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import Dream from '../models/Dream';
import { mapDreamResponse } from '../services/content/dreamNarrative.service';
import { abortDreamAnalysisExecution } from '../services/analysis/execution/dreamAnalysisRuntime.service';
import { rollbackDreamAnalysisRun } from '../services/analysis/execution/dreamAnalysisRollback.service';
import { restartDreamAnalysis } from '../services/analysis/execution/dreamAnalysisRetry.service';

// Restarts analysis for an owned dream that is not already running.
export async function analyzeDreamById(req: Request, res: Response): Promise<void> {
  try {
    const dreamId = String(req.params.id);
    if (!Types.ObjectId.isValid(dreamId)) {
      res.status(400).json({ success: false, message: 'Invalid dream ID.' });
      return;
    }

    const dream = await Dream.findById(new Types.ObjectId(dreamId));
    if (!dream) {
      res.status(404).json({ success: false, message: 'Dream not found.' });
      return;
    }
    if (dream.userId.toString() !== req.user!._id.toString()) {
      res.status(403).json({ success: false, message: 'Access denied. You do not own this dream.' });
      return;
    }
    if (dream.ai_analysis_enabled === false) {
      res.status(409).json({
        success: false,
        message: 'Enable AI analysis for this post before requesting a reanalysis.',
      });
      return;
    }
    if (dream.ai_status === 'pending') {
      res.status(400).json({ success: false, message: 'Analysis is already running for this dream.' });
      return;
    }

    const data = await restartDreamAnalysis(dream, req.user!._id as Types.ObjectId);
    res.status(200).json({
      success: true,
      message: 'Dream analysis restarted successfully.',
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Failed to restart dream analysis.',
      error: error.message,
    });
  }
}

// Cancels the active run and restores the snapshot captured before it started.
export async function cancelDreamAnalysis(req: Request, res: Response): Promise<void> {
  const dreamId = String(req.params.id);
  if (!Types.ObjectId.isValid(dreamId)) {
    res.status(400).json({ success: false, message: 'Invalid dream ID.' });
    return;
  }

  const dream = await Dream.findOne({
    _id: new Types.ObjectId(dreamId),
    userId: req.user!._id,
  }).select('+analysisRollback');
  if (!dream) {
    res.status(404).json({ success: false, message: 'Dream not found.' });
    return;
  }
  if (dream.ai_status !== 'pending') {
    res.status(409).json({ success: false, message: 'Dream analysis is not running.' });
    return;
  }

  const runId = String((dream.analysisRun as any)?.runId || '');
  if (!runId) {
    res.status(409).json({ success: false, message: 'Dream analysis run is missing.' });
    return;
  }

  abortDreamAnalysisExecution(dreamId, runId);
  const restoredDream = await rollbackDreamAnalysisRun(dreamId, runId, 'cancelled');
  if (!restoredDream) {
    res.status(409).json({ success: false, message: 'Dream analysis has already finished.' });
    return;
  }

  res.status(200).json({
    success: true,
    message: 'Dream analysis cancelled.',
    data: mapDreamResponse(restoredDream),
  });
}

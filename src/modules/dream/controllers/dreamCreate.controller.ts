import type { Request, Response } from 'express';
import type { Types } from 'mongoose';
import { parseCreateDreamRequest } from '../dto/dreamCreate.dto';
import { createPendingDream } from '../services/content/dreamCreate.service';
import { mapDreamResponse } from '../services/content/dreamNarrative.service';
import { enqueueDreamAnalysis } from '../services/analysis/execution/dreamAnalysisQueue.service';
import { runBackgroundAnalysis } from '../services/analysis/execution/dreamAnalysisRunner.service';

// Creates a dream and queues its optional AI analysis.
export async function createDream(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseCreateDreamRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ success: false, message: parsed.message });
      return;
    }

    const { dream, analysisRunId } = await createPendingDream({
      ...parsed.value,
      userId: req.user!._id as Types.ObjectId,
    });
    if (analysisRunId) {
      enqueueDreamAnalysis({
        dreamId: String(dream._id),
        userId: String(req.user!._id),
        runId: analysisRunId,
        execute: () => runBackgroundAnalysis(
          dream._id,
          String(req.user!._id),
          dream.content,
          {},
          analysisRunId,
        ),
      });
    }

    res.status(201).json({
      success: true,
      message: 'Dream created successfully.',
      data: mapDreamResponse(dream),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create dream.',
      error,
    });
  }
}

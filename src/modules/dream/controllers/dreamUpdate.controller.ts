import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { parseUpdateDreamRequest } from '../dto/dreamUpdate.dto';
import {
  DreamUpdateConflictError,
  updateOwnedDream,
} from '../services/content/dreamUpdate.service';
import { dispatchPreparedDreamAnalysis } from '../services/analysis/execution/dreamAnalysisDispatch.service';

export async function updateDream(req: Request, res: Response): Promise<void> {
  try {
    const parsed = parseUpdateDreamRequest(req.params, req.body);
    if (!parsed.ok) {
      res.status(parsed.status).json({ success: false, message: parsed.message });
      return;
    }

    const updated = await updateOwnedDream({
      ...parsed.value,
      ownerId: req.user!._id as Types.ObjectId,
    });
    if (!updated) {
      res.status(403).json({ success: false, message: 'Not found or access denied.' });
      return;
    }

    if (updated.prepared) dispatchPreparedDreamAnalysis(updated.prepared);

    res.status(updated.prepared ? 202 : 200).json({
      success: true,
      message: 'Dream updated and queued for analysis.',
      data: updated.response,
    });
  } catch (err) {
    if (err instanceof DreamUpdateConflictError) {
      res.status(err.status).json({ success: false, message: err.message });
      return;
    }
    res.status(500).json({
      success: false,
      message: 'Failed to update dream.',
      error: err,
    });
  }
}

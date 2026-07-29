import type { Request, Response } from 'express';
import {
  normalizeDocumentTitle,
  parseModerationSourceQuery,
} from '../dto/sourceContribution.dto';
import {
  listModerationSources,
  updatePendingContributionTitle,
} from '../services/contribution/contributionModerationQueue.service';

export async function getPendingSources(req: Request, res: Response): Promise<void> {
  try {
    const data = await listModerationSources(parseModerationSourceQuery(req.query));
    res.status(200).json({
      success: true,
      message: 'Source contributions retrieved successfully.',
      data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching moderation sources.',
      error: error.message || error,
    });
  }
}

export async function updateSourceContributionTitle(req: Request, res: Response): Promise<void> {
  try {
    const title = normalizeDocumentTitle(req.body?.title);
    if (title.length < 3 || title.length > 300) {
      res.status(400).json({
        success: false,
        message: 'Document title must contain between 3 and 300 characters.',
      });
      return;
    }

    const result = await updatePendingContributionTitle(req.params.id as string, title);
    if (result.status !== 200) {
      res.status(result.status).json({ success: false, message: result.message });
      return;
    }

    res.status(200).json({
      success: true,
      message: 'Document title updated.',
      data: result.data,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'Could not update the document title.',
    });
  }
}

import type { Request, Response } from 'express';
import { parseSourceReviewInput } from '../dto/sourceContribution.dto';
import { reviewSourceContribution } from '../services/contribution/contributionReview.service';

export async function reviewSource(req: Request, res: Response): Promise<void> {
  try {
    const reviewerId = req.user?._id;
    if (!reviewerId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. User session not found.',
      });
      return;
    }

    const input = parseSourceReviewInput(req.body);
    if (!input.valid) {
      res.status(400).json({ success: false, message: input.message });
      return;
    }

    const result = await reviewSourceContribution(
      req.params.id as string,
      reviewerId,
      input,
    );
    res.status(result.status).json(result.body);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while reviewing the source contribution.',
      error: error.message || error,
    });
  }
}

import type { Request, Response } from 'express';
import { parseSubmissionNote } from '../dto/sourceContribution.dto';
import {
  previewSourceContribution,
  submitSourceContribution,
} from '../services/contribution/contributionSubmission.service';

export async function previewSource(req: Request, res: Response): Promise<void> {
  try {
    const data = await previewSourceContribution(req.body, req.user?._id);
    res.status(200).json({
      success: true,
      message: 'Thông tin tài liệu resolved thành công.',
      data,
    });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'Lỗi khi lấy thông tin tài liệu.',
      error: error.message || error,
    });
  }
}

export async function contributeSource(req: Request, res: Response): Promise<void> {
  try {
    const submittedBy = req.user?._id;
    if (!submittedBy) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized. User session not found.',
      });
      return;
    }

    const note = parseSubmissionNote(req.body?.submittedNote);
    if (note.length > 1000) {
      res.status(400).json({
        success: false,
        message: 'Submission note must not exceed 1000 characters.',
      });
      return;
    }

    const result = await submitSourceContribution(req.body, submittedBy, note);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    res.status(400).json({
      success: false,
      message: error.message || 'An error occurred while submitting source contribution.',
      error: error.message || error,
    });
  }
}

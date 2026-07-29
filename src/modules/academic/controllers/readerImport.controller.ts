import { Request, Response } from 'express';
import mongoose from 'mongoose';
import type { Types } from 'mongoose';
import AcademicSource from '../models/AcademicSource';
import SourceContribution from '../models/SourceContribution';
import { importFullTextForSource } from '../services/source/fullTextImport.service';
import { reimportReader } from '../services/reader/readerReimport.service';

function validateRequest(req: Request, res: Response): { sourceId: string; moderatorId: Types.ObjectId } | null {
  const moderatorId = req.user?._id;
  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return null;
  }
  const sourceId = req.params.id as string;
  if (!sourceId || !mongoose.Types.ObjectId.isValid(sourceId)) {
    res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
    return null;
  }
  return { sourceId, moderatorId };
}

export async function importFullText(req: Request, res: Response): Promise<void> {
  const context = validateRequest(req, res);
  if (!context) return;

  try {
    const approvedSource = await AcademicSource.findById(context.sourceId);
    if (approvedSource) {
      const result = await reimportReader(context.sourceId, context.moderatorId);
      res.status(result.status).json(result.body);
      return;
    }

    const contribution = await SourceContribution.findById(context.sourceId);
    if (!contribution) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }
    if (contribution.allowedUse !== 'open_access_fulltext') {
      res.status(400).json({ success: false, message: 'Tài liệu không hỗ trợ bản đọc toàn văn mở (Metadata only).' });
      return;
    }
    if (!['none', 'available', 'failed', 'imported'].includes(contribution.fullTextStatus || 'none')) {
      res.status(400).json({ success: false, message: 'Trạng thái tài liệu hiện tại không hỗ trợ nhập bản đọc.' });
      return;
    }

    const result = await importFullTextForSource(
      contribution,
      context.moderatorId,
      undefined,
      { sourcePolicy: 'structured_only', buildStartedAt: Date.now() },
    );
    res.status(result.success ? 200 : 422).json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra trong quá trình nhập bản đọc.',
      error: error.message || error,
    });
  }
}

export async function reimportFullText(req: Request, res: Response): Promise<void> {
  const context = validateRequest(req, res);
  if (!context) return;
  const result = await reimportReader(context.sourceId, context.moderatorId);
  res.status(result.status).json(result.body);
}

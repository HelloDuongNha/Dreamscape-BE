import { Request, Response } from 'express';
import mongoose from 'mongoose';
import VerifiedKnowledgeRule from '../models/VerifiedKnowledgeRule';
import AcademicSource from '../models/AcademicSource';
import AcademicFullText from '../models/AcademicDocument';
import AcademicChunk from '../models/AcademicChunk';
import KnowledgeRuleEvidence from '../models/KnowledgeRuleEvidence';

/**
 * GET /api/moderation/knowledge-rules
 * List active Component D rules with evidence count.
 * Access: Moderator only
 */
export const getKnowledgeRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const activeRules = await VerifiedKnowledgeRule.find({}).lean();

    const counts = await KnowledgeRuleEvidence.aggregate([
      { $group: { _id: '$ruleId', count: { $sum: 1 } } },
    ]);

    const countsMap = new Map<string, number>(counts.map((c: any) => [c._id.toString(), c.count]));

    const result = activeRules.map((r: any) => ({
      ruleId: r._id,
      ruleCode: r.ruleCode,
      ruleStatement: r.ruleStatement,
      classifications: r.classifications,
      scientificBasis: r.scientificBasis,
      evidenceCount: countsMap.get(r._id.toString()) || 0,
      version: r.version,
      createdAt: r.createdAt
    }));

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    console.error('Failed to get knowledge rules:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi lấy danh sách quy luật.',
    });
  }
};

/**
 * GET /api/moderation/sources/:id/chunks/search
 * Search chunks in one source by text query.
 * Access: Moderator only
 */
export const searchSourceChunks = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const rawQ = typeof req.query.q === 'string' ? req.query.q : '';
  const pageStr = typeof req.query.page === 'string' ? req.query.page : '1';
  const limitStr = typeof req.query.limit === 'string' ? req.query.limit : '10';

  try {
    const cleanId = id as string;
    if (!cleanId || !mongoose.Types.ObjectId.isValid(cleanId)) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    const source = await AcademicSource.findById(cleanId);
    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    if (!source.readableInApp) {
      res.status(400).json({ success: false, message: 'Tài liệu này không hỗ trợ đọc và phân đoạn RAG.' });
      return;
    }

    const q = rawQ.trim().substring(0, 100);
    let filter: any = { sourceId: source._id };

    if (q) {
      const escapedQ = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      filter.text = new RegExp(escapedQ, 'i');
    }

    let page = parseInt(pageStr, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 20) limit = 20;

    const skip = (page - 1) * limit;

    const total = await AcademicChunk.countDocuments(filter);

    const chunks = await AcademicChunk.find(filter)
      .select('_id sectionId documentId text tokenCount sectionOrder chunkOrder')
      .sort({ chunkOrder: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const formattedChunks = chunks.map((c: any) => {
      const isLong = c.text.length > 400;
      return {
        ...c,
        text: c.text.substring(0, 400) + (isLong ? '...' : ''),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        items: formattedChunks,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });

  } catch (err: any) {
    console.error('Failed to search source chunks:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tìm kiếm phân đoạn tài liệu.',
    });
  }
};

/**
 * POST /api/moderation/knowledge-rules/:ruleId/evidence-links
 * Create an evidence link for a rule.
 * Access: Moderator only
 */
export const createEvidenceLink = async (req: Request, res: Response): Promise<void> => {
  const { ruleId } = req.params;
  const { academicSourceId, academicChunkId, quote, evidenceSummary, confidence, extractionRunId } = req.body;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  try {
    const rule = await VerifiedKnowledgeRule.findById(ruleId);
    if (!rule) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật này.' });
      return;
    }

    if (!academicSourceId || !mongoose.Types.ObjectId.isValid(academicSourceId)) {
      res.status(400).json({ success: false, message: 'Mã định danh tài liệu không hợp lệ.' });
      return;
    }

    const source = await AcademicSource.findById(academicSourceId);
    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    if (!academicChunkId || !mongoose.Types.ObjectId.isValid(academicChunkId)) {
      res.status(400).json({ success: false, message: 'Phân đoạn liên kết không hợp lệ.' });
      return;
    }

    const chunk = await AcademicChunk.findOne({
      _id: new mongoose.Types.ObjectId(academicChunkId),
      sourceId: source._id
    });
    if (!chunk) {
      res.status(400).json({ success: false, message: 'Phân đoạn không thuộc về tài liệu này.' });
      return;
    }

    const runId = extractionRunId && mongoose.Types.ObjectId.isValid(extractionRunId)
      ? new mongoose.Types.ObjectId(extractionRunId)
      : new mongoose.Types.ObjectId();

    // Create the flat evidence
    const link = new KnowledgeRuleEvidence({
      ruleId: rule._id,
      chunkId: chunk._id,
      quote: quote || chunk.text,
      evidenceSummary: evidenceSummary || 'Tóm tắt bằng chứng khoa học',
      confidence: confidence !== undefined ? Number(confidence) : 1.0,
      extractionRunId: runId
    });
    await link.save();

    // Update VerifiedKnowledgeRule to append the evidence ID
    await VerifiedKnowledgeRule.updateOne(
      { _id: rule._id },
      { $addToSet: { evidenceIds: link._id } }
    );

    res.status(200).json({
      success: true,
      message: 'Tạo liên kết bằng chứng khoa học thành công.',
      data: link,
    });

  } catch (err: any) {
    console.error('Failed to create evidence link:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tạo liên kết bằng chứng.',
    });
  }
};

/**
 * GET /api/moderation/knowledge-rules/:ruleId/evidence-links
 * List evidence links for a rule.
 * Access: Moderator only
 */
export const getEvidenceLinks = async (req: Request, res: Response): Promise<void> => {
  const { ruleId } = req.params;

  try {
    const links = await KnowledgeRuleEvidence.find({ ruleId })
      .populate({
        path: 'chunkId',
        populate: {
          path: 'sourceId',
          select: 'title authors year doi journal publisher allowedUse',
        }
      })
      .lean();

    const formattedLinks = links.map((link: any) => {
      const c = link.chunkId;
      const src = c?.sourceId;
      return {
        _id: link._id,
        ruleId: link.ruleId,
        sourceId: src,
        chunkId: c ? {
          _id: c._id,
          sectionId: c.sectionId,
          documentId: c.documentId,
          text: c.text ? (c.text.substring(0, 400) + (c.text.length > 400 ? '...' : '')) : ''
        } : null,
        quote: link.quote,
        evidenceSummary: link.evidenceSummary,
        confidence: link.confidence,
        createdAt: link.createdAt
      };
    });

    res.status(200).json({
      success: true,
      data: formattedLinks,
    });

  } catch (err: any) {
    console.error('Failed to list evidence links:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tải danh sách liên kết bằng chứng.',
    });
  }
};

/**
 * DELETE /api/moderation/knowledge-rules/:ruleId/evidence-links/:linkId
 * Deletes an evidence link.
 * Access: Admin only
 */
export const removeEvidenceLink = async (req: Request, res: Response): Promise<void> => {
  const { ruleId, linkId } = req.params;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  const adminIdsStr = process.env.ADMIN_USER_IDS || '6a0f43ab4891b428d4bb7729';
  const adminIds = adminIdsStr.split(',').map(id => id.trim().toLowerCase());
  const isAdmin = adminIds.includes(String(moderatorId).toLowerCase());

  if (!isAdmin) {
    res.status(403).json({
      success: false,
      message: 'Forbidden. Chỉ Admin mới có quyền hủy liên kết bằng chứng.'
    });
    return;
  }

  try {
    const cleanLinkId = linkId as string;
    if (!cleanLinkId || !mongoose.Types.ObjectId.isValid(cleanLinkId)) {
      res.status(404).json({ success: false, message: 'Liên kết không tồn tại.' });
      return;
    }

    const link = await KnowledgeRuleEvidence.findOneAndDelete({ _id: cleanLinkId, ruleId });
    if (!link) {
      res.status(404).json({ success: false, message: 'Liên kết không tồn tại.' });
      return;
    }

    // Pull from VerifiedKnowledgeRule
    await VerifiedKnowledgeRule.updateOne(
      { _id: ruleId },
      { $pull: { evidenceIds: link._id } }
    );

    res.status(200).json({
      success: true,
      message: 'Hủy liên kết bằng chứng khoa học thành công.',
      data: link,
    });

  } catch (err: any) {
    console.error('Failed to delete evidence link:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi hủy liên kết bằng chứng.',
    });
  }
};

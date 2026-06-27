import { Request, Response } from 'express';
import mongoose from 'mongoose';
import KnowledgeRule from '../models/KnowledgeRule';
import AcademicSource from '../models/AcademicSource';
import AcademicFullText from '../models/AcademicFullText';
import AcademicChunk from '../models/AcademicChunk';
import KnowledgeRuleSource from '../models/KnowledgeRuleSource';

/**
 * GET /api/moderation/knowledge-rules
 * List active Component D rules with evidence count.
 * Access: Moderator only
 */
export const getKnowledgeRules = async (req: Request, res: Response): Promise<void> => {
  try {
    // Return only active rules by default (exclude seed rules unless ALLOW_SEED_RULES=true)
    const rulesQuery: any = { isActive: true };
    if (process.env.ALLOW_SEED_RULES !== 'true') {
      rulesQuery.origin = { $ne: 'seed' };
    }
    const activeRules = await KnowledgeRule.find(rulesQuery).lean();

    // Query active evidence count grouped by ruleId
    const counts = await KnowledgeRuleSource.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: '$ruleId', count: { $sum: 1 } } },
    ]);

    const countsMap = new Map<string, number>(counts.map(c => [c._id, c.count]));

    const result = activeRules.map(r => ({
      ruleId: r._id,
      label: r.label,
      group: r.group,
      factor: r.factor,
      claimStrength: r.claimStrength,
      confidenceCap: r.confidenceCap,
      evidenceCount: countsMap.get(r._id) || 0,
      origin: r.origin,
      sourceTitle: r.source?.title || 'Quy luật đã duyệt',
      sourceAuthors: r.source?.author ? [r.source.author] : [],
      sourceYear: r.source?.year || undefined
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

    // Process search query: Trim and cap at 100 characters
    const q = rawQ.trim().substring(0, 100);

    let filter: any = { academicSourceId: source._id };

    if (q) {
      // Escape regex special characters to prevent regex injection or crashing
      const escapedQ = q.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      filter.chunkText = new RegExp(escapedQ, 'i');
    }

    // Pagination setup (limit max 20)
    let page = parseInt(pageStr, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(limitStr, 10);
    if (isNaN(limit) || limit < 1) limit = 10;
    if (limit > 20) limit = 20;

    const skip = (page - 1) * limit;

    const total = await AcademicChunk.countDocuments(filter);

    // Query matching chunks sorted by chunkIndex, omitting embedding array
    const chunks = await AcademicChunk.find(filter)
      .select('_id chunkIndex sectionType sectionTitle pageStart pageEnd sourceOrder chunkText')
      .sort({ chunkIndex: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Map chunkText to a preview only (first 400 characters)
    const formattedChunks = chunks.map((c: any) => {
      const isLong = c.chunkText.length > 400;
      return {
        ...c,
        chunkText: c.chunkText.substring(0, 400) + (isLong ? '...' : ''),
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
 * Create or update an evidence link for a rule.
 * Access: Moderator only
 */
export const createEvidenceLink = async (req: Request, res: Response): Promise<void> => {
  const { ruleId } = req.params;
  const { academicSourceId, academicChunkIds, evidenceRole, relevanceNote } = req.body;
  const moderatorId = req.user?._id;

  if (!moderatorId) {
    res.status(401).json({ success: false, message: 'Unauthorized. User session not found.' });
    return;
  }

  try {
    // 1. Validate Rule
    const rule = await KnowledgeRule.findOne({ _id: ruleId, isActive: true });
    if (!rule) {
      res.status(404).json({ success: false, message: 'Không tìm thấy quy luật này hoặc quy luật không kích hoạt.' });
      return;
    }

    // 2. Validate Source
    if (!academicSourceId || !mongoose.Types.ObjectId.isValid(academicSourceId)) {
      res.status(400).json({ success: false, message: 'Mã định danh tài liệu không hợp lệ.' });
      return;
    }

    const source = await AcademicSource.findById(academicSourceId);
    if (!source) {
      res.status(404).json({ success: false, message: 'Không tìm thấy tài liệu này.' });
      return;
    }

    // Strict eligibility checks
    if (!source.readableInApp || source.fullTextStatus !== 'imported' || source.allowedUse !== 'open_access_fulltext') {
      res.status(400).json({ success: false, message: 'Tài liệu không có bản đọc đầy đủ hợp lệ trong hệ thống.' });
      return;
    }

    if (source.chunkBuildStatus !== 'completed') {
      res.status(400).json({ success: false, message: 'Tài liệu chưa được xây dựng dữ liệu RAG thành công.' });
      return;
    }

    const fullText = await AcademicFullText.findOne({ academicSourceId: source._id });
    if (!fullText) {
      res.status(400).json({ success: false, message: 'Không tìm thấy thông tin bản đọc RAG.' });
      return;
    }

    // 3. Validate Chunks
    if (!Array.isArray(academicChunkIds) || academicChunkIds.length < 1 || academicChunkIds.length > 5) {
      res.status(400).json({ success: false, message: 'Danh sách phân đoạn liên kết phải chứa từ 1 đến 5 phần tử.' });
      return;
    }

    const chunkObjectIds = academicChunkIds.map(id => new mongoose.Types.ObjectId(id));

    // Verify all chunks belong to this source
    const matchedChunks = await AcademicChunk.find({
      _id: { $in: chunkObjectIds },
      academicSourceId: source._id,
    });

    if (matchedChunks.length !== academicChunkIds.length) {
      res.status(400).json({ success: false, message: 'Một hoặc nhiều phân đoạn không thuộc về tài liệu này.' });
      return;
    }

    // Validate evidenceRole
    const allowedRoles = ['primary_support', 'secondary_support', 'background', 'contradiction', 'limitation'];
    if (!allowedRoles.includes(evidenceRole)) {
      res.status(400).json({ success: false, message: 'Vai trò bằng chứng không hợp lệ.' });
      return;
    }

    // 4. Generate quote preview server-side (300-500 characters, e.g. 400)
    // Sort matched chunks by sourceOrder to reconstruct quote logically
    matchedChunks.sort((a, b) => (a.sourceOrder || 0) - (b.sourceOrder || 0));
    const combinedQuoteText = matchedChunks.map(c => c.chunkText).join(' [...] ');
    const maxLen = 400;
    const isTruncated = combinedQuoteText.length > maxLen;
    const quotePreview = combinedQuoteText.substring(0, maxLen).trim() + (isTruncated ? '...' : '');

    // 5. Up-sert logic: Allow only one active link per ruleId + academicSourceId + evidenceRole
    let link = await KnowledgeRuleSource.findOne({
      ruleId,
      academicSourceId: source._id,
      evidenceRole,
      status: 'active',
    });

    if (link) {
      // Update existing
      link.academicChunkIds = chunkObjectIds;
      link.relevanceNote = relevanceNote || undefined;
      link.selectedQuotePreview = quotePreview;
      link.updatedBy = moderatorId;
      link.updatedAt = new Date();
      await link.save();
    } else {
      // Create new
      link = new KnowledgeRuleSource({
        ruleId,
        academicSourceId: source._id,
        academicFullTextId: fullText._id,
        academicChunkIds: chunkObjectIds,
        evidenceRole,
        relevanceNote: relevanceNote || undefined,
        selectedQuotePreview: quotePreview,
        status: 'active',
        linkedBy: moderatorId,
        linkedAt: new Date(),
      });
      await link.save();
    }

    res.status(200).json({
      success: true,
      message: 'Liên kết bằng chứng khoa học thành công.',
      data: link,
    });

  } catch (err: any) {
    console.error('Failed to create/update evidence link:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi tạo liên kết bằng chứng.',
    });
  }
};

/**
 * GET /api/moderation/knowledge-rules/:ruleId/evidence-links
 * List active evidence links for a rule.
 * Access: Moderator only
 */
export const getEvidenceLinks = async (req: Request, res: Response): Promise<void> => {
  const { ruleId } = req.params;

  try {
    const links = await KnowledgeRuleSource.find({ ruleId, status: 'active' })
      .populate({
        path: 'academicSourceId',
        select: 'title authors year doi journal publisher allowedUse copyrightStatus fullTextStatus',
      })
      .populate({
        path: 'academicChunkIds',
        select: 'chunkIndex sectionType sectionTitle pageStart pageEnd sourceOrder chunkText',
      })
      .lean();

    // Truncate populated chunk texts to previews for lightweight transmission
    const formattedLinks = links.map((link: any) => {
      if (Array.isArray(link.academicChunkIds)) {
        link.academicChunkIds = link.academicChunkIds.map((c: any) => {
          if (!c || !c.chunkText) return c;
          const isLong = c.chunkText.length > 400;
          return {
            ...c,
            chunkText: c.chunkText.substring(0, 400) + (isLong ? '...' : ''),
          };
        });
      }
      return link;
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
 * Soft deactivates an evidence link.
 * Access: Moderator only
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

    const link = await KnowledgeRuleSource.findOne({ _id: cleanLinkId, ruleId });
    if (!link) {
      res.status(404).json({ success: false, message: 'Liên kết không tồn tại.' });
      return;
    }

    if (link.status === 'inactive') {
      res.status(400).json({ success: false, message: 'Liên kết này đã bị vô hiệu hóa trước đó.' });
      return;
    }

    // Soft delete / deactivate link
    link.status = 'inactive';
    link.updatedBy = moderatorId;
    link.updatedAt = new Date();
    await link.save();

    res.status(200).json({
      success: true,
      message: 'Hủy liên kết bằng chứng khoa học thành công (đã vô hiệu hóa).',
      data: link,
    });

  } catch (err: any) {
    console.error('Failed to soft delete evidence link:', err);
    res.status(500).json({
      success: false,
      message: 'Có lỗi xảy ra khi hủy liên kết bằng chứng.',
    });
  }
};

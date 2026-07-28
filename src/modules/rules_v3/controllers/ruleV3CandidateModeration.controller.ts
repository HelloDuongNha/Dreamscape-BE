import { Request, Response } from 'express';
import mongoose from 'mongoose';
import AcademicSource from '../../academic/models/AcademicSource';
import KnowledgeRuleV3 from '../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../models/KnowledgeRuleEvidence';
import { parseRuleV3BulkActionRequest } from '../dto';
import {
  approveRuleV3Record,
  reconcileApprovedRuleEvidenceGaps,
} from '../services/moderation/ruleV3Approval.service';

export const approveRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  const existing = await KnowledgeRuleV3.findById(req.params.id);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Không tìm thấy lập luận Rule V3.' });
    return;
  }
  try {
    await approveRuleV3Record(existing);
  } catch (error: any) {
    const messages: Record<string, string> = {
      missing_supporting_citation: 'Không thể duyệt lập luận chưa có trích dẫn hỗ trợ nguyên văn.',
      quality_gate_failed: 'Lập luận chưa vượt qua kiểm tra chất lượng bắt buộc.',
      composite_component_quality_gate_failed: 'Chưa thể duyệt lập luận tổng hợp vì ít nhất một mệnh đề con chưa có dẫn chứng trực tiếp hoặc chưa vượt qua kiểm tra chất lượng.',
      embedding_unavailable: 'Chưa thể tạo chỉ mục truy hồi cho lập luận. Lập luận chưa được duyệt; vui lòng kiểm tra mô hình embedding.',
    };
    res.status(error?.message === 'embedding_unavailable' ? 503 : 422)
      .json({ success: false, message: messages[error?.message] || 'Không thể duyệt lập luận.' });
    return;
  }
  const rule = await KnowledgeRuleV3.findById(existing._id);
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy lập luận Rule V3.' });
    return;
  }
  await reconcileApprovedRuleEvidenceGaps(rule);
  res.status(200).json({ success: true, message: 'Đã duyệt Rule V3.' });
};

export const bulkRuleV3Action = async (req: Request, res: Response): Promise<void> => {
  const { action, confirmation, sourceId } = parseRuleV3BulkActionRequest(req.body);
  const expectedConfirmations: Record<string, string> = {
    approve_pending: 'APPROVE_ALL_PENDING_RULES',
    reject_pending: 'REJECT_ALL_PENDING_RULES',
    restore_rejected: 'RESTORE_ALL_REJECTED_RULES',
    delete_rejected: 'DELETE_ALL_REJECTED_RULES',
  };
  if (!expectedConfirmations[action] || confirmation !== expectedConfirmations[action]) {
    res.status(400).json({ success: false, message: 'Xác nhận thao tác hàng loạt không hợp lệ.' });
    return;
  }
  try {
    const status: 'pending' | 'rejected' = action.includes('pending') ? 'pending' : 'rejected';
    const ids = await loadBulkRuleIds(status, sourceId);
    if (action === 'reject_pending') {
      await KnowledgeRuleV3.updateMany(
        { _id: { $in: ids } },
        { status: 'rejected', $unset: { embedding: 1, embeddingModel: 1 } },
      );
    }
    if (action === 'restore_rejected') {
      await KnowledgeRuleV3.updateMany({ _id: { $in: ids } }, { status: 'pending' });
    }
    if (action === 'delete_rejected') {
      await KnowledgeRuleEvidenceV3.deleteMany({ ruleId: { $in: ids } });
      await KnowledgeRuleV3.deleteMany({ _id: { $in: ids }, status: 'rejected' });
    }

    const failures: Array<{ ruleId: string; reason: string }> = [];
    let processed = action === 'approve_pending' ? 0 : ids.length;
    if (action === 'approve_pending') {
      const rules = await KnowledgeRuleV3.find({ _id: { $in: ids }, status: 'pending' });
      for (const rule of rules) {
        try {
          await approveRuleV3Record(rule);
          const verified = await KnowledgeRuleV3.findById(rule._id);
          if (verified) await reconcileApprovedRuleEvidenceGaps(verified);
          processed += 1;
        } catch (error: any) {
          failures.push({
            ruleId: String(rule._id),
            reason: String(error?.message || 'approval_failed'),
          });
        }
      }
    }
    res.status(200).json({
      success: true,
      data: { processed, failed: failures.length, failures },
    });
  } catch {
    res.status(400).json({
      success: false,
      message: 'Không thể thực hiện thao tác hàng loạt Rule V3.',
    });
  }
};

export const rejectRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  const rule = await KnowledgeRuleV3.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected' },
    { new: true },
  );
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã từ chối Rule V3.' });
};

async function loadBulkRuleIds(
  status: 'pending' | 'rejected',
  sourceId?: string,
): Promise<mongoose.Types.ObjectId[]> {
  if (!sourceId) {
    return (await KnowledgeRuleV3.find({ status }).select('_id').lean()).map(item => item._id);
  }
  if (!mongoose.Types.ObjectId.isValid(sourceId)) throw new Error('invalid_source_id');

  const requestedId = new mongoose.Types.ObjectId(sourceId);
  const aliases = [requestedId];
  const [approved, contribution] = await Promise.all([
    AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
    AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean(),
  ]);
  if (approved?.sourceContributionId) aliases.push(approved.sourceContributionId);
  if (contribution?._id) aliases.push(contribution._id);
  const ownedRuleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', {
    sourceId: { $in: aliases },
  });
  return (
    await KnowledgeRuleV3.find({ _id: { $in: ownedRuleIds }, status }).select('_id').lean()
  ).map(item => item._id);
}

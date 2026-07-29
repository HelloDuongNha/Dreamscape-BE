import { Request, Response } from 'express';
import {
  parseRuleV3BulkActionRequest,
  type RuleV3BulkAction,
} from '../dto';
import {
  applyRuleV3BulkAction,
  approveRuleV3CandidateById,
  rejectRuleV3CandidateById,
} from '../services/moderation/ruleV3Moderation.service';

export const approveRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await approveRuleV3CandidateById(String(req.params.id));
    if (result.evidenceReconciliation === 'failed') {
      res.status(200).json({
        success: true,
        message: 'Đã duyệt Rule V3, nhưng chưa thể đồng bộ các citation liên quan.',
        data: result,
      });
      return;
    }
  } catch (error: any) {
    if (error?.message === 'rule_not_found') {
      res.status(404).json({ success: false, message: 'Không tìm thấy lập luận Rule V3.' });
      return;
    }
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
  res.status(200).json({
    success: true,
    message: 'Đã duyệt Rule V3.',
    data: { evidenceReconciliation: 'completed' },
  });
};

export const bulkRuleV3Action = async (req: Request, res: Response): Promise<void> => {
  const { action, confirmation, sourceId } = parseRuleV3BulkActionRequest(req.body);
  const expectedConfirmations: Record<string, string> = {
    approve_pending: 'APPROVE_ALL_PENDING_RULES',
    reject_pending: 'REJECT_ALL_PENDING_RULES',
    restore_rejected: 'RESTORE_ALL_REJECTED_RULES',
    delete_rejected: 'DELETE_ALL_REJECTED_RULES',
  };
  if (!action || !expectedConfirmations[action] || confirmation !== expectedConfirmations[action]) {
    res.status(400).json({ success: false, message: 'Xác nhận thao tác hàng loạt không hợp lệ.' });
    return;
  }
  const validatedAction = action as RuleV3BulkAction;
  try {
    const result = await applyRuleV3BulkAction({ action: validatedAction, sourceId });
    res.status(200).json({
      success: true,
      data: {
        processed: result.processed,
        failed: result.failures.length,
        failures: result.failures,
        warnings: result.warnings,
      },
    });
  } catch {
    res.status(400).json({
      success: false,
      message: 'Không thể thực hiện thao tác hàng loạt Rule V3.',
    });
  }
};

export const rejectRuleV3Candidate = async (req: Request, res: Response): Promise<void> => {
  try {
    await rejectRuleV3CandidateById(String(req.params.id));
  } catch (error: any) {
    if (error?.message === 'rule_not_found') {
      res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
      return;
    }
    res.status(400).json({ success: false, message: 'Không thể từ chối ứng viên Rule V3.' });
    return;
  }
  res.status(200).json({ success: true, message: 'Đã từ chối Rule V3.' });
};

import { Request, Response } from 'express';
import { parseRuleV3CandidateQuery } from '../dto';
import {
  readRuleV3CandidateDetail,
  readRuleV3Candidates,
} from '../services/moderation/ruleV3CandidateRead.service';

// Trả danh sách lập luận cùng điểm và thống kê phản hồi hiện tại.
export const getRuleV3Candidates = async (req: Request, res: Response): Promise<void> => {
  const parsed = parseRuleV3CandidateQuery(req.query);
  if (parsed.validationError) {
    res.status(400).json({
      success: false,
      code: parsed.validationError,
      message: 'Rule name search must not exceed 120 characters.',
    });
    return;
  }
  try {
    const data = await readRuleV3Candidates(parsed);
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error?.message === 'invalid_source_id') {
      res.status(400).json({ success: false, message: 'Mã tài liệu không hợp lệ.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Không thể tải danh sách ứng viên Rule V3.' });
  }
};

// Trả dẫn chứng và các quan hệ cần thiết cho màn hình duyệt một lập luận.
export const getRuleV3CandidateDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await readRuleV3CandidateDetail(String(req.params.id));
    res.status(200).json({ success: true, data });
  } catch (error: any) {
    if (error?.message === 'candidate_not_found') {
      res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
      return;
    }
    res.status(500).json({ success: false, message: 'Không thể tải chi tiết ứng viên Rule V3.' });
  }
};

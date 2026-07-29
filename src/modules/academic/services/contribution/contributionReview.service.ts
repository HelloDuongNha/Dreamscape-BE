import { Types } from 'mongoose';
import type { SourceReviewInput } from '../../dto/sourceContribution.dto';
import SourceContribution from '../../models/SourceContribution';
import { approveSourceContribution } from './contributionApproval.service';
import { rejectSourceContribution } from './contributionRejection.service';
import { isReaderBuildInProgress } from './contributionApprovalPolicy.service';

export async function reviewSourceContribution(
  id: string,
  reviewerId: Types.ObjectId,
  input: Extract<SourceReviewInput, { valid: true }>,
) {
  const contribution = await SourceContribution.findById(id);
  if (!contribution) {
    return {
      status: 404,
      body: { success: false, message: 'Source contribution not found.' },
    };
  }
  if (contribution.reviewStatus !== 'pending') {
    return {
      status: 409,
      body: {
        success: false,
        message: `This contribution has already been reviewed (status: ${contribution.reviewStatus}).`,
      },
    };
  }
  if (isReaderBuildInProgress(contribution)) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'READER_IMPORT_IN_PROGRESS',
        message: 'Bản đọc thông minh vẫn đang được dựng. Hãy chờ tác vụ hoàn tất trước khi duyệt hoặc từ chối tài liệu.',
      },
    };
  }

  const previousStatus = contribution.reviewStatus;
  if (input.reviewStatus === 'approved') {
    return approveSourceContribution(
      contribution,
      reviewerId,
      input.title,
      input.reviewNote,
      input.reviewNoteProvided,
      previousStatus,
    );
  }
  return rejectSourceContribution(
    contribution,
    reviewerId,
    input.reviewNote,
    input.reviewNoteProvided,
    previousStatus,
  );
}

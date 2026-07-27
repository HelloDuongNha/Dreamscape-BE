import SourceContribution from '../../models/SourceContribution';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { deleteOriginalPdfAsset, hasStoredOriginalPdf } from './originalPdfStorage.service';

export async function deleteContributionOriginalPdf(contributionId: string) {
  const contribution = await SourceContribution.findById(contributionId);
  if (!contribution) {
    return {
      status: 404,
      body: { success: false, message: 'Không tìm thấy đóng góp nguồn.' },
    };
  }
  if (!hasStoredOriginalPdf(contribution.originalFile)) {
    return {
      status: 200,
      body: {
        success: true,
        status: 'no_asset',
        message: 'Không có PDF gốc đã lưu.',
        source: mapSourceOriginAndUrls(contribution),
      },
    };
  }
  try {
    await deleteOriginalPdfAsset(contribution.originalFile);
  } catch {
    return {
      status: 500,
      body: { success: false, message: 'Không thể xóa PDF khỏi kho lưu trữ.' },
    };
  }
  contribution.originalFile = undefined;
  await contribution.save();
  return {
    status: 200,
    body: {
      success: true,
      status: 'deleted',
      message: 'Đã xóa PDF gốc thành công.',
      source: mapSourceOriginAndUrls(contribution),
    },
  };
}

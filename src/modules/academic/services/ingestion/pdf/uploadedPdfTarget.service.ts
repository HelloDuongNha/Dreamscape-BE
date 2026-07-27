import SourceContribution from '../../../models/SourceContribution';
import AcademicSource from '../../../models/AcademicSource';
import type { ISourceContribution } from '../../../models/SourceContribution';
import type { IAcademicSource } from '../../../models/AcademicSource';
import type { UploadedPdfImportInput } from '../../../dto/uploadedPdfImport.dto';
import type { OriginalPdfReference } from '../../storage/originalPdfStorage.service';

export type UploadedPdfTarget = ISourceContribution | IAcademicSource;

export async function requireUploadedPdfTarget(
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
): Promise<UploadedPdfTarget> {
  const target = targetType === 'contribution'
    ? await SourceContribution.findById(targetId)
    : await AcademicSource.findById(targetId);
  if (!target) throw new Error(`Không tìm thấy tài liệu với ID: ${targetId}`);
  return target;
}

export async function setUploadedPdfTargetStatus(
  target: UploadedPdfTarget,
  targetType: UploadedPdfImportInput['targetType'],
  status: NonNullable<ISourceContribution['extractionStatus']>,
): Promise<void> {
  if (targetType !== 'contribution') return;
  const contribution = target as ISourceContribution;
  contribution.extractionStatus = status;
  await contribution.save();
}

export async function applyDoclingMetadataHints(
  target: UploadedPdfTarget,
  targetType: UploadedPdfImportInput['targetType'],
  targetId: string,
  hints?: { title?: string; authors?: string[] },
) {
  let metadataEnriched = false;
  if ((!Array.isArray(target.authors) || target.authors.length === 0) && hints?.authors?.length) {
    target.authors = hints.authors;
    await target.save();
    metadataEnriched = true;
  }
  if (hints?.title && target.title !== hints.title) {
    target = await requireUploadedPdfTarget(targetType, targetId);
  }
  return { target, metadataEnriched };
}

export function getUploadedPdfTargetOwner(target: UploadedPdfTarget) {
  return 'submittedBy' in target ? target.submittedBy : undefined;
}

export function requireUploadedPdfOriginalFile(target: UploadedPdfTarget): OriginalPdfReference {
  if (!target.originalFile) {
    throw new Error('Tài liệu không có tệp PDF gốc được tải lên.');
  }
  return target.originalFile;
}

export function getUploadedPdfTargetIdentifiers(target: UploadedPdfTarget) {
  const detected = 'detectedIdentifiers' in target ? target.detectedIdentifiers : undefined;
  const metadataIsbn = typeof target.metadata?.isbn === 'string' ? target.metadata.isbn : undefined;
  return {
    doi: target.doi || undefined,
    isbn: detected?.isbn || metadataIsbn,
    pmcid: target.pmcid || undefined,
  };
}

import mongoose from 'mongoose';
import {
  SourceImportResolverInput,
  SourceImportResolverResult,
} from '../../dto/sourceImport.dto';
import {
  resolveDoiSource,
  resolveIsbnSource,
  resolvePmcidSource,
} from './sourceIdentifierResolution.service';
import { resolveUploadedPdfSource } from './sourceUploadedPdfResolution.service';
import { resolveWebSource } from './sourceWebResolution.service';

export type {
  SourceImportResolverInput,
  SourceImportResolverResult,
} from '../../dto/sourceImport.dto';

export async function resolveSourceImport(
  input: SourceImportResolverInput,
  userId?: mongoose.Types.ObjectId,
): Promise<SourceImportResolverResult> {
  const warnings: string[] = [];
  const doi = (input.doi || '').trim();
  const pmcidInput = (input.pmcid || '').trim();
  const url = (input.url || '').trim();
  const isbn = (input.isbn || '').trim();

  const pmcid = /^PMC\d+$/i.test(doi)
    ? doi.toUpperCase()
    : /^PMC\d+$/i.test(pmcidInput)
      ? pmcidInput.toUpperCase()
      : '';

  if (pmcid) return resolvePmcidSource(pmcid, warnings);
  if (doi) return resolveDoiSource(doi, warnings);
  if (input.uploadedFileRef) {
    return resolveUploadedPdfSource(input.uploadedFileRef, userId, warnings);
  }
  if (isbn) return resolveIsbnSource(isbn, warnings);
  if (url) return resolveWebSource(url, warnings);

  throw new Error('Dữ liệu yêu cầu giải quyết nguồn trống hoặc không đúng định dạng.');
}

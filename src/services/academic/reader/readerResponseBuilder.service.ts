import mongoose from 'mongoose';
import AcademicSection from '../../../models/AcademicSection';
import AcademicChunk from '../../../models/AcademicChunk';
import { IAcademicDocument } from '../../../models/AcademicDocument';
import { ApiResponseSection } from './canonicalReaderIdentity.types';
import { mapChunkToBlock } from './canonicalReaderIdentity.service';

export { ApiResponseSection };

export async function buildReaderResponse(
  doc: IAcademicDocument,
  skip: number,
  limit: number
): Promise<{ sections: ApiResponseSection[]; total: number }> {
  // Query all sections of the document to build a sectionId -> section mapping
  const sections = await AcademicSection.find({ documentId: doc._id }).sort({ sectionOrder: 1 });
  const sectionMap = new Map<string, typeof sections[0]>();
  for (const sec of sections) {
    sectionMap.set(sec._id.toString(), sec);
  }

  // Count reader chunks
  const total = await AcademicChunk.countDocuments({
    documentId: doc._id,
    chunkPurpose: 'reader'
  });

  // Query paginated reader chunks
  const readerChunks = await AcademicChunk.find({
    documentId: doc._id,
    chunkPurpose: 'reader'
  })
    .sort({ chunkOrder: 1 })
    .skip(skip)
    .limit(limit);

  const apiSections: ApiResponseSection[] = readerChunks.map((chunk, idx) => {
    return mapChunkToBlock(chunk, sectionMap, skip, idx);
  });

  return {
    sections: apiSections,
    total: total
  };
}

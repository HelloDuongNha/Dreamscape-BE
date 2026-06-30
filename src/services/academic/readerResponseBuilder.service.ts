import mongoose from 'mongoose';
import AcademicSection from '../../models/AcademicSection';
import AcademicChunk, { IAcademicChunk } from '../../models/AcademicChunk';
import { IAcademicDocument } from '../../models/AcademicDocument';

export interface ApiResponseSection {
  sectionIndex: number;
  sectionType: string;
  text: string;
  html: string | null;
  marker: string | null;
  pageStart: number;
  pageEnd: number;
}

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
    const parentSec = sectionMap.get(chunk.sectionId.toString());
    const sectionType = chunk.blockType || (parentSec ? parentSec.sectionType : 'paragraph');

    return {
      sectionIndex: skip + idx,
      sectionType: sectionType,
      text: chunk.text,
      html: chunk.html || null,
      marker: chunk.marker || null,
      pageStart: 1, // Will fall back to page break tags or standard pagination on client
      pageEnd: 1
    };
  });

  return {
    sections: apiSections,
    total: total
  };
}

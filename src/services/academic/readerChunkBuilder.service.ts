import mongoose from 'mongoose';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import AcademicChunk from '../../models/AcademicChunk';
import { CanonicalBlock } from './types';
import { buildAndSaveRagChunks } from './ragChunkBuilder.service';

export async function buildAndSaveSmartReaderData(
  source: any,
  title: string,
  blocks: CanonicalBlock[],
  parserEngine: string,
  sourceType: string,
  isContribution = false
): Promise<{ ragChunkCount: number; embedModel: string }> {
  // Filter out any blocks duplicate of the main title (excluding the actual title block)
  const normalizeString = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  const stripHtml = (htmlStr: string) => htmlStr.replace(/<\/?[^>]+(>|$)/g, "");
  const normTitle = normalizeString(title);

  const cleanBlocks = blocks.map(b => ({
    ...b,
    text: String(b.text || '').trim(),
    html: String(b.html || '')
  })).filter(b => {
    // AcademicChunk.text is required. Empty layout artifacts must be rejected
    // before any existing reader data is touched.
    if (!b.text) return false;
    if (b.blockType === 'title') return true;
    const normText = normalizeString(b.text);
    const normHtmlText = normalizeString(stripHtml(b.html));
    return normText !== normTitle && normHtmlText !== normTitle;
  });

  if (cleanBlocks.length === 0) {
    throw new Error('Không có block nội dung hợp lệ để tạo Bản đọc thông minh.');
  }

  const session = await mongoose.startSession();
  let useTransaction = false;
  try {
    const hello = await mongoose.connection.db?.command({ hello: 1 }).catch(() => null);
    if (hello && (hello.setName || hello.msg === 'isdbgrid')) {
      useTransaction = true;
    }
  } catch (e) {
    useTransaction = false;
  }

  let ragChunkCount = 0;
  const documentSelector = isContribution
    ? { previewContributionId: source._id }
    : { sourceId: source._id };

  const captureExistingReader = async () => {
    const documents = await AcademicDocument.find(documentSelector).lean();
    const documentIds = documents.map(doc => doc._id);
    if (documentIds.length === 0) return { documents: [], sections: [], chunks: [] };
    const [sections, chunks] = await Promise.all([
      AcademicSection.find({ documentId: { $in: documentIds } }).lean(),
      AcademicChunk.find({ documentId: { $in: documentIds } }).lean()
    ]);
    return { documents, sections, chunks };
  };

  const deleteCurrentReader = async (session?: mongoose.ClientSession) => {
    const opt = session ? { session } : {};
    const documents = await AcademicDocument.find(documentSelector).session(session || null);
    const documentIds = documents.map(doc => doc._id);
    if (documentIds.length > 0) {
      await AcademicSection.deleteMany({ documentId: { $in: documentIds } }, opt);
      await AcademicChunk.deleteMany({ documentId: { $in: documentIds } }, opt);
    }
    await AcademicDocument.deleteMany(documentSelector, opt);
  };

  const restoreReaderBackup = async (backup: Awaited<ReturnType<typeof captureExistingReader>>) => {
    await deleteCurrentReader();
    if (backup.documents.length > 0) await AcademicDocument.insertMany(backup.documents);
    if (backup.sections.length > 0) await AcademicSection.insertMany(backup.sections);
    if (backup.chunks.length > 0) await AcademicChunk.insertMany(backup.chunks);
  };

  const executeSave = async () => {
    const opt = useTransaction ? { session } : {};

    // 1. Delete existing documents, sections, and chunks for this source
    await deleteCurrentReader(useTransaction ? session : undefined);

    // 2. Map blocks to sections and build AcademicSection list
    const sectionIds: mongoose.Types.ObjectId[] = [];
    const sectionMap = new Map<string, mongoose.Types.ObjectId>();
    const sectionDocs: any[] = [];

    // Group blocks by section headings to preserve hierarchies
    const headingBlocks = cleanBlocks.filter(b => b.blockType === 'heading');
    if (headingBlocks.length === 0) {
      // Default fallback section if no headings exist
      const defaultSecId = new mongoose.Types.ObjectId();
      sectionIds.push(defaultSecId);
      sectionDocs.push(new AcademicSection({
        _id: defaultSecId,
        sourceId: isContribution ? undefined : source._id,
        previewContributionId: isContribution ? source._id : undefined,
        heading: 'Introduction',
        sectionType: 'heading',
        sectionOrder: 0,
        chunkIds: []
      }));
      sectionMap.set('Introduction', defaultSecId);
    } else {
      headingBlocks.forEach((h, idx) => {
        const secId = new mongoose.Types.ObjectId();
        sectionIds.push(secId);
        sectionDocs.push(new AcademicSection({
          _id: secId,
          sourceId: isContribution ? undefined : source._id,
          previewContributionId: isContribution ? source._id : undefined,
          heading: h.text,
          sectionType: 'heading',
          sectionOrder: idx,
          chunkIds: []
        }));
        sectionMap.set(h.text, secId);
      });
    }

    // Create the canonical AcademicDocument
    const docId = new mongoose.Types.ObjectId();
    const academicDoc = new AcademicDocument({
      _id: docId,
      sourceId: isContribution ? undefined : source._id,
      previewContributionId: isContribution ? source._id : undefined,
      parserVersion: 1,
      parserEngine: parserEngine,
      sectionIds: sectionIds
    });

    // Link sections to document
    sectionDocs.forEach(s => {
      s.documentId = docId;
    });

    // 3. Build reader chunks list
    const readerChunks: any[] = [];
    let globalReaderOrder = 0;

    for (let bIdx = 0; bIdx < cleanBlocks.length; bIdx++) {
      const b = cleanBlocks[bIdx];
      const headingKey = b.sectionHeading || sectionDocs[0]?.heading || 'Introduction';
      const secId = sectionMap.get(headingKey) || sectionDocs[0]?._id;

      const chunkId = new mongoose.Types.ObjectId();
      const wordCount = b.text.split(/\s+/).filter(Boolean).length;

      readerChunks.push({
        _id: chunkId,
        sourceId: isContribution ? undefined : source._id,
        previewContributionId: isContribution ? source._id : undefined,
        chunkPurpose: 'reader',
        documentId: docId,
        sectionId: secId,
        text: b.text,
        html: b.html,
        tableData: b.tableData,
        marker: b.marker,
        blockType: b.blockType,
        tokenCount: Math.round(wordCount * 1.3) || 1,
        sectionOrder: sectionDocs.findIndex(s => s._id.toString() === secId.toString()),
        chunkOrder: globalReaderOrder++
      });

      // Link chunk to parent section
      const targetSec = sectionDocs.find(s => s._id.toString() === secId.toString());
      if (targetSec) {
        targetSec.chunkIds.push(chunkId);
      }
    }

    // Save Doc and Sections
    await academicDoc.save(opt);
    for (const sec of sectionDocs) {
      await sec.save(opt);
    }

    // Save reader chunks
    if (readerChunks.length > 0) {
      await AcademicChunk.insertMany(readerChunks, opt);
    }

    // 4. Delegate overlapping RAG chunks build
    ragChunkCount = await buildAndSaveRagChunks(
      docId,
      sectionDocs,
      cleanBlocks,
      isContribution ? undefined : source._id,
      isContribution ? source._id : undefined,
      useTransaction ? session : undefined
    );
  };

  try {
    if (useTransaction) {
      await session.withTransaction(executeSave);
    } else {
      const backup = await captureExistingReader();
      try {
        await executeSave();
      } catch (saveError: any) {
        try {
          await restoreReaderBackup(backup);
        } catch (restoreError: any) {
          throw new Error(`Lỗi nghiêm trọng: không thể lưu reader mới và cũng không thể khôi phục reader cũ (${restoreError.message}).`);
        }
        throw saveError;
      }
    }
  } finally {
    session.endSession();
  }

  return {
    ragChunkCount,
    embedModel: 'nomic-embed-text:latest'
  };
}

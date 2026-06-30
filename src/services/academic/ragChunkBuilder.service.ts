import mongoose from 'mongoose';
import AcademicChunk from '../../models/AcademicChunk';
import { generateEmbedding } from '../llm.service';
import { CanonicalBlock } from './types';

export async function buildAndSaveRagChunks(
  docId: mongoose.Types.ObjectId,
  sections: any[],
  blocks: CanonicalBlock[],
  sourceId?: mongoose.Types.ObjectId,
  previewContributionId?: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
): Promise<number> {
  const opt = session ? { session } : {};

  // Build section ID map and order list
  const sectionMap = new Map<string, { id: mongoose.Types.ObjectId; index: number }>();
  sections.forEach((sec, idx) => {
    sectionMap.set(sec.heading || '', { id: sec._id, index: idx });
  });

  const ragChunks: any[] = [];
  let globalRagOrder = 0;

  // Filter out metadata and references blocks for RAG indexing
  const filteredBlocks = blocks.filter(b => b.blockType !== 'metadata' && b.blockType !== 'reference');

  let accumulatedBlocks: CanonicalBlock[] = [];
  let accumulatedWordCount = 0;

  const flushAccumulated = async () => {
    if (accumulatedBlocks.length === 0) return;

    const joinedText = accumulatedBlocks.map(b => b.text).join('\n\n');
    let chunkText = joinedText;
    const firstBlock = accumulatedBlocks[0];
    if (firstBlock.sectionHeading) {
      chunkText = `[Heading: ${firstBlock.sectionHeading}]\n\n${joinedText}`;
    }

    if (chunkText.length > 8000) {
      chunkText = chunkText.substring(0, 8000);
    }

    const wordCount = chunkText.split(/\s+/).filter(Boolean).length;

    if (wordCount >= 40) {
      const secInfo = sectionMap.get(firstBlock.sectionHeading || '') || { id: firstBlock.sectionHeading ? new mongoose.Types.ObjectId() : sections[0]?._id, index: 0 };
      const embedding = await generateEmbedding(chunkText).catch(() => null);

      if (embedding && Array.isArray(embedding) && embedding.length === 768) {
        ragChunks.push({
          sourceId,
          previewContributionId,
          chunkPurpose: 'rag',
          documentId: docId,
          sectionId: secInfo.id,
          sectionOrder: secInfo.index,
          chunkOrder: globalRagOrder++,
          text: chunkText,
          embedding,
          tokenCount: Math.round(wordCount * 1.3) || 1
        });
      }
    }

    accumulatedBlocks = [];
    accumulatedWordCount = 0;
  };

  for (let i = 0; i < filteredBlocks.length; i++) {
    const b = filteredBlocks[i];
    if (b.blockType === 'heading') {
      await flushAccumulated();
    } else {
      const blockWords = b.text.split(/\s+/).filter(Boolean).length;
      if (blockWords > 1200) {
        await flushAccumulated();
        // Handle giant paragraph by chunking with 150-word overlap
        const words = b.text.split(/\s+/).filter(Boolean);
        let startIdx = 0;
        while (startIdx < words.length) {
          let endIdx = startIdx + 1000;
          if (endIdx > words.length) endIdx = words.length;

          const subText = words.slice(startIdx, endIdx).join(' ');
          let chunkText = subText;
          if (b.sectionHeading) {
            chunkText = `[Heading: ${b.sectionHeading}]\n\n${subText}`;
          }

          if (chunkText.length > 8000) {
            chunkText = chunkText.substring(0, 8000);
          }

          const subWordCount = chunkText.split(/\s+/).filter(Boolean).length;
          if (subWordCount >= 80) {
            const secInfo = sectionMap.get(b.sectionHeading || '') || { id: sections[0]?._id, index: 0 };
            const embedding = await generateEmbedding(chunkText).catch(() => null);

            if (embedding && Array.isArray(embedding) && embedding.length === 768) {
              ragChunks.push({
                sourceId,
                previewContributionId,
                chunkPurpose: 'rag',
                documentId: docId,
                sectionId: secInfo.id,
                sectionOrder: secInfo.index,
                chunkOrder: globalRagOrder++,
                text: chunkText,
                embedding,
                tokenCount: Math.round(subWordCount * 1.3) || 1
              });
            }
          }

          if (endIdx === words.length) break;
          startIdx += 850; // 150-word overlap
        }
      } else {
        if (accumulatedWordCount + blockWords > 1200) {
          await flushAccumulated();
        }
        accumulatedBlocks.push(b);
        accumulatedWordCount += blockWords;
      }
    }
  }

  await flushAccumulated();

  if (ragChunks.length > 0) {
    await AcademicChunk.insertMany(ragChunks, opt);
  }

  return ragChunks.length;
}

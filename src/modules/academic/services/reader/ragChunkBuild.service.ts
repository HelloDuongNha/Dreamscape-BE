import mongoose from 'mongoose';
import { generateEmbedding } from '../../../../infrastructure/llm.service';
import AcademicChunk from '../../models/AcademicChunk';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import { planRagChunks } from './ragChunkPlanning.service';

export interface RagChunkBuildResult {
  status: number;
  body: Record<string, unknown>;
}

async function loadBuildContext(sourceId: string): Promise<RagChunkBuildResult | any> {
  let source = await AcademicSource.findById(sourceId);
  let contribution = false;
  if (!source) {
    source = await SourceContribution.findById(sourceId);
    contribution = Boolean(source);
  }
  if (!source) {
    return { status: 404, body: { success: false, message: 'Không tìm thấy tài liệu này.' } };
  }
  if (source.allowedUse !== 'open_access_fulltext') {
    return {
      status: 400,
      body: { success: false, message: 'Tài liệu không hỗ trợ RAG (Metadata only).' },
    };
  }
  if (source.fullTextStatus !== 'imported' || !source.readableInApp) {
    return {
      status: 400,
      body: { success: false, message: 'Tài liệu chưa được nhập bản đọc đầy đủ.' },
    };
  }

  const document = contribution
    ? await AcademicDocument.findOne({ previewContributionId: source._id })
    : await AcademicDocument.findOne({ sourceId: source._id });
  if (!document) {
    return {
      status: 400,
      body: { success: false, message: 'Không tìm thấy thông tin bản đọc đầy đủ.' },
    };
  }
  return { source, contribution, document };
}

async function createEmbeddedChunks(context: any, planned: any[], model: string) {
  const chunks: any[] = [];
  const sectionCounts = new Map<string, number>();
  for (let index = 0; index < planned.length; index++) {
    const item = planned[index];
    const embedding = await generateEmbedding(item.text);
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      throw new Error('Định dạng embedding không hợp lệ từ dịch vụ Ollama.');
    }
    const wordCount = item.text.split(/\s+/).filter(Boolean).length;
    const sectionKey = item.sectionId.toString();
    const sectionOrder = sectionCounts.get(sectionKey) || 0;
    sectionCounts.set(sectionKey, sectionOrder + 1);
    const id = new mongoose.Types.ObjectId();

    chunks.push({
      _id: id,
      sourceId: context.contribution ? undefined : context.source._id,
      previewContributionId: context.contribution ? context.source._id : undefined,
      chunkPurpose: 'rag',
      documentId: context.document._id,
      sectionId: item.sectionId,
      sectionOrder,
      chunkOrder: index,
      text: item.text,
      embedding,
      tokenCount: Math.round(wordCount * 1.3),
      academicSourceId: context.contribution ? undefined : context.source._id,
      academicFullTextId: context.document._id,
      academicFullTextSectionId: item.sectionId,
      chunkIndex: index,
      chunkText: item.text,
      sectionType: item.sectionType,
      sectionTitle: item.sectionTitle,
      pageStart: item.pageStart,
      pageEnd: item.pageEnd,
      embeddingModel: model,
      characterCount: item.text.length,
      wordCount,
      tokenEstimate: Math.round(wordCount * 1.3),
      sourceOrder: index,
    });
  }
  return chunks;
}

function safeBuildError(error: any): string {
  const allowed = [
    'Tài liệu quá dài để xây dựng dữ liệu RAG trong phiên bản hiện tại.',
    'Tài liệu không chứa phân đoạn văn bản nào.',
    'Tài liệu không chứa phân đoạn hợp lệ để xây dựng dữ liệu RAG.',
    'Không có nội dung văn bản hợp lệ để xây dựng dữ liệu RAG.',
  ];
  return allowed.includes(error.message)
    ? error.message
    : 'Không thể tạo embedding. Vui lòng kiểm tra Ollama và model embedding.';
}

export async function buildRagChunks(sourceId: string): Promise<RagChunkBuildResult> {
  const context = await loadBuildContext(sourceId);
  if (context.status) return context;
  const { source, contribution, document } = context;
  if (!contribution) {
    source.chunkBuildStatus = 'building';
    await source.save();
  }

  try {
    const rawSections = await AcademicSection.find({ documentId: document._id });
    const sections = (document.sectionIds || [])
      .map((id: any) => rawSections.find(section => section._id.toString() === id.toString()))
      .filter(Boolean);
    const planned = planRagChunks(sections);
    const model = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
    const chunks = await createEmbeddedChunks(context, planned, model);
    if (contribution) {
      await AcademicChunk.deleteMany({
        previewContributionId: source._id,
        chunkPurpose: 'rag',
      });
    } else {
      await AcademicChunk.deleteMany({ sourceId: source._id, chunkPurpose: 'rag' });
    }
    await AcademicChunk.insertMany(chunks);

    if (!contribution) {
      source.chunkBuildStatus = 'completed';
      source.chunkBuiltAt = new Date();
      source.chunkEmbeddingModel = model;
      source.chunkCount = chunks.length;
      source.chunkBuildError = undefined;
      await source.save();
    }
    return {
      status: 200,
      body: {
        success: true,
        message: 'Xây dựng dữ liệu RAG thành công.',
        data: { chunkCount: chunks.length, embeddingModel: model },
      },
    };
  } catch (error: any) {
    console.error('Error during RAG build inner process:', error);
    const message = safeBuildError(error);
    source.chunkBuildStatus = 'failed';
    source.chunkBuildError = message;
    await source.save();
    return { status: 500, body: { success: false, message } };
  }
}

import mongoose from 'mongoose';
import AcademicSource from '../../models/AcademicSource';
import SourceContribution from '../../models/SourceContribution';
import AcademicDocument from '../../models/AcademicDocument';
import AcademicSection from '../../models/AcademicSection';
import AcademicChunk from '../../models/AcademicChunk';
import { profileDocument, routeExtractionStrategy } from './documentProfiler.service';
import { planEvidenceBatches } from './evidenceBatchPlanner.service';
import { inferDocumentLanguage, normalizeDocumentLanguage } from './documentLanguage.service';
import { planHierarchicalEvidence } from './hierarchicalEvidencePlanner.service';

export async function buildRuleV3PlanPreviewRaw(inputId: string) {
  if (!mongoose.Types.ObjectId.isValid(inputId)) throw new Error('ID tài liệu không hợp lệ.');

  const objectId = new mongoose.Types.ObjectId(inputId);
  const approved = await AcademicSource.findById(objectId).lean();
  const contribution = approved
    ? await SourceContribution.findById(approved.sourceContributionId).lean()
    : await SourceContribution.findById(objectId).lean();
  const document = approved
    ? await AcademicDocument.findOne({ sourceId: approved._id }).lean()
    : await AcademicDocument.findOne({ previewContributionId: objectId }).lean();

  if (!document) throw new Error('Tài liệu chưa có Bản đọc thông minh để lập kế hoạch phân tích.');
  const [sections, chunks] = await Promise.all([
    AcademicSection.find({ documentId: document._id }).sort({ sectionOrder: 1 }).lean(),
    AcademicChunk.find({ documentId: document._id, chunkPurpose: 'reader' }).sort({ chunkOrder: 1 }).lean(),
  ]);
  if (!sections.length || !chunks.length) throw new Error('Bản đọc chưa có section hoặc chunk hợp lệ.');

  const chunksBySection = new Map<string, typeof chunks>();
  for (const chunk of chunks) {
    const key = String(chunk.sectionId);
    if (!chunksBySection.has(key)) chunksBySection.set(key, []);
    chunksBySection.get(key)!.push(chunk);
  }
  const source: any = approved || contribution || {};
  const metadata: any = source.metadata || {};
  const sourceLanguage = normalizeDocumentLanguage(source.detectedLanguage || metadata.language)
    || inferDocumentLanguage(chunks.slice(0, 30).map(chunk => chunk.text));
  const profile = profileDocument({
    documentId: String(document._id),
    parserEngine: document.parserEngine,
    source: {
      sourceQuality: approved?.sourceQuality,
      extractionMethod: source.extractionMethod,
      extractionQuality: source.extractionQuality,
      detectedLanguage: sourceLanguage,
      abstract: approved?.abstract || metadata.abstract,
      title: source.title || metadata.title,
      journal: approved?.journal || metadata.journal,
      metadata,
    },
    sections: sections.map(section => {
      const sectionChunks = chunksBySection.get(String(section._id)) || [];
      return {
        sectionId: String(section._id),
        heading: section.heading,
        sectionType: section.sectionType,
        sectionOrder: section.sectionOrder,
        chunkCount: sectionChunks.length,
        chunkTextSample: sectionChunks.slice(0, 2).map(chunk => chunk.text.slice(0, 2000)),
      };
    }),
  });
  const extractionPlan = routeExtractionStrategy(profile);
  const evidencePlan = planEvidenceBatches(
    extractionPlan,
    chunks
      .filter(chunk => !['heading', 'metadata', 'reference', 'reference_item', 'page_break'].includes(String(chunk.blockType || '')))
      .map(chunk => ({
        chunkId: String(chunk._id),
        sectionId: String(chunk.sectionId),
        chunkOrder: chunk.chunkOrder,
        text: chunk.text,
      }))
  );

  const hierarchicalPlan = planHierarchicalEvidence(profile, extractionPlan, evidencePlan);

  return {
    approved,
    contribution,
    document,
    sections,
    chunks,
    source,
    metadata,
    profile,
    extractionPlan,
    evidencePlan,
    hierarchicalPlan
  };
}

export async function buildRuleV3PlanPreview(inputId: string) {
  const raw = await buildRuleV3PlanPreviewRaw(inputId);
  const { approved, contribution, document, sections, chunks, source, metadata, profile, extractionPlan, evidencePlan, hierarchicalPlan } = raw;

  return {
    sourceId: String(approved?._id || contribution?._id || inputId),
    title: source.title || metadata.title || 'Tài liệu không có tiêu đề',
    profile,
    extractionPlan,
    evidencePlan: {
      ...evidencePlan,
      batches: evidencePlan.batches.map(batch => ({
        batchId: batch.batchId,
        strategy: batch.strategy,
        sourceLanguage: batch.sourceLanguage,
        characterCount: batch.characterCount,
        pageStart: batch.pageStart,
        pageEnd: batch.pageEnd,
        oversizedSingleChunk: batch.oversizedSingleChunk,
        chunkIds: batch.chunks.map(chunk => chunk.chunkId),
        sectionRoles: [...new Set(batch.chunks.map(chunk => chunk.sectionRole))],
      })),
    },
    hierarchicalPlan,
    readerInput: {
      documentId: String(document._id),
      parserEngine: document.parserEngine || 'unknown',
      documentUpdatedAt: document.updatedAt ? new Date(document.updatedAt).toISOString() : null,
      sectionCount: sections.length,
      readerChunkCount: chunks.length,
    },
    safety: {
      readOnly: true,
      llmCalled: false,
      databaseWrites: 0,
      ruleCandidatesCreated: 0,
    },
  };
}

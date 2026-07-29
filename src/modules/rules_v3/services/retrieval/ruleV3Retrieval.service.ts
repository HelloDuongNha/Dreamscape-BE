import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import AcademicChunk from '../../../academic/models/AcademicChunk';
import AcademicSource from '../../../academic/models/AcademicSource';
import SourceContribution from '../../../academic/models/SourceContribution';
import { isValidObjectId } from 'mongoose';
import { generateEmbedding } from '../../../../infrastructure/llm.service';
import { classifyRuleV3DreamApplication } from './ruleV3DreamApplication.service';
import { expandDreamRetrievalConcepts } from './ruleV3RetrievalFeatures.service';
import {
  classifyRuleApplicationTier,
  inferRuleQueryLanguage,
  rankRuleV3Candidates,
} from './ruleV3RetrievalRanking.service';

export async function retrieveApprovedRuleV3(dreamText: string, limit = 4) {
  // All verified arguments may be retrieved for case-level questions. The
  // stored score already includes canonical source evidence and deduplicated
  // user validation, so retrieval must not add a second feedback signal.
  const rules = await KnowledgeRuleV3.find({
    status: 'verified',
    embedding: { $exists: true, $ne: [] },
  }).lean();
  if (!rules.length) return { rules: [], evidenceLinks: [] };
  const ownerToPrimaryRuleId = new Map<string, string>();
  for (const rule of rules) {
    const primaryId = String(rule._id);
    ownerToPrimaryRuleId.set(primaryId, primaryId);
    for (const component of rule.compositeComponents || []) {
      if (component?.sourceRuleId) ownerToPrimaryRuleId.set(String(component.sourceRuleId), primaryId);
    }
  }
  const expandedDreamText = expandDreamRetrievalConcepts(dreamText);
  const dreamEmbedding = await generateEmbedding(expandedDreamText);
  const queryLanguage = inferRuleQueryLanguage(dreamText);
  const ranked = rankRuleV3Candidates(rules, dreamText, dreamEmbedding, queryLanguage).slice(0, limit);
  if (!ranked.length) return { rules: [], evidenceLinks: [] };

  const rankedOwnerToPrimary = new Map<string, string>();
  for (const item of ranked) {
    const primaryId = String(item.rule._id);
    rankedOwnerToPrimary.set(primaryId, primaryId);
    for (const component of item.rule.compositeComponents || []) {
      if (component?.sourceRuleId) rankedOwnerToPrimary.set(String(component.sourceRuleId), primaryId);
    }
  }
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: [...rankedOwnerToPrimary.keys()] }, stance: 'supports' }).lean();
  const chunkIds = evidence.map(item => item.chunkId);
  const chunks = await AcademicChunk.find({ _id: { $in: chunkIds } }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceAliases = [...new Set([
    ...evidence.map(item => item.sourceId),
    ...chunks.flatMap(chunk => [chunk.sourceId, chunk.previewContributionId]),
  ]
    .map(value => String(value || '').trim())
    .filter(value => isValidObjectId(value)))];
  const [academicSources, contributedSources] = await Promise.all([
    AcademicSource.find({
      $or: [
        { _id: { $in: sourceAliases } },
        { sourceContributionId: { $in: sourceAliases } },
      ],
    }).lean(),
    SourceContribution.find({ _id: { $in: sourceAliases } }).lean(),
  ]);
  const sourceMap = new Map<string, any>();
  for (const source of [...academicSources, ...contributedSources]) {
    const sourceRecord: any = source;
    sourceMap.set(String(sourceRecord._id), sourceRecord);
    if (sourceRecord.sourceContributionId) {
      sourceMap.set(String(sourceRecord.sourceContributionId), sourceRecord);
    }
  }

  const mappedRules = ranked.map(({ rule, score, vector, lexical, featureOverlap, statementOverlap }) => {
    const evidenceScore = Number(rule.evidenceScore) || 0;
    const supportingSourceCount = Number(rule.supportingSourceCount) || 0;
    const applicationTier = classifyRuleApplicationTier(rule);
    return ({
    _id: rule._id,
    ruleId: String(rule._id),
    ruleCode: rule.ruleCode,
    ruleStatement: rule.statement,
    scientificBasis: 'Rule V3 with exact canonical citations',
    classifications: rule.classifications || [],
    confidenceCap: applicationTier === 'supported'
      ? Math.min(0.9, Math.max(0.35, evidenceScore / 100))
      : Math.min(0.35, Math.max(0.1, evidenceScore / 100)),
    evidenceScore,
    supportingSourceCount,
    applicationTier,
    claimStrength: rule.evidenceInterpretation,
    group: 'dream_psychology',
    factor: rule.subject,
    outcome: rule.outcome,
    conditions: rule.conditions || [],
    limitations: rule.limitations || [],
    dreamFeatureTags: rule.dreamFeatureTags || [],
    retrievalScore: score,
    retrievalSignals: { vector, lexical, featureOverlap, statementOverlap },
    applicationRole: classifyRuleV3DreamApplication(rule),
    isComposite: Boolean(rule.isComposite),
    compositeComponents: (rule.compositeComponents || []).map((component: any) => ({
      sourceRuleId: String(component.sourceRuleId),
      ruleCode: component.ruleCode,
      statement: component.statement,
      subject: component.subject,
      outcome: component.outcome,
      conditions: component.conditions || [],
      limitations: component.limitations || [],
      dreamFeatureTags: component.dreamFeatureTags || [],
    })),
    ruleVersion: 'v3'
  });
  });
  const evidenceLinks = evidence.flatMap(item => {
    const chunk: any = chunkMap.get(String(item.chunkId));
    const source: any = sourceMap.get(String(chunk?.sourceId))
      || sourceMap.get(String(chunk?.previewContributionId))
      || sourceMap.get(String(item.sourceId));
    if (!source?._id) return [];
    return [{
      ruleId: rankedOwnerToPrimary.get(String(item.ruleId)) || item.ruleId,
      componentRuleId: item.ruleId,
      quote: item.exactQuote,
      evidenceSummary: item.exactQuote,
      chunkId: {
        _id: item.chunkId,
        text: chunk?.text || item.exactQuote,
        sourceId: {
          _id: source._id,
          title: source?.title || source?.metadata?.title || 'Tài liệu chưa xác định',
          authors: source?.authors || source?.metadata?.authors || [],
          year: source?.year || source?.metadata?.year,
          journal: source?.journal || source?.publisher,
          doi: source?.doi || source?.metadata?.doi,
          readableInApp: true,
          allowedUse: 'open_access_fulltext',
          chunkBuildStatus: 'completed'
        }
      }
    }];
  });
  return { rules: mappedRules, evidenceLinks };
}

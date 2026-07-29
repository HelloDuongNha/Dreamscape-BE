import { Types } from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import SourceContribution from '../../../academic/models/SourceContribution';
import Dream from '../../../dream/models/Dream';
import KnowledgeRuleEvidenceV3 from '../../../rules_v3/models/KnowledgeRuleEvidence';
import RuleValidationFeedback from '../../../rules_v3/models/RuleValidationFeedback';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';

export interface OracleSourceInvalidationPlan {
  sourceIds: string[];
  sourceDois: string[];
  turnIds: Types.ObjectId[];
  dreamIds: Types.ObjectId[];
  ruleIds: string[];
  quoteHashes: string[];
  feedbackRuleIds: string[];
}

// Collects every reference that must be reverted before source deletion.
export async function prepareOracleSourceInvalidation(
  sourceIds: string[],
): Promise<OracleSourceInvalidationPlan> {
  const requestedSourceIds = [...new Set(sourceIds.map(String).filter(Boolean))];
  const objectRequestedIds = requestedSourceIds
    .filter(Types.ObjectId.isValid)
    .map((sourceId) => new Types.ObjectId(sourceId));
  const [sources, contributions] = await Promise.all([
    AcademicSource.find({
      $or: [
        { _id: { $in: objectRequestedIds } },
        { sourceContributionId: { $in: objectRequestedIds } },
      ],
    }).select('_id sourceContributionId doi normalizedDoi').lean(),
    SourceContribution.find({ _id: { $in: objectRequestedIds } })
      .select('_id duplicateOf doi normalizedDoi')
      .lean(),
  ]);
  const normalizedSourceIds = [...new Set([
    ...requestedSourceIds,
    ...sources.flatMap((source) => [
      String(source._id),
      String(source.sourceContributionId || ''),
    ]),
    ...contributions.flatMap((contribution) => [
      String(contribution._id),
      String((contribution as any).duplicateOf || ''),
    ]),
  ].filter(Boolean))];
  const sourceDois = [...new Set([
    ...sources.flatMap((source) => [source.normalizedDoi, source.doi]),
    ...contributions.flatMap((contribution) => [
      contribution.normalizedDoi,
      contribution.doi,
    ]),
  ].map(normalizeDoi).filter(Boolean))];
  const objectSourceIds = normalizedSourceIds
    .filter(Types.ObjectId.isValid)
    .map((sourceId) => new Types.ObjectId(sourceId));
  const dreamSourceConditions = buildDreamSourceConditions(
    normalizedSourceIds,
    sourceDois,
  );
  const [evidence, turnCandidates, dreams] = await Promise.all([
    KnowledgeRuleEvidenceV3.find({ sourceId: { $in: objectSourceIds } })
      .select('ruleId quoteHash')
      .lean(),
    OracleTurn.find({ 'citations.sourceId': { $in: normalizedSourceIds } })
      .select('_id threadId')
      .lean(),
    Dream.find({ $or: dreamSourceConditions }).select('_id').lean(),
  ]);
  const activeThreadIds = new Set((await OracleThread.find({
    _id: { $in: turnCandidates.map((turn) => (turn as any).threadId) },
    deletedAt: { $exists: false },
  }).select('_id').lean()).map((thread) => String(thread._id)));
  const turns = turnCandidates.filter(
    (turn: any) => activeThreadIds.has(String(turn.threadId)),
  );
  const touchedRuleIds = [...new Set(
    evidence.map((item) => String(item.ruleId)).filter(Types.ObjectId.isValid),
  )];
  const remainingEvidence = touchedRuleIds.length
    ? await KnowledgeRuleEvidenceV3.find({
      ruleId: { $in: touchedRuleIds.map((ruleId) => new Types.ObjectId(ruleId)) },
      sourceId: { $nin: objectSourceIds },
      stance: 'supports',
    }).select('ruleId').lean()
    : [];
  const ruleIds = selectRulesLosingAllSupport(touchedRuleIds, remainingEvidence);
  const quoteHashes = [...new Set(evidence.map((item) => String(item.quoteHash)).filter(Boolean))];
  const feedback = quoteHashes.length
    ? await RuleValidationFeedback.find({
      evidenceQuoteHashes: { $in: quoteHashes },
    }).select('impacts.ruleId').lean()
    : [];
  return {
    sourceIds: normalizedSourceIds,
    sourceDois,
    turnIds: turns.map((turn) => turn._id as Types.ObjectId),
    dreamIds: dreams.map((dream) => dream._id as Types.ObjectId),
    ruleIds,
    quoteHashes,
    feedbackRuleIds: [...new Set(feedback.flatMap((row) =>
      (row.impacts || []).map((impact) => impact.ruleId)))],
  };
}

// A shared rule is invalidated only when no other source still supports it.
export function selectRulesLosingAllSupport(
  touchedRuleIds: string[],
  remainingEvidence: Array<{ ruleId: unknown }>,
): string[] {
  const remainingRuleIds = new Set(
    remainingEvidence.map((item) => String(item.ruleId)).filter(Boolean),
  );
  return touchedRuleIds.filter((ruleId) => !remainingRuleIds.has(ruleId));
}

function buildDreamSourceConditions(
  sourceIds: string[],
  sourceDois: string[],
): Record<string, unknown>[] {
  const conditions: Record<string, unknown>[] = [
    { 'ai_result.citations.sourceId': { $in: sourceIds } },
    { 'ai_result.claim_bindings.source.sourceId': { $in: sourceIds } },
    { 'ai_result.scientific_context_notes.sources.sourceId': { $in: sourceIds } },
    { 'ai_result.scientific_context_notes.evidenceQuotes.sourceId': { $in: sourceIds } },
    { 'aiAnalysis.citations.sourceId': { $in: sourceIds } },
    { 'aiAnalysis.claim_bindings.source.sourceId': { $in: sourceIds } },
    { 'aiAnalysis.scientific_context_notes.sources.sourceId': { $in: sourceIds } },
    { 'aiAnalysis.scientific_context_notes.evidenceQuotes.sourceId': { $in: sourceIds } },
    { 'edit_history.ai_result.citations.sourceId': { $in: sourceIds } },
    { 'edit_history.ai_result.claim_bindings.source.sourceId': { $in: sourceIds } },
    { 'edit_history.ai_result.scientific_context_notes.sources.sourceId': { $in: sourceIds } },
    { 'edit_history.ai_result.scientific_context_notes.evidenceQuotes.sourceId': { $in: sourceIds } },
    { 'retrievedContext.componentD.evidenceLinks.sourceId': { $in: sourceIds } },
    { 'edit_history.retrievedContext.componentD.evidenceLinks.sourceId': { $in: sourceIds } },
  ];
  if (!sourceDois.length) return conditions;
  return [
    ...conditions,
    { 'ai_result.claim_bindings.source.doi': { $in: sourceDois } },
    { 'ai_result.scientific_context_notes.sources.doi': { $in: sourceDois } },
    { 'aiAnalysis.claim_bindings.source.doi': { $in: sourceDois } },
    { 'aiAnalysis.scientific_context_notes.sources.doi': { $in: sourceDois } },
    { 'edit_history.ai_result.claim_bindings.source.doi': { $in: sourceDois } },
    { 'edit_history.ai_result.scientific_context_notes.sources.doi': { $in: sourceDois } },
    { 'retrievedContext.componentD.evidenceLinks.doi': { $in: sourceDois } },
    { 'edit_history.retrievedContext.componentD.evidenceLinks.doi': { $in: sourceDois } },
  ];
}

function normalizeDoi(value: unknown): string {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '');
}

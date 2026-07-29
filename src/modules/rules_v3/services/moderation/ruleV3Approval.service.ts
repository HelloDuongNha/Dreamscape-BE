import { generateEmbedding } from '../../../../infrastructure/llm.service';
import { reconcileOracleEvidenceGapsForRule } from '../../../oracle/services/evidence/oracleEvidenceReconciliation.service';
import KnowledgeRuleV3 from '../../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../models/KnowledgeRuleEvidence';
import { areRuleV3ComponentsEvidenceEquivalent } from '../evidence/ruleV3Relationship.service';
import { scoreRuleV3 } from '../evidence/ruleV3Scoring.service';
import { applyStoredValidationAdjustment } from '../evidence/ruleV3ValidationScore.service';

// Kiểm tra dẫn chứng, tạo chỉ mục và chuyển một lập luận sang trạng thái đã duyệt.
export async function approveRuleV3Record(existing: any): Promise<void> {
  const components = Array.isArray(existing.compositeComponents)
    ? existing.compositeComponents
    : [];
  const evidence = await loadApprovalEvidence(existing, components);
  const score = scoreApprovalEvidence(existing, components, evidence);

  requireApprovalQuality(score);
  requireCompositeQuality(existing, components, evidence);

  const { embedding, embeddingModel } = await createRuleEmbedding(existing, components);
  const finalScore = applyStoredValidationAdjustment(score, existing);
  await KnowledgeRuleV3.findByIdAndUpdate(existing._id, {
    status: 'verified',
    sourceEvidenceScore: score.evidenceScore,
    evidenceScore: finalScore.evidenceScore,
    certaintyTier: certaintyTierFor(finalScore.evidenceScore),
    supportingSourceCount: score.supportingSourceCount,
    contradictingSourceCount: score.contradictingSourceCount,
    embedding,
    embeddingModel,
  }, { new: true, runValidators: true });
}

// Nối lại các Evidence Needed sau khi lập luận đã được duyệt thành công.
export async function reconcileApprovedRuleEvidenceGaps(rule: any): Promise<void> {
  await reconcileOracleEvidenceGapsForRule({
    _id: rule._id,
    statement: rule.statement,
    subject: rule.subject,
    outcome: rule.outcome,
    status: rule.status,
    evidenceScore: rule.evidenceScore,
    supportingSourceCount: rule.supportingSourceCount,
    compositeComponents: rule.compositeComponents,
  });
}

async function loadApprovalEvidence(existing: any, components: any[]) {
  const componentIds = components.map(component => component.sourceRuleId).filter(Boolean);
  return KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: componentIds.length ? componentIds : [existing._id] },
  }).lean();
}

function scoreApprovalEvidence(existing: any, components: any[], evidence: any[]) {
  if (areRuleV3ComponentsEvidenceEquivalent(components)) {
    return scoreRuleV3(components[0], evidence);
  }
  return scoreRuleV3(
    existing,
    evidence.filter(item => String(item.ruleId) === String(existing._id)),
  );
}

function requireApprovalQuality(score: ReturnType<typeof scoreRuleV3>): void {
  if (score.supportingCitationCount === 0) {
    throw new Error('missing_supporting_citation');
  }
  if (!score.qualityAccepted || score.semanticSupportLevel !== 'direct') {
    throw new Error('quality_gate_failed');
  }
}

function requireCompositeQuality(existing: any, components: any[], evidence: any[]): void {
  if (!existing.isComposite || components.length < 2) return;

  const evidenceByRule = new Map<string, any[]>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    const rows = evidenceByRule.get(key) || [];
    rows.push(item);
    evidenceByRule.set(key, rows);
  }
  const everyComponentPasses = components.every(snapshot => {
    const componentScore = scoreRuleV3(
      snapshot,
      evidenceByRule.get(String(snapshot.sourceRuleId)) || [],
    );
    return componentScore.supportingCitationCount > 0
      && componentScore.qualityAccepted
      && componentScore.semanticSupportLevel === 'direct';
  });
  if (!everyComponentPasses) {
    throw new Error('composite_component_quality_gate_failed');
  }
}

async function createRuleEmbedding(existing: any, components: any[]) {
  const embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';
  const expectedDimension = Number.parseInt(
    process.env.RULE_V3_EMBEDDING_DIMENSION || '768',
    10,
  );
  try {
    const embedding = await generateEmbedding([
      existing.statement,
      `Subject: ${existing.subject}`,
      `Outcome: ${existing.outcome}`,
      ...components.flatMap(component => [
        `Component: ${component.statement}`,
        `Component subject: ${component.subject}`,
        `Component outcome: ${component.outcome}`,
      ]),
      `Conditions: ${(existing.conditions || []).join('; ')}`,
      `Dream features: ${(existing.dreamFeatureTags || []).join('; ')}`,
    ].join('\n'));
    if (
      !Array.isArray(embedding)
      || embedding.length !== expectedDimension
      || !embedding.every(Number.isFinite)
    ) {
      throw new Error('invalid_embedding');
    }
    return { embedding, embeddingModel };
  } catch {
    throw new Error('embedding_unavailable');
  }
}

function certaintyTierFor(score: number) {
  if (score >= 85) return 'strong';
  if (score >= 65) return 'moderate';
  if (score >= 45) return 'limited';
  return 'weak';
}

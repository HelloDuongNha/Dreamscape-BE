import { Request, Response } from 'express';
import mongoose from 'mongoose';
import AcademicChunk from '../../academic/models/AcademicChunk';
import AcademicSource from '../../academic/models/AcademicSource';
import { getOracleEvidenceGapMatchesForRule } from '../../oracle/services/oracleEvidenceGap.service';
import KnowledgeRuleV3 from '../models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../models/KnowledgeRuleEvidence';
import { parseRuleV3CandidateQuery } from '../dto';
import { mapRuleV3Candidate } from '../services/moderation/ruleV3CandidatePresentation.service';
import { groupRuleV3EvidenceExcerpts } from '../services/moderation/ruleV3EvidencePresentation.service';
import { loadRuleV3CandidateRelationships } from '../services/moderation/ruleV3CandidateRelationship.service';
import { loadRuleV3SourceSummaries } from '../services/moderation/ruleV3SourceSummary.service';
import { getRuleValidationStats } from '../services/evidence/ruleV3ValidationScore.service';

// Trả danh sách lập luận cùng điểm và thống kê phản hồi hiện tại.
export const getRuleV3Candidates = async (req: Request, res: Response): Promise<void> => {
  const { status: requestedStatus, sourceId } = parseRuleV3CandidateQuery(req.query);
  const status = requestedStatus === 'approved' ? 'verified' : requestedStatus;
  const filter: any = { status };
  if (sourceId) {
    if (!mongoose.Types.ObjectId.isValid(sourceId)) {
      res.status(400).json({ success: false, message: 'Mã tài liệu không hợp lệ.' });
      return;
    }
    const requestedId = new mongoose.Types.ObjectId(sourceId);
    const sourceAliases = [requestedId];
    const [approvedById, approvedByContribution] = await Promise.all([
      AcademicSource.findById(requestedId).select('sourceContributionId').lean(),
      AcademicSource.findOne({ sourceContributionId: requestedId }).select('_id').lean(),
    ]);
    if (approvedById?.sourceContributionId) sourceAliases.push(approvedById.sourceContributionId);
    if (approvedByContribution?._id) sourceAliases.push(approvedByContribution._id);
    const ruleIds = await KnowledgeRuleEvidenceV3.distinct('ruleId', {
      sourceId: { $in: sourceAliases },
    });
    filter._id = { $in: ruleIds };
  }

  const rules = await KnowledgeRuleV3.find(filter).sort({ createdAt: -1 }).lean();
  const evidenceOwnerIds = rules.flatMap(rule => [
    rule._id,
    ...(rule.compositeComponents || []).map((component: any) => component.sourceRuleId),
  ]);
  const evidence = await KnowledgeRuleEvidenceV3.find({ ruleId: { $in: evidenceOwnerIds } })
    .select('ruleId sourceId chunkId stance exactness verificationScore exactQuote researchType researchTypeConfidence sourceQuality')
    .lean();
  const evidenceByRule = groupEvidenceByRule(evidence);
  const sourceSummaries = await loadRuleV3SourceSummaries(
    evidence.map(item => String(item.sourceId)),
  );
  const validationStats = await getRuleValidationStats(rules.map(rule => String(rule._id)));
  const data = rules.map(rule => {
    const ownerIds = [
      String(rule._id),
      ...(rule.compositeComponents || []).map(
        (component: any) => String(component.sourceRuleId),
      ),
    ];
    const ruleEvidence = ownerIds.flatMap(ownerId => evidenceByRule.get(ownerId) || []);
    const source = sourceSummaries.get(String(ruleEvidence[0]?.sourceId || sourceId || ''));
    return {
      ...mapRuleV3Candidate(rule, source, ruleEvidence),
      validationStats: validationStats.get(String(rule._id)),
    };
  });
  res.status(200).json({ success: true, data });
};

// Trả dẫn chứng và các quan hệ cần thiết cho màn hình duyệt một lập luận.
export const getRuleV3CandidateDetail = async (req: Request, res: Response): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.id))) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }
  const rule = await KnowledgeRuleV3.findById(req.params.id).lean();
  if (!rule) {
    res.status(404).json({ success: false, message: 'Không tìm thấy ứng viên Rule V3.' });
    return;
  }

  const componentRuleIds = (rule.compositeComponents || [])
    .map((component: any) => component.sourceRuleId)
    .filter((id: unknown) => id && String(id) !== String(rule._id));
  const feedbackRuleIds = [rule._id, ...componentRuleIds];
  const evidence = await KnowledgeRuleEvidenceV3.find({
    ruleId: { $in: feedbackRuleIds },
  }).sort({ createdAt: 1 }).lean();
  const chunks = await AcademicChunk.find({
    _id: { $in: evidence.map(item => item.chunkId) },
  }).lean();
  const chunkMap = new Map(chunks.map(chunk => [String(chunk._id), chunk]));
  const sourceSummaries = await loadRuleV3SourceSummaries(
    evidence.map(item => String(item.sourceId)),
  );
  const source = sourceSummaries.get(String(evidence[0]?.sourceId || ''));
  const validationStats = await getRuleValidationStats([String(rule._id)]);
  const candidate = {
    ...mapRuleV3Candidate(rule, source, evidence),
    validationStats: validationStats.get(String(rule._id)),
  };

  const [evidenceGapMatches, ruleRelationships] = await Promise.all([
    getOracleEvidenceGapMatchesForRule({
      _id: rule._id,
      statement: rule.statement,
      subject: rule.subject,
      outcome: rule.outcome,
      status: rule.status,
      evidenceScore: rule.evidenceScore,
      supportingSourceCount: rule.supportingSourceCount,
      compositeComponents: rule.compositeComponents,
    }),
    loadRuleV3CandidateRelationships(rule, feedbackRuleIds, evidence),
  ]);
  res.status(200).json({
    success: true,
    data: {
      candidate,
      evidenceGapMatches,
      ruleRelationships,
      evidenceChunks: chunks.map((chunk: any) => ({
        chunkId: String(chunk._id),
        sectionTitle: chunk.sectionTitle,
        sectionType: chunk.sectionType || chunk.blockType || 'paragraph',
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        sourceOrder: chunk.chunkOrder,
        chunkPreview: String(chunk.text || '').slice(0, 2000),
      })),
      evidenceExcerpts: groupRuleV3EvidenceExcerpts(evidence, chunkMap, sourceSummaries),
    },
  });
};

function groupEvidenceByRule(evidence: any[]) {
  const evidenceByRule = new Map<string, any[]>();
  for (const item of evidence) {
    const key = String(item.ruleId);
    const rows = evidenceByRule.get(key) || [];
    rows.push(item);
    evidenceByRule.set(key, rows);
  }
  return evidenceByRule;
}

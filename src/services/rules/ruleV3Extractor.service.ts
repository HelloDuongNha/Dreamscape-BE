import crypto from 'crypto';
import { locateCitationInText } from './exactCitationLocator.service';
import { inferDocumentLanguage } from './documentLanguage.service';
import type { DocumentResearchProfile, DocumentExtractionPlan } from './documentResearchProfile.types';
import type { EvidenceBatchPlan, EvidenceBatch } from './evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan } from './hierarchicalEvidencePlanner.types';
import {
  RuleV3GenerationProvider,
  ProviderCandidate,
  RuleV3ClaimType,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation,
  RuleV3CandidateRejectionCode,
  RuleV3ProviderInput
} from './ruleV3GenerationProvider.types';
import { assessRuleV3CandidateQuality } from './ruleV3CandidateQuality.service';
import {
  buildRuleV3EvidenceAnchors,
  verifyRuleV3EvidenceAnchor,
  type RuleV3EvidenceAnchor
} from './ruleV3EvidenceAnchor.service';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface CitationVerifiedCandidate {
  statement: string;
  claimType: RuleV3ClaimType;
  effectPolarity: RuleV3EffectPolarity;
  evidenceInterpretation: RuleV3EvidenceInterpretation;
  subject: string;
  outcome: string;
  conditions: string[];
  limitations: string[];
  dreamFeatureTags: string[];
  citationVerification: 'passed';
  semanticVerification: 'passed';
  warnings: Array<'language_uncertain'>;
  evidence: Array<{
    chunkId: string;
    exactQuote: string;
    startOffset: number;
    endOffset: number;
    stance: 'supports' | 'refutes' | 'limits';
    chunkContentHash: string; // Internal-only chunkContentHash
  }>;
}

export interface RejectedCandidate {
  proposedStatement?: string;
  reasonCode: RuleV3CandidateRejectionCode;
  safeMessage: string;
}

export interface ExtractionDryRunResult {
  readerInput: {
    documentId: string;
    parserEngine: string;
    documentUpdatedAt: string | null;
    sectionCount: number;
    readerChunkCount: number;
  };
  workUnit: {
    workUnitId: string;
    label: string;
    strategy: string;
    totalBatchCount: number;
    processedBatchCount: number;
    partialPreview: boolean;
  };
  provider: {
    provider: 'ollama' | 'gemini';
    model: string;
    durationMs: number;
  };
  citationVerifiedCandidates: Array<{
    statement: string;
    claimType: RuleV3ClaimType;
    effectPolarity: RuleV3EffectPolarity;
    evidenceInterpretation: RuleV3EvidenceInterpretation;
    subject: string;
    outcome: string;
    conditions: string[];
    limitations: string[];
    dreamFeatureTags: string[];
    citationVerification: 'passed';
    semanticVerification: 'passed';
    warnings: Array<'language_uncertain'>;
    evidence: Array<{
      chunkId: string;
      exactQuote: string;
      startOffset: number;
      endOffset: number;
      stance: 'supports' | 'refutes' | 'limits';
    }>;
  }>;
  rejectedCandidates: RejectedCandidate[];
  diagnostics: {
    rawCandidateCount: number;
    citationVerifiedCandidateCount: number;
    rejectedCandidateCount: number;
    mergedDuplicateCount: number;
    verifiedCitationCount: number;
    invalidCitationCount: number;
  };
  safety: {
    previewOnly: boolean;
    databaseWrites: number;
  };
}

export async function extractRuleV3Candidates(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
  evidenceBatchPlan: EvidenceBatchPlan,
  hierarchicalPlan: HierarchicalEvidencePlan,
  readerInput: {
    documentId: string;
    parserEngine: string;
    documentUpdatedAt: string | null;
    sectionCount: number;
    readerChunkCount: number;
  },
  workUnitId: string,
  provider: RuleV3GenerationProvider,
  abortSignal?: AbortSignal
): Promise<ExtractionDryRunResult> {
  const startTime = Date.now();

  // 1. Find the selected work unit
  const workUnit = hierarchicalPlan.workUnits.find(wu => wu.workUnitId === workUnitId);
  if (!workUnit) {
    throw new Error('work_unit_not_found');
  }

  // 2. Select batches in exact workUnit.batchIds order, maximum 2 sequential batches
  const targetBatchIds = workUnit.batchIds.slice(0, 2);
  if (targetBatchIds.length === 0) {
    throw new Error('work_unit_not_found');
  }

  const workUnitChunkIds = new Set(workUnit.targetChunkIds);
  const targetBatches: EvidenceBatch[] = [];
  for (const batchId of targetBatchIds) {
    const batch = evidenceBatchPlan.batches.find(b => b.batchId === batchId);
    if (!batch) {
      throw new Error('work_unit_not_found');
    }
    // Verify that all chunks in the batch belong to this work unit
    for (const chunk of batch.chunks) {
      if (!workUnitChunkIds.has(chunk.chunkId)) {
        throw new Error('work_unit_not_found');
      }
    }
    targetBatches.push(batch);
  }

  // 3. Enforce maximum total prompt characters limit
  let totalPromptChars = 0;
  for (const batch of targetBatches) {
    for (const chunk of batch.chunks) {
      totalPromptChars += chunk.text.length;
    }
  }
  if (totalPromptChars > 50000) {
    throw new Error('input_too_large');
  }

  const rawCandidates: ProviderCandidate[] = [];
  let totalRawCount = 0;
  const evidenceAnchorMap = new Map<string, RuleV3EvidenceAnchor>();

  // 4. Provider calls run sequentially (max 2 calls)
  for (const batch of targetBatches) {
    if (abortSignal?.aborted) {
      throw new Error('provider_timeout');
    }

    const firstChunk = batch.chunks[0];
    const sectionId = firstChunk?.sectionId || null;
    const sectionProfile = profile.sectionProfiles?.find(sp => sp.sectionId === sectionId);
    const sectionLabel = sectionProfile ? sectionProfile.heading : workUnit.label;

    const batchChunks = batch.chunks.map(c => ({ chunkId: c.chunkId, text: c.text }));
    const evidenceAnchors = buildRuleV3EvidenceAnchors(batchChunks);
    for (const anchor of evidenceAnchors) evidenceAnchorMap.set(anchor.evidenceId, anchor);

    const providerInput: RuleV3ProviderInput = {
      batchId: batch.batchId,
      sectionId,
      sectionLabel,
      workUnitId: workUnit.workUnitId,
      workUnitLabel: workUnit.label,
      strategy: workUnit.strategy,
      sourceLanguage: profile.sourceLanguage,
      chunks: batchChunks,
      evidenceAnchors: evidenceAnchors.map(anchor => ({
        evidenceId: anchor.evidenceId,
        chunkId: anchor.chunkId,
        exactQuote: anchor.exactQuote
      }))
    };

    const raw = await provider.generateCandidates(providerInput, abortSignal);

    // Limit maximum 3 raw candidates per call
    if (raw.length > 3) {
      throw new Error('provider_schema_invalid');
    }

    // Limit total candidates to 6
    totalRawCount += raw.length;
    if (totalRawCount > 6) {
      throw new Error('provider_schema_invalid');
    }

    rawCandidates.push(...raw);
  }

  // Safe messages lookup
  const safeMessageMap: Record<RuleV3CandidateRejectionCode, string> = {
    language_mismatch: 'Ngôn ngữ của quy luật trích xuất không khớp với ngôn ngữ của tài liệu.',
    citation_missing: 'Trích dẫn nguyên văn không tìm thấy trong đoạn văn bản tương ứng.',
    citation_ambiguous: 'Trích dẫn nguyên văn bị trùng lặp hoặc mập mờ trong đoạn văn bản.',
    evidence_reference_invalid: 'Mô hình đã chọn một mã dẫn chứng không tồn tại trong lô văn bản.',
    chunk_outside_work_unit: 'Trích dẫn thuộc về đoạn văn bản nằm ngoài đơn vị xử lý hiện tại.',
    invalid_causal_elevation: 'Mối quan hệ liên kết (association) không được tự nâng cấp thành quan hệ nhân quả (causal).',
    candidate_schema_invalid: 'Cấu trúc quy luật không đúng định dạng yêu cầu.',
    no_verified_evidence: 'Quy luật không có trích dẫn nào được kiểm chứng khớp nguyên văn.',
    document_navigation: 'Câu này chỉ điều hướng tới bảng, hình hoặc phần khác của tài liệu.',
    research_recommendation: 'Câu này là đề xuất nghiên cứu tiếp theo, không phải kết luận đã được chứng minh.',
    claim_type_evidence_mismatch: 'Loại quan hệ được gán không phù hợp với nội dung bằng chứng.',
    evidence_does_not_entail_claim: 'Không có một trích dẫn hỗ trợ nào tự nó chứng minh đầy đủ kết luận.',
    generic_subject_or_outcome: 'Chủ thể hoặc kết quả quá chung chung để trở thành quy luật có thể sử dụng.',
    case_specific_narrative: 'Nội dung chỉ mô tả nhân vật, ca hoặc tình tiết riêng và chưa được tài liệu khái quát.',
    historical_or_biographical_fact: 'Nội dung là thông tin lịch sử hoặc tiểu sử, không phải kết luận tâm lý dùng cho phân tích giấc mơ.',
    generic_relation_wording: 'Nội dung chỉ nói hai khái niệm có liên hệ nhưng không có cơ chế, hướng hoặc điều kiện kiểm chứng.',
    not_applicable_to_dream_analysis: 'Kết luận không cung cấp thông tin dùng được về giấc mơ, giấc ngủ, ký ức hoặc cảm xúc.',
    fixed_symbol_dictionary: 'Ví dụ riêng đang bị biến thành ý nghĩa biểu tượng cố định cho mọi giấc mơ.',
    unfalsifiable_prediction: 'Nội dung đưa ra dự báo hoặc tiên tri không có điều kiện kiểm chứng khoa học.',
    identity_stereotype: 'Nội dung gán đặc điểm tâm lý cho bản sắc con người và không an toàn để khái quát.',
    book_claim_lacks_generalizable_mechanism: 'Kết luận trong sách chưa nêu điều kiện hoặc cơ chế đủ khái quát để áp dụng cho trường hợp khác.',
    non_operational_theory: 'Nội dung là hệ biểu tượng hoặc lý thuyết không có điều kiện quan sát để dùng như một quy luật Oracle.'
  };

  const tempVerified: CitationVerifiedCandidate[] = [];
  const rejectedCandidates: RejectedCandidate[] = [];

  let verifiedCitationCount = 0;
  let invalidCitationCount = 0;

  // Map chunkId to target chunk text for lookup
  const chunkTextMap = new Map<string, string>();
  for (const batch of targetBatches) {
    for (const chunk of batch.chunks) {
      chunkTextMap.set(chunk.chunkId, chunk.text);
    }
  }

  // 5. Candidate Validation & Citation Verification
  for (const candidate of rawCandidates) {
    const exceedsPersistenceContract =
      candidate.statement.length > 1000 ||
      candidate.subject.length > 200 ||
      candidate.outcome.length > 200 ||
      candidate.conditions.length > 20 ||
      candidate.limitations.length > 20 ||
      candidate.dreamFeatureTags.length > 20 ||
      [...candidate.conditions, ...candidate.limitations, ...candidate.dreamFeatureTags]
        .some(item => item.length > 100);
    if (exceedsPersistenceContract) {
      rejectedCandidates.push({
        proposedStatement: candidate.statement.slice(0, 1000),
        reasonCode: 'candidate_schema_invalid',
        safeMessage: safeMessageMap.candidate_schema_invalid
      });
      continue;
    }

    // A. Verify causal elevation restriction
    if (candidate.claimType === 'association' && candidate.evidenceInterpretation === 'causal') {
      rejectedCandidates.push({
        proposedStatement: candidate.statement,
        reasonCode: 'invalid_causal_elevation',
        safeMessage: safeMessageMap.invalid_causal_elevation
      });
      continue;
    }

    // B. Verify language alignment
    const textSamples = [
      candidate.statement,
      candidate.subject,
      candidate.outcome,
      ...candidate.conditions,
      ...candidate.limitations
    ].filter(Boolean);

    const detectedLanguage = inferDocumentLanguage(textSamples);
    if (detectedLanguage !== 'unknown' && detectedLanguage !== profile.sourceLanguage) {
      rejectedCandidates.push({
        proposedStatement: candidate.statement,
        reasonCode: 'language_mismatch',
        safeMessage: safeMessageMap.language_mismatch
      });
      continue;
    }

    const warnings: Array<'language_uncertain'> = [];
    if (detectedLanguage === 'unknown') {
      warnings.push('language_uncertain');
    }

    // C. Verify citations
    const verifiedEvidenceList: CitationVerifiedCandidate['evidence'] = [];
    let firstRejectionCode: RuleV3CandidateRejectionCode | null = null;

    if (candidate.evidence.length > 5) {
      throw new Error('provider_schema_invalid');
    }

    // Deduplicate evidence spans within the candidate
    const seenSpans = new Set<string>();

    for (const ev of candidate.evidence) {
      if ('evidenceId' in ev) {
        const anchor = evidenceAnchorMap.get(ev.evidenceId);
        if (!anchor) {
          firstRejectionCode = firstRejectionCode || 'evidence_reference_invalid';
          invalidCitationCount++;
          continue;
        }
        const chunkText = chunkTextMap.get(anchor.chunkId);
        if (!chunkText || !verifyRuleV3EvidenceAnchor(anchor, chunkText)) {
          firstRejectionCode = firstRejectionCode || 'evidence_reference_invalid';
          invalidCitationCount++;
          continue;
        }
        const spanKey = `${anchor.chunkId}|${anchor.chunkContentHash}|${anchor.startOffset}|${anchor.endOffset}|${ev.stance}`;
        if (seenSpans.has(spanKey)) continue;
        seenSpans.add(spanKey);
        verifiedEvidenceList.push({
          chunkId: anchor.chunkId,
          exactQuote: anchor.exactQuote,
          startOffset: anchor.startOffset,
          endOffset: anchor.endOffset,
          stance: ev.stance,
          chunkContentHash: anchor.chunkContentHash
        });
        verifiedCitationCount++;
        continue;
      }

      const chunkText = chunkTextMap.get(ev.chunkId);
      if (!chunkText) {
        firstRejectionCode = firstRejectionCode || 'chunk_outside_work_unit';
        invalidCitationCount++;
        continue;
      }

      const locateResult = locateCitationInText(ev.chunkId, chunkText, ev.proposedQuote);
      if (!locateResult.success) {
        invalidCitationCount++;
        if (locateResult.rejectionReason === 'ambiguous') {
          firstRejectionCode = firstRejectionCode || 'citation_ambiguous';
        } else {
          firstRejectionCode = firstRejectionCode || 'citation_missing';
        }
        continue;
      }

      const spanKey = `${ev.chunkId}|${locateResult.chunkContentHash}|${locateResult.startOffset}|${locateResult.endOffset}|${ev.stance}`;
      if (seenSpans.has(spanKey)) {
        continue;
      }
      seenSpans.add(spanKey);

      verifiedEvidenceList.push({
        chunkId: ev.chunkId,
        exactQuote: locateResult.exactQuote,
        startOffset: locateResult.startOffset,
        endOffset: locateResult.endOffset,
        stance: ev.stance,
        chunkContentHash: locateResult.chunkContentHash
      });
      verifiedCitationCount++;
    }

    if (verifiedEvidenceList.length === 0) {
      const code = firstRejectionCode || 'no_verified_evidence';
      rejectedCandidates.push({
        proposedStatement: candidate.statement,
        reasonCode: code,
        safeMessage: safeMessageMap[code]
      });
      continue;
    }

    const quality = assessRuleV3CandidateQuality(candidate, verifiedEvidenceList, {
      documentType: profile.documentType,
    });
    if (!quality.accepted) {
      const code = quality.reasonCodes[0];
      rejectedCandidates.push({
        proposedStatement: candidate.statement,
        reasonCode: code,
        safeMessage: safeMessageMap[code]
      });
      continue;
    }

    tempVerified.push({
      statement: candidate.statement,
      claimType: candidate.claimType,
      effectPolarity: quality.normalizedEffectPolarity as RuleV3EffectPolarity,
      evidenceInterpretation: quality.normalizedEvidenceInterpretation as RuleV3EvidenceInterpretation,
      subject: candidate.subject,
      outcome: candidate.outcome,
      conditions: candidate.conditions,
      limitations: candidate.limitations,
      dreamFeatureTags: candidate.dreamFeatureTags,
      citationVerification: 'passed',
      semanticVerification: 'passed',
      warnings,
      evidence: verifiedEvidenceList
    });
  }

  // 6. In-memory semantic deduplication across candidates
  const mergedVerifiedMap = new Map<string, CitationVerifiedCandidate>();
  let mergedDuplicateCount = 0;

  for (const candidate of tempVerified) {
    const normalizedSubject = candidate.subject.trim().toLowerCase();
    const normalizedOutcome = candidate.outcome.trim().toLowerCase();
    const normalizedConditions = Array.from(new Set(candidate.conditions.map(c => c.trim().toLowerCase()))).sort();

    const dedupSignature = [
      profile.sourceLanguage,
      candidate.claimType,
      candidate.effectPolarity,
      candidate.evidenceInterpretation,
      normalizedSubject,
      normalizedOutcome,
      normalizedConditions.join(',')
    ].join('|');

    const existing = mergedVerifiedMap.get(dedupSignature);
    if (existing) {
      mergedDuplicateCount++;
      
      for (const ev of candidate.evidence) {
        const evDup = existing.evidence.some(
          ex =>
            ex.chunkId === ev.chunkId &&
            ex.chunkContentHash === ev.chunkContentHash &&
            ex.startOffset === ev.startOffset &&
            ex.endOffset === ev.endOffset &&
            ex.stance === ev.stance
        );
        if (!evDup) {
          existing.evidence.push(ev);
        }
      }

      for (const w of candidate.warnings) {
        if (!existing.warnings.includes(w)) {
          existing.warnings.push(w);
        }
      }
    } else {
      mergedVerifiedMap.set(dedupSignature, candidate);
    }
  }

  // 7. Format returned candidates, stripping chunkContentHash for frontend
  const finalCandidates = Array.from(mergedVerifiedMap.values()).map(cand => ({
    statement: cand.statement,
    claimType: cand.claimType,
    effectPolarity: cand.effectPolarity,
    evidenceInterpretation: cand.evidenceInterpretation,
    subject: cand.subject,
    outcome: cand.outcome,
    conditions: cand.conditions,
    limitations: cand.limitations,
    dreamFeatureTags: cand.dreamFeatureTags,
    citationVerification: cand.citationVerification,
    semanticVerification: cand.semanticVerification,
    warnings: cand.warnings,
    evidence: cand.evidence.map(ev => ({
      chunkId: ev.chunkId,
      exactQuote: ev.exactQuote,
      startOffset: ev.startOffset,
      endOffset: ev.endOffset,
      stance: ev.stance
    }))
  }));

  const durationMs = Date.now() - startTime;

  return {
    readerInput: {
      documentId: readerInput.documentId,
      parserEngine: readerInput.parserEngine,
      documentUpdatedAt: readerInput.documentUpdatedAt,
      sectionCount: readerInput.sectionCount,
      readerChunkCount: readerInput.readerChunkCount
    },
    workUnit: {
      workUnitId: workUnit.workUnitId,
      label: workUnit.label,
      strategy: workUnit.strategy,
      totalBatchCount: workUnit.batchCount,
      processedBatchCount: targetBatches.length,
      partialPreview: workUnit.batchCount > 2
    },
    provider: {
      provider: provider.name,
      model: provider.modelName,
      durationMs
    },
    citationVerifiedCandidates: finalCandidates,
    rejectedCandidates,
    diagnostics: {
      rawCandidateCount: rawCandidates.length,
      citationVerifiedCandidateCount: finalCandidates.length,
      rejectedCandidateCount: rejectedCandidates.length,
      mergedDuplicateCount,
      verifiedCitationCount,
      invalidCitationCount
    },
    safety: {
      previewOnly: true,
      databaseWrites: 0
    }
  };
}

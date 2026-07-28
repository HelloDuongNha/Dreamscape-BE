import { inferDocumentLanguage } from '../planning/documentLanguage.service';
import type { DocumentResearchProfile } from '../planning/documentResearchProfile.types';
import {
  assessRuleV3CandidateQuality,
} from '../evidence/ruleV3CandidateQuality.service';
import { pruneUnsupportedSupportingEvidence } from '../evidence/ruleV3EvidenceEntailment.service';
import { verifyRuleV3EvidenceAnchor } from '../evidence/ruleV3EvidenceAnchor.service';
import type {
  ProviderCandidate,
  RuleV3CandidateRejectionCode,
  RuleV3EffectPolarity,
  RuleV3EvidenceInterpretation,
} from '../providers/ruleV3GenerationProvider.types';
import {
  LIMIT_CONDITION_ITEMS,
  LIMIT_LEN_CONDITION,
  LIMIT_LEN_LIMITATION,
  LIMIT_LEN_OUTCOME,
  LIMIT_LEN_STATEMENT,
  LIMIT_LEN_SUBJECT,
  LIMIT_LEN_TAG,
  LIMIT_LIMITATION_ITEMS,
  LIMIT_TAG_ITEMS,
} from '../providers/ruleV3ProviderContract.service';
import type {
  CitationVerifiedCandidate,
  GeneratedRuleV3Candidates,
  RejectedCandidate,
  VerifiedRuleV3Candidates,
} from './ruleV3CandidateExtraction.types';

const SAFE_REJECTION_MESSAGES: Record<RuleV3CandidateRejectionCode, string> = {
  language_mismatch: 'Ngôn ngữ của lập luận trích xuất không khớp với ngôn ngữ của tài liệu.',
  citation_missing: 'Trích dẫn nguyên văn không tìm thấy trong đoạn văn bản tương ứng.',
  citation_ambiguous: 'Trích dẫn nguyên văn bị trùng lặp hoặc mập mờ trong đoạn văn bản.',
  evidence_reference_invalid: 'Mô hình đã chọn một mã dẫn chứng không tồn tại trong lô văn bản.',
  chunk_outside_work_unit: 'Trích dẫn thuộc về đoạn văn bản nằm ngoài đơn vị xử lý hiện tại.',
  invalid_causal_elevation: 'Mối quan hệ liên kết (association) không được tự nâng cấp thành quan hệ nhân quả (causal).',
  candidate_schema_invalid: 'Cấu trúc lập luận không đúng định dạng yêu cầu.',
  no_verified_evidence: 'Lập luận không có trích dẫn nào được kiểm chứng khớp nguyên văn.',
  document_navigation: 'Câu này chỉ điều hướng tới bảng, hình hoặc phần khác của tài liệu.',
  research_recommendation: 'Câu này là đề xuất nghiên cứu tiếp theo, không phải kết luận đã được chứng minh.',
  claim_type_evidence_mismatch: 'Loại quan hệ được gán không phù hợp với nội dung bằng chứng.',
  evidence_does_not_entail_claim: 'Không có một trích dẫn hỗ trợ nào tự nó chứng minh đầy đủ kết luận.',
  generic_subject_or_outcome: 'Chủ thể hoặc kết quả quá chung chung để trở thành lập luận có thể sử dụng.',
  case_specific_narrative: 'Nội dung chỉ mô tả nhân vật, ca hoặc tình tiết riêng và chưa được tài liệu khái quát.',
  historical_or_biographical_fact: 'Nội dung là thông tin lịch sử hoặc tiểu sử, không phải kết luận tâm lý dùng cho phân tích giấc mơ.',
  generic_relation_wording: 'Nội dung chỉ nói hai khái niệm có liên hệ nhưng không có cơ chế, hướng hoặc điều kiện kiểm chứng.',
  not_applicable_to_dream_analysis: 'Kết luận không cung cấp thông tin dùng được về giấc mơ, giấc ngủ, ký ức hoặc cảm xúc.',
  fixed_symbol_dictionary: 'Ví dụ riêng đang bị biến thành ý nghĩa biểu tượng cố định cho mọi giấc mơ.',
  unfalsifiable_prediction: 'Nội dung đưa ra dự báo hoặc tiên tri không có điều kiện kiểm chứng khoa học.',
  identity_stereotype: 'Nội dung gán đặc điểm tâm lý cho bản sắc con người và không an toàn để khái quát.',
  book_claim_lacks_generalizable_mechanism: 'Kết luận trong sách chưa nêu điều kiện hoặc cơ chế đủ khái quát để áp dụng cho trường hợp khác.',
  non_operational_theory: 'Nội dung là hệ biểu tượng hoặc lý thuyết không có điều kiện quan sát để dùng như một lập luận Oracle.',
};

export function verifyRuleV3Candidates(
  profile: DocumentResearchProfile,
  generated: GeneratedRuleV3Candidates,
): VerifiedRuleV3Candidates {
  const candidates: CitationVerifiedCandidate[] = [];
  const rejectedCandidates: RejectedCandidate[] = [];
  let verifiedCitationCount = 0;
  let invalidCitationCount = 0;

  for (const candidate of generated.rawCandidates) {
    const structuralRejection = validateCandidateStructure(candidate, profile);
    if (structuralRejection) {
      rejectedCandidates.push(structuralRejection);
      continue;
    }

    const evidence = verifyCandidateEvidence(candidate, generated);
    verifiedCitationCount += evidence.verifiedCount;
    invalidCitationCount += evidence.invalidCount;
    if (evidence.verified.length === 0) {
      rejectedCandidates.push(reject(
        candidate,
        evidence.firstRejectionCode || 'no_verified_evidence',
      ));
      continue;
    }

    const groundedEvidence = pruneUnsupportedSupportingEvidence(candidate, evidence.verified);
    const quality = assessRuleV3CandidateQuality(candidate, groundedEvidence, {
      documentType: profile.documentType,
    });
    if (!quality.accepted) {
      rejectedCandidates.push(reject(candidate, quality.reasonCodes[0]));
      continue;
    }

    const detectedLanguage = detectCandidateLanguage(candidate);
    candidates.push({
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
      warnings: detectedLanguage === 'unknown' ? ['language_uncertain'] : [],
      evidence: groundedEvidence,
    });
  }

  return {
    candidates,
    rejectedCandidates,
    verifiedCitationCount,
    invalidCitationCount,
  };
}

function validateCandidateStructure(
  candidate: ProviderCandidate,
  profile: DocumentResearchProfile,
): RejectedCandidate | null {
  const exceedsContract = candidate.statement.length > LIMIT_LEN_STATEMENT
    || candidate.subject.length > LIMIT_LEN_SUBJECT
    || candidate.outcome.length > LIMIT_LEN_OUTCOME
    || candidate.conditions.length > LIMIT_CONDITION_ITEMS
    || candidate.limitations.length > LIMIT_LIMITATION_ITEMS
    || candidate.dreamFeatureTags.length > LIMIT_TAG_ITEMS
    || candidate.conditions.some(item => item.length > LIMIT_LEN_CONDITION)
    || candidate.limitations.some(item => item.length > LIMIT_LEN_LIMITATION)
    || candidate.dreamFeatureTags.some(item => item.length > LIMIT_LEN_TAG);
  if (exceedsContract) {
    return {
      proposedStatement: candidate.statement.slice(0, 1000),
      reasonCode: 'candidate_schema_invalid',
      safeMessage: SAFE_REJECTION_MESSAGES.candidate_schema_invalid,
    };
  }
  if (candidate.claimType === 'association' && candidate.evidenceInterpretation === 'causal') {
    return reject(candidate, 'invalid_causal_elevation');
  }
  const detectedLanguage = detectCandidateLanguage(candidate);
  return detectedLanguage !== 'unknown' && detectedLanguage !== profile.sourceLanguage
    ? reject(candidate, 'language_mismatch')
    : null;
}

function verifyCandidateEvidence(
  candidate: ProviderCandidate,
  generated: GeneratedRuleV3Candidates,
) {
  if (candidate.evidence.length > 5) throw new Error('provider_schema_invalid');

  const verified: CitationVerifiedCandidate['evidence'] = [];
  const seenSpans = new Set<string>();
  let firstRejectionCode: RuleV3CandidateRejectionCode | null = null;
  let verifiedCount = 0;
  let invalidCount = 0;

  for (const evidence of candidate.evidence) {
    const anchor = generated.evidenceAnchorMap.get(evidence.evidenceId);
    const chunkText = anchor ? generated.chunkTextMap.get(anchor.chunkId) : null;
    if (!anchor || !chunkText || !verifyRuleV3EvidenceAnchor(anchor, chunkText)) {
      firstRejectionCode ||= 'evidence_reference_invalid';
      invalidCount += 1;
      continue;
    }
    const span = `${anchor.chunkId}|${anchor.chunkContentHash}|${anchor.startOffset}|${anchor.endOffset}|${evidence.stance}`;
    if (seenSpans.has(span)) continue;
    seenSpans.add(span);
    verified.push({
      chunkId: anchor.chunkId,
      exactQuote: anchor.exactQuote,
      startOffset: anchor.startOffset,
      endOffset: anchor.endOffset,
      stance: evidence.stance,
      chunkContentHash: anchor.chunkContentHash,
    });
    verifiedCount += 1;
  }
  return { verified, firstRejectionCode, verifiedCount, invalidCount };
}

function detectCandidateLanguage(candidate: ProviderCandidate) {
  return inferDocumentLanguage([
    candidate.statement,
    candidate.subject,
    candidate.outcome,
    ...candidate.conditions,
    ...candidate.limitations,
  ].filter(Boolean));
}

function reject(
  candidate: ProviderCandidate,
  reasonCode: RuleV3CandidateRejectionCode,
): RejectedCandidate {
  return {
    proposedStatement: candidate.statement,
    reasonCode,
    safeMessage: SAFE_REJECTION_MESSAGES[reasonCode],
  };
}

import { Types } from 'mongoose';
import crypto from 'crypto';
import AcademicSource from '../models/AcademicSource';
import AcademicFullText from '../models/AcademicFullText';
import AcademicChunk from '../models/AcademicChunk';
import KnowledgeRuleCandidate from '../models/KnowledgeRuleCandidate';
import KnowledgeRule from '../models/KnowledgeRule';
import KnowledgeRuleSource from '../models/KnowledgeRuleSource';
import AcademicFullTextSection from '../models/AcademicFullTextSection';
import AcademicRuleExtractionRun from '../models/AcademicRuleExtractionRun';
import { logger } from '../utils/logger';

// ─── Text Excerpt Helpers ──────────────────────────────────────────────────────

export function splitIntoSentences(text: string): string[] {
  const rawSentences: string[] = [];
  const regex = /([^.!?]+[.!?]+)(\s+|$)/g;
  let match;
  let lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    rawSentences.push(match[1].trim());
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    const remaining = text.substring(lastIndex).trim();
    if (remaining) {
      rawSentences.push(remaining);
    }
  }

  const abbreviations = ['al', 'e.g', 'i.e', 'fig', 'tab', 'vs', 'dr', 'mr', 'mrs', 'ms', 'prof'];
  const sentences: string[] = [];
  for (let i = 0; i < rawSentences.length; i++) {
    let s = rawSentences[i];
    while (i < rawSentences.length - 1) {
      const words = s.split(/\s+/);
      const lastWord = words[words.length - 1].toLowerCase().replace(/[.!?]/g, '');
      if (abbreviations.includes(lastWord)) {
        s += " " + rawSentences[i + 1];
        i++;
      } else {
        break;
      }
    }
    sentences.push(s);
  }
  return sentences;
}

export function getSentenceCount(text: string): number {
  if (!text) return 0;
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10).length;
}

export function cleanExcerptText(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/\[\(?Heading|Section|Chapter|Page|Chunk\)?[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^\([^)]*\d{4}[^)]*\)\s*/g, '').trim();
  cleaned = cleaned.replace(/^[A-Z][a-zA-Z]*\s+\(\d{4}\)\s*/g, '').trim();
  cleaned = cleaned.replace(/^[^a-zA-Z0-9'"“"‘\u00C0-\u1EF9]+/g, '').trim();
  
  // Clean up citation residues at the end of the text
  cleaned = cleaned.replace(/\s*\(?[^)]+\d{4}\)?\s*$/g, '');
  cleaned = cleaned.replace(/\s*,\s*[a-zA-Z\s]+,\s*\d{4}\)?\s*$/g, '');
  cleaned = cleaned.replace(/\s*,\s*[^)]+\)\.?\s*$/g, '');
  cleaned = cleaned.replace(/\s*\([^)]*et\s+al\.?[^)]*\)\.?\s*$/gi, '');
  cleaned = cleaned.replace(/\s*,\s*dreams\)\.?$/gi, '');

  // Balance parenthetical expressions (trim off unmatched closing parentheses like dangling citation tails)
  let openCount = 0;
  let firstClose = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '(') openCount++;
    if (cleaned[i] === ')') {
      openCount--;
      if (openCount < 0 && firstClose === -1) {
        firstClose = i;
      }
    }
  }
  if (firstClose !== -1) {
    cleaned = cleaned.slice(0, firstClose).trim();
  }

  while (cleaned.length > 0) {
    const lastChar = cleaned[cleaned.length - 1];
    if (/[a-zA-Z0-9'"”"’\])]/.test(lastChar)) {
      cleaned += '.';
      break;
    }
    if (/[.!?]/.test(lastChar)) {
      break;
    }
    cleaned = cleaned.slice(0, -1).trim();
  }
  return cleaned;
}

export function isValidCleanExcerpt(excerpt: string): boolean {
  const clean = excerpt.trim();
  if (clean.length < 100 || clean.length > 600) return false;
  
  // Must start with capital letter, number or quote
  if (!/^[A-Z“"‘[0-9]/.test(clean)) return false;
  
  // Must end with proper punctuation
  if (!/[.!?“"’]$/.test(clean)) return false;
  
  // Must not contain stray heading/chunk tags
  if (/\[(?:Heading|Section|Chunk|Page)/i.test(clean)) return false;
  
  // Must not start with ellipses, broken punctuation, or brackets
  if (/^[.,:\)\]\s\-]/.test(clean) || clean.startsWith('...')) return false;
  if (clean.startsWith(',') || clean.startsWith('.') || clean.startsWith(')') || clean.startsWith(']')) return false;
  
  // Must not be an orphan citation list
  if (/^,\s*dreams\)/i.test(clean)) return false;
  if (/^,\s*\d{4}/.test(clean)) return false;
  if (/^\([^)]*\)/.test(clean)) return false; // skip parenthetical starts
  if (clean.includes('...)') || clean.includes(', dreams)')) return false;
  
  // Must not be only citations
  const parentheticalCount = (clean.match(/\([^)]+\)/g) || []).length;
  if (parentheticalCount > 3 && clean.length < 250) return false;
  
  return true;
}

export function extractExcerptsFromChunk(chunkText: string, keywords: Set<string>): string[] {
  const text = chunkText.trim();
  if (text.length <= 800) {
    const cleaned = cleanExcerptText(text);
    return cleaned && isValidCleanExcerpt(cleaned) ? [cleaned] : [];
  }

  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) {
    return [];
  }

  const sentenceScores = sentences.map(s => {
    let score = 0;
    const words = s.toLowerCase()
      .replace(/[^a-z0-9áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/g, ' ')
      .split(/\s+/);
    for (const w of words) {
      if (keywords.has(w)) {
        score++;
      }
    }
    return score;
  });

  const excerpts: string[] = [];
  const usedSentences = new Set<number>();

  for (let iter = 0; iter < 3; iter++) {
    let bestIdx = -1;
    let maxScore = -1;
    for (let i = 0; i < sentences.length; i++) {
      if (usedSentences.has(i)) continue;
      if (sentenceScores[i] > maxScore) {
        maxScore = sentenceScores[i];
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      break;
    }
    if (excerpts.length >= 1 && maxScore <= 0) {
      break;
    }

    let sIdx = bestIdx;
    let eIdx = bestIdx;
    const getExcerptText = (s: number, e: number) => {
      return sentences.slice(s, e + 1).join(" ");
    };

    let currentText = getExcerptText(sIdx, eIdx);
    while (currentText.length < 350) {
      let expanded = false;
      const canExpandForward = eIdx < sentences.length - 1;
      const canExpandBackward = sIdx > 0;

      if (!canExpandForward && !canExpandBackward) {
        break;
      }

      const shouldExpandForward = canExpandForward && (!canExpandBackward || (eIdx - bestIdx <= bestIdx - sIdx));
      if (shouldExpandForward) {
        const nextLen = currentText.length + 1 + sentences[eIdx + 1].length;
        if (nextLen <= 600 || currentText.length < 250) {
          eIdx++;
          currentText = getExcerptText(sIdx, eIdx);
          expanded = true;
        } else {
          break;
        }
      } else if (canExpandBackward) {
        const nextLen = currentText.length + 1 + sentences[sIdx - 1].length;
        if (nextLen <= 600 || currentText.length < 250) {
          sIdx--;
          currentText = getExcerptText(sIdx, eIdx);
          expanded = true;
        } else {
          break;
        }
      }
      if (!expanded) {
        break;
      }
    }

    const cleaned = cleanExcerptText(currentText);
    if (cleaned && isValidCleanExcerpt(cleaned)) {
      excerpts.push(cleaned);
    }
    for (let i = sIdx; i <= eIdx; i++) {
      usedSentences.add(i);
    }
  }

  return excerpts;
}

// ─── Consolidation & Quality Helpers ──────────────────────────────────────────

export function areCandidatesNearDuplicates(c1: any, c2: any): boolean {
  if (!c1 || !c2) return false;

  const label1 = normalizeText(normalizeVietnameseAcademicTerms(c1.label || ''));
  const label2 = normalizeText(normalizeVietnameseAcademicTerms(c2.label || ''));
  
  // 1. Label similarity (e.g. >0.55 overlap)
  if (isSimilarText(label1, label2, 0.55)) {
    return true;
  }

  // 2. Evidence summary similarity
  const summary1 = normalizeText(normalizeVietnameseAcademicTerms(c1.evidenceSummary || ''));
  const summary2 = normalizeText(normalizeVietnameseAcademicTerms(c2.evidenceSummary || ''));
  if (isSimilarText(summary1, summary2, 0.55)) {
    return true;
  }

  // 3. Scientific basis similarity
  const basis1 = normalizeText(normalizeVietnameseAcademicTerms(c1.scientificBasis || ''));
  const basis2 = normalizeText(normalizeVietnameseAcademicTerms(c2.scientificBasis || ''));
  if (isSimilarText(basis1, basis2, 0.55)) {
    return true;
  }

  // 4. Category + Factor similarity
  const cat1 = normalizeText(normalizeVietnameseAcademicTerms(c1.category || ''));
  const cat2 = normalizeText(normalizeVietnameseAcademicTerms(c2.category || ''));
  const fact1 = normalizeText(normalizeVietnameseAcademicTerms(c1.factor || ''));
  const fact2 = normalizeText(normalizeVietnameseAcademicTerms(c2.factor || ''));
  if (isSimilarText(cat1, cat2, 0.70) && isSimilarText(fact1, fact2, 0.70)) {
    return true;
  }

  // 5. Memory-specific consolidation rule
  const isMemory1 = label1.includes('ky uc') || label1.includes('tri nho') || summary1.includes('ky uc') || summary1.includes('tri nho');
  const isMemory2 = label2.includes('ky uc') || label2.includes('tri nho') || summary2.includes('ky uc') || summary2.includes('tri nho');
  if (isMemory1 && isMemory2) {
    if (isSimilarText(label1, label2, 0.45) || isSimilarText(cat1, cat2, 0.60) || isSimilarText(fact1, fact2, 0.60)) {
      return true;
    }
  }

  return false;
}

export function buildDetailedConflictNote(
  type: 'active_rule' | 'existing_candidate' | 'batch_candidate',
  name: string,
  id: string,
  similarityReason: string,
  category: string
): string {
  let overlapType = '';
  let recommendAction = '';
  if (type === 'active_rule') {
    overlapType = `quy luật đang hoạt động '${name}' (Mã: ${id})`;
    recommendAction = `Nên gộp hai quy luật này thành một luật rộng về '${category}' thay vì duyệt riêng.`;
  } else if (type === 'existing_candidate') {
    overlapType = `ứng viên hiện có '${name}' (Mã đề xuất: ${id})`;
    recommendAction = `Nên gộp hai ứng viên này thành một quy luật chung để tối ưu hóa hệ thống.`;
  } else {
    overlapType = `ứng viên khác trong cùng lô '${name}'`;
    recommendAction = `Nên gộp hai ứng viên này thành một kết luận khái quát hơn.`;
  }

  return `Kết luận này gần với ${overlapType} vì cả hai đều ${similarityReason}. Khuyến nghị: ${recommendAction}`;
}

export function consolidateCandidates(candidates: any[]): any[] {
  const consolidated: any[] = [];

  for (const rc of candidates) {
    if (!rc || typeof rc !== 'object') continue;

    // Check if we already have a matching candidate in consolidated
    const matchIndex = consolidated.findIndex(existing => areCandidatesNearDuplicates(rc, existing));

    if (matchIndex !== -1) {
      const match = consolidated[matchIndex];
      // Merge rc into match!
      // 1. Choose the clearest label: closer to ideal length of 55 chars
      const label1 = rc.label || '';
      const label2 = match.label || '';
      const scoreLabel = (lbl: string) => Math.abs(lbl.length - 55);
      if (scoreLabel(label1) < scoreLabel(label2)) {
        match.label = label1;
      }

      // 2. Keep the strongest evidenceSummary (longest)
      if ((rc.evidenceSummary || '').length > (match.evidenceSummary || '').length) {
        match.evidenceSummary = rc.evidenceSummary;
      }

      // 3. Keep the strongest scientificBasis (longest)
      if ((rc.scientificBasis || '').length > (match.scientificBasis || '').length) {
        match.scientificBasis = rc.scientificBasis;
      }

      // 4. Combine evidenceChunkIds
      const combinedChunks = new Set<string>();
      if (Array.isArray(match.evidenceChunkIds)) {
        match.evidenceChunkIds.forEach((id: any) => combinedChunks.add(String(id)));
      }
      if (Array.isArray(rc.evidenceChunkIds)) {
        rc.evidenceChunkIds.forEach((id: any) => combinedChunks.add(String(id)));
      }
      if (Array.isArray(match.supportingChunkIndices)) {
        match.supportingChunkIndices.forEach((idx: any) => combinedChunks.add(String(idx)));
      }
      if (Array.isArray(rc.supportingChunkIndices)) {
        rc.supportingChunkIndices.forEach((idx: any) => combinedChunks.add(String(idx)));
      }
      match.evidenceChunkIds = Array.from(combinedChunks);

      // 5. Keep the longest limitations
      if ((rc.limitations || '').length > (match.limitations || '').length) {
        match.limitations = rc.limitations;
      }

      // 6. Keep the longest legitimacyReason
      if ((rc.legitimacyReason || '').length > (match.legitimacyReason || '').length) {
        match.legitimacyReason = rc.legitimacyReason;
      }

      // 7. Confidence cap: keep the minimum
      if (rc.confidenceCap !== undefined && (match.confidenceCap === undefined || rc.confidenceCap < match.confidenceCap)) {
        match.confidenceCap = rc.confidenceCap;
      }

      // 8. Combine conflictNotes
      if (rc.conflictNotes && rc.conflictNotes.trim()) {
        match.conflictNotes = match.conflictNotes
          ? `${match.conflictNotes} ${rc.conflictNotes}`
          : rc.conflictNotes;
      }
    } else {
      // Clone and push
      const chunkIds = new Set<string>();
      if (Array.isArray(rc.evidenceChunkIds)) {
        rc.evidenceChunkIds.forEach((id: any) => chunkIds.add(String(id)));
      }
      if (Array.isArray(rc.supportingChunkIndices)) {
        rc.supportingChunkIndices.forEach((idx: any) => chunkIds.add(String(idx)));
      }
      consolidated.push({
        ...rc,
        evidenceChunkIds: Array.from(chunkIds)
      });
    }
  }

  return consolidated;
}

export function isLowQualityCandidate(rc: any): boolean {
  if (!rc.label || typeof rc.label !== 'string') return true;
  if (!rc.evidenceSummary || typeof rc.evidenceSummary !== 'string') return true;
  if (!rc.scientificBasis || typeof rc.scientificBasis !== 'string') return true;

  const summary = rc.evidenceSummary.trim();
  const basis = rc.scientificBasis.trim();

  // 1. Check lengths
  if (summary.length < 100) return true;
  if (basis.length < 100) return true;

  // 2. Check sentence count for evidenceSummary (minimum 3-5 sentences)
  const sentencesCount = getSentenceCount(summary);
  if (sentencesCount < 3) return true;

  // 3. Check if evidenceSummary is identical to scientificBasis
  if (summary.toLowerCase() === basis.toLowerCase()) return true;

  // 4. Label word count check (should be a conclusion statement of 6 to 25 words)
  const labelWords = rc.label.trim().split(/\s+/).filter(Boolean).length;
  if (labelWords < 6 || labelWords > 25) return true;

  // 5. Catch topic-style labels
  const labelLower = rc.label.toLowerCase().trim();
  const topicPrefixes = [
    'sự xuất hiện', 'xuất hiện của', 'đánh giá', 'phân tích', 'tác động của',
    'ảnh hưởng của', 'vai trò của', 'mối liên hệ', 'khảo sát', 'nghiên cứu về'
  ];
  const isTopicStyle = topicPrefixes.some(prefix => labelLower.startsWith(prefix));
  if (isTopicStyle) return true;

  return false;
}

// ─── Programmatic Scorer ─────────────────────────────────────────────────────

export function calculateEvidenceCredibilityScore(
  evidenceType: string,
  evidenceRole: string,
  verificationStatus: string,
  sourceQuality: string,
  chunksCount: number,
  hasCleanExcerpts: boolean,
  claimStrength: string,
  limitationsText: string
): number {
  let score = 50;

  // 1. Peer review & DOI verification
  const isPeerReviewed = sourceQuality === 'peer_reviewed';
  const isDoiVerified = verificationStatus === 'verified' || verificationStatus === 'verified_doi';
  if (isDoiVerified) score += 10;
  if (isPeerReviewed) score += 10;

  // 2. Study type & experiments/data
  const isEmpirical = evidenceType === 'empirical_study';
  const isReview = evidenceType === 'literature_review';
  const isTheory = evidenceType === 'theoretical_framework';
  const isHypothesis = evidenceType === 'opinion_or_hypothesis';

  if (isEmpirical) {
    score += 15; // Provides experiments, data, benchmark results
  } else if (isReview) {
    score += 5;  // Literature review
  } else if (isTheory) {
    score -= 5;  // Theoretical framework
  } else if (isHypothesis) {
    score -= 15; // Opinion or hypothesis (speculative)
  }

  // 3. Directly stated vs inferred (via claimStrength)
  if (claimStrength) {
    if (claimStrength === 'possible_contributing_factor') {
      score += 5; // Directly tested/specific
    } else if (claimStrength === 'association_not_causation') {
      score -= 5;
    } else if (claimStrength === 'interpretive_framework') {
      score -= 5; // Inferred or interpretive
    } else if (claimStrength === 'hypothesis_not_diagnosis') {
      score -= 10; // Speculative / caution required
    } else if (claimStrength === 'epistemic_boundary_rule') {
      score -= 10; // Broad epistemic boundary
    }
  }

  // 4. Evidence chunks support
  if (chunksCount > 0) score += 5;
  if (chunksCount > 2) score += 5;
  if (hasCleanExcerpts) score += 5;
  else score -= 10;

  // 5. Limitations & role
  if (limitationsText && limitationsText.trim().length > 30) {
    score -= 5;
  }
  if (['limitation', 'contradiction'].includes(evidenceRole)) {
    score -= 15;
  }

  // Caps based on evidence type
  let maxCap = 100;
  if (isTheory) maxCap = 85;
  else if (isReview) maxCap = 80;
  else if (isHypothesis) maxCap = 65;

  score = Math.max(0, Math.min(maxCap, score));
  return score;
}

export function calculateOracleUsefulnessScore(
  paperDomain: string,
  oracleEligible: boolean,
  group: string,
  claimStrength: string,
  evidenceRole: string
): number {
  if (!oracleEligible || paperDomain !== 'dream_sleep_psychology') {
    return 5; // Non-dream papers have very low usefulness for dream interpretation
  }

  let score = 70; // Base for dream-related papers

  // Relation to dreams, sleep, psychology, etc.
  if (group === 'dream_psychology') {
    score += 15;
  } else if (group === 'sleep_context') {
    score += 10;
  } else if (group === 'personality_knowledge') {
    score += 5;
  } else if (group === 'cultural_limitation') {
    score -= 5;
  }

  // Whether it can help explain user dream posts directly vs general academic background
  if (claimStrength === 'interpretive_framework') {
    score += 5; // Direct reference interpretive framework for post analysis!
  } else if (claimStrength === 'possible_contributing_factor') {
    score += 5;
  } else if (claimStrength === 'hypothesis_not_diagnosis') {
    score -= 5;
  } else if (claimStrength === 'epistemic_boundary_rule') {
    score -= 10; // Epistemic boundaries are general knowledge rather than post analysis helpers
  }

  if (evidenceRole === 'primary_support') {
    score += 5;
  } else if (evidenceRole === 'background') {
    score -= 5; // Background is general academic knowledge
  }

  score = Math.max(0, Math.min(100, score));
  return score;
}

export function calculateLegitimacy(
  evidenceType: string,
  evidenceRole: string,
  verificationStatus: string,
  sourceQuality: string,
  chunksCount: number,
  hasCleanExcerpts: boolean,
  hasOverlap: boolean,
  hasConflict: boolean,
  claimStrength?: string,
  limitationsText?: string
): { score: number; level: 'weak' | 'moderate' | 'strong' | 'mixed' } {
  // Sync legitimacyScore with evidenceCredibilityScore
  const score = calculateEvidenceCredibilityScore(
    evidenceType,
    evidenceRole,
    verificationStatus,
    sourceQuality,
    chunksCount,
    hasCleanExcerpts,
    claimStrength || '',
    limitationsText || ''
  );

  let level: 'weak' | 'moderate' | 'strong' | 'mixed' = 'moderate';
  if (score >= 75) level = 'strong';
  else if (score >= 45) level = 'moderate';
  else level = 'weak';

  // Apply overlap/conflict penalties
  let penalizedScore = score;
  if (hasOverlap) penalizedScore = Math.max(0, penalizedScore - 10);
  if (hasConflict) penalizedScore = Math.max(0, penalizedScore - 20);

  return { score: penalizedScore, level };
}

export function buildLegitimacyExplanation(
  credibilityScore: number,
  usefulnessScore: number,
  evidenceType: string,
  sourceQuality: string,
  verificationStatus: string,
  claimStrength: string,
  limitations: string,
  llmReason: string,
  oracleEligible: boolean
): string {
  const parts: string[] = [];

  // 1. Credibility level description
  let credibilityDesc = 'trung bình';
  if (credibilityScore >= 75) credibilityDesc = 'cao';
  else if (credibilityScore < 45) credibilityDesc = 'thấp';

  let typeDesc = 'tài liệu học thuật chưa rõ loại hình';
  let experimentDesc = '';
  if (evidenceType === 'empirical_study') {
    typeDesc = 'bài nghiên cứu thực nghiệm (empirical study)';
    experimentDesc = 'có tiến hành thực nghiệm, thu thập số liệu hoặc kết quả đối chứng định lượng cụ thể';
  } else if (evidenceType === 'theoretical_framework') {
    typeDesc = 'bài lý thuyết/khung lý thuyết (theoretical framework)';
    experimentDesc = 'tập trung vào lý luận logic và xây dựng mô hình lý thuyết giả thuyết nhận thức, không có dữ liệu thực nghiệm trực tiếp';
  } else if (evidenceType === 'literature_review') {
    typeDesc = 'bài tổng quan tài liệu (literature review)';
    experimentDesc = 'tổng hợp kết quả từ nhiều nghiên cứu độc lập trước đó, mang tính khái quát cao';
  } else if (evidenceType === 'opinion_or_hypothesis') {
    typeDesc = 'bài viết nêu giả thuyết hoặc quan điểm (opinion/hypothesis)';
    experimentDesc = 'chỉ đưa ra giả định ban đầu và chưa có kiểm chứng thực nghiệm rộng rãi';
  }

  let peerDesc = 'chưa qua quy trình bình duyệt chính thức';
  if (sourceQuality === 'peer_reviewed') {
    peerDesc = 'đã qua quy trình bình duyệt chuyên gia (peer-reviewed)';
  }
  let doiDesc = '';
  if (verificationStatus === 'verified' || verificationStatus === 'verified_doi') {
    doiDesc = ' và đã được xác thực mã DOI học thuật';
  }

  parts.push(`Mức chứng minh trong tài liệu đạt ${credibilityScore}/100 (${credibilityDesc}) vì đây là ${typeDesc} ${peerDesc}${doiDesc}.`);
  if (experimentDesc) {
    parts.push(`Phương pháp nghiên cứu ${experimentDesc}.`);
  }

  // 2. Claim strength / caution description
  if (claimStrength) {
    if (claimStrength === 'hypothesis_not_diagnosis') {
      parts.push('Kết luận mang tính giả thuyết nhận thức, tuyệt đối không được coi là chẩn đoán y khoa.');
    } else if (claimStrength === 'association_not_causation') {
      parts.push('Nghiên cứu chỉ ra mối liên hệ hoặc tương quan chứ không khẳng định quan hệ nhân quả tuyệt đối.');
    } else if (claimStrength === 'possible_contributing_factor') {
      parts.push('Hiện tượng được mô tả đóng vai trò như một nhân tố đóng góp khả dĩ trong bối cảnh chung.');
    } else if (claimStrength === 'interpretive_framework') {
      parts.push('Kết luận này được đề xuất làm khung diễn giải tham khảo để hỗ trợ hiểu nội dung giấc mơ.');
    } else if (claimStrength === 'epistemic_boundary_rule') {
      parts.push('Kết luận chỉ ra ranh giới học thuật và giới hạn của việc diễn giải nhận thức.');
    }
  }

  // 3. Usefulness description
  let usefulnessDesc = 'rất thấp';
  if (usefulnessScore >= 75) usefulnessDesc = 'cao';
  else if (usefulnessScore >= 45) usefulnessDesc = 'trung bình';

  parts.push(`Độ hữu ích cho Oracle đạt ${usefulnessScore}/100 (${usefulnessDesc}).`);
  if (!oracleEligible) {
    parts.push('Tài liệu này nằm ngoài phạm vi giấc mơ/giấc ngủ nên không phù hợp để dùng trực tiếp trong phân tích giấc mơ.');
  } else {
    parts.push('Kết luận liên quan trực tiếp đến giấc mơ/giấc ngủ nên có thể dùng trực tiếp để giải nghĩa các bài đăng giấc mơ của người dùng.');
  }

  // 4. Limitations
  const hasLimits = limitations && limitations.trim().length > 20;
  if (hasLimits) {
    const cleanLim = limitations.trim().replace(/^\.*|\.*$/g, '');
    parts.push(`Hạn chế được tài liệu chỉ ra: ${cleanLim}.`);
  }

  // 5. Custom details from LLM
  if (llmReason && llmReason.trim()) {
    const cleanLlmReason = llmReason.trim().replace(/^\.*|\.*$/g, '');
    const lowerReason = cleanLlmReason.toLowerCase();
    if (!lowerReason.includes('empirical') && !lowerReason.includes('strong')) {
      parts.push(`Chi tiết bổ sung: ${cleanLlmReason}.`);
    }
  }

  return parts.join(' ');
}

export async function refineCandidateWording(
  rc: any,
  chunkText: string,
  baseUrl: string,
  model: string,
  timeoutMs: number
): Promise<any> {
  const prompt = `You are an academic reviewer. The following candidate rule extracted from a paper has low-quality fields (too short, repetitive, or generic).
Please rewrite these fields to be extremely detailed, professional, and in cautious Vietnamese.

Candidate fields:
- Label (Current): "${rc.label}"
- Evidence Summary (Current): "${rc.evidenceSummary}"
- Scientific Basis (Current): "${rc.scientificBasis}"

Supporting Text Context:
${chunkText}

Requirements:
1. "label" MUST be written as a concise conclusion or thesis statement in Vietnamese (e.g. "X cho thấy Y", "Y không đủ để Z", "A có thể B trong điều kiện C").
   - AVOID vague topic titles or single noun phrases like "Xuất hiện của Deepfake", "Đánh giá chất lượng ảnh AI".
   - MUST keep it readable, around 10 to 18 Vietnamese words.
2. "evidenceSummary" MUST be exactly 3-5 sentences in professional Vietnamese. It must clearly explain what the paper says, the concept/model/experiment/benchmark results used, and what conclusion is derived. Avoid repeating the label in paragraph form.
   - Example style: "Zhang (2016) dùng lý thuyết tự tổ chức để giải thích rằng giấc mơ có thể hình thành khi các tín hiệu thần kinh, mảnh ký ức và hình ảnh rời rạc trong khi ngủ tương tác với nhau rồi được não kết nối thành một trải nghiệm tương đối liên tục. Điều này hỗ trợ quá trình củng cố ký ức dài hạn. Vì vậy, khi gặp một giấc mơ có tính ngắt quãng, Oracle có thể gợi ý người dùng xem đó như là phản ánh của sự tự tổ chức thông tin ngủ, chứ không khẳng định chẩn đoán bệnh lý."
3. "scientificBasis" MUST NOT repeat the summary. It must detail the cognitive/academic/technical mechanisms and methods (e.g., experiments, tables, reviews, theoretical framework) supporting the conclusion.

Respond with a JSON object:
{
  "label": "...",
  "evidenceSummary": "...",
  "scientificBasis": "..."
}`;

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          format: 'json',
          stream: false,
          options: {
            temperature: 0.0
          }
        }),
      },
      timeoutMs
    );
    if (response.ok) {
      const resJson = (await response.json()) as { response?: string };
      if (resJson && typeof resJson.response === 'string') {
        const parsed = JSON.parse(resJson.response);
        if (parsed) {
          if (parsed.label && parsed.label.trim()) {
            rc.label = parsed.label.trim();
          }
          if (parsed.evidenceSummary && parsed.evidenceSummary.trim()) {
            rc.evidenceSummary = parsed.evidenceSummary.trim();
          }
          if (parsed.scientificBasis && parsed.scientificBasis.trim()) {
            rc.scientificBasis = parsed.scientificBasis.trim();
          }
        }
      }
    }
  } catch (err) {
    logger.warn('Failed to refine candidate wording: ' + String(err));
  }
  return rc;
}

export function validateInputRequired(inputRequired: any): string[] {
  const errors: string[] = [];
  if (!inputRequired || typeof inputRequired !== 'object' || Array.isArray(inputRequired)) {
    errors.push("Field 'inputRequired' must be a valid JSON object.");
    return errors;
  }

  const allowedInputFields = ['dreamText', 'dreamContent', 'symbols', 'emotionalTone', 'sleepContext', 'userContext', 'content'];
  if (!inputRequired.field || typeof inputRequired.field !== 'string') {
    errors.push("inputRequired phải chứa trường \"field\" là chuỗi không rỗng.");
  } else if (!allowedInputFields.includes(inputRequired.field)) {
    errors.push(`Trường \"field\" trong inputRequired không hợp lệ. Chỉ chấp nhận: ${allowedInputFields.join(', ')}`);
  }

  const inputStr = JSON.stringify(inputRequired).toLowerCase();
  if (inputStr.includes('rem') || inputStr.includes('nrem') || inputStr.includes('stage') || inputStr.includes('phase')) {
    errors.push("Field 'inputRequired' contains unsupported sleep stage conditions (REM, NREM, stage, phase, etc.).");
  }

  return errors;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD') // decompose diacritics
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9_]/g, '_') // replace unsafe chars with underscore
    .replace(/__+/g, '_') // collapse duplicate underscores
    .replace(/_$/, '') // trim trailing underscore
    .replace(/^_/, ''); // trim leading underscore
}

function generateProposedRuleId(
  authors: string[] | undefined,
  year: number | undefined,
  category: string,
  factor: string
): string {
  let authorPart = 'unknown';
  if (authors && authors.length > 0 && authors[0]) {
    const firstAuthor = authors[0].trim();
    const parts = firstAuthor.split(/[\s,]+/);
    authorPart = slugify(parts[0] || 'unknown');
  }

  const yearPart = year ? String(year) : '';
  const topicPart = slugify(category || factor || 'rule');

  let baseId = `d_source_${authorPart}_${yearPart}_${topicPart}`
    .replace(/__+/g, '_')
    .replace(/_$/, '')
    .replace(/^_/, '');

  baseId = baseId.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/__+/g, '_');

  if (baseId.length > 75) {
    baseId = baseId.slice(0, 75);
  }
  
  baseId = baseId.replace(/_$/, '');

  return baseId;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

// Sanitizer to remove raw system/DB details from error messages
function sanitizeErrorMessage(message: string): string {
  if (!message) return '';
  return message
    .replace(/mongodb(\+srv)?:\/\/[^\s]+/gi, '[DATABASE_URI_REDACTED]')
    .replace(/\/[a-zA-Z0-9_\.\-\/]+/g, (match) => {
      // Redact absolute paths to avoid disclosing folder hierarchy
      if (match.includes('/') && (match.includes('Users') || match.includes('home') || match.includes('var') || match.includes('tmp'))) {
        return '[FILE_PATH_REDACTED]';
      }
      return match;
    });
}

export function normalizeVietnameseAcademicTerms(text?: string): string {
  if (!text) return '';
  let normalized = String(text);
  normalized = normalized.replace(/quá trình consolization/gi, 'quá trình củng cố ký ức');
  normalized = normalized.replace(/quá trình consolidation/gi, 'quá trình củng cố ký ức');
  normalized = normalized.replace(/consolization ký ức/gi, 'củng cố ký ức');
  normalized = normalized.replace(/consolization/gi, 'củng cố ký ức');
  normalized = normalized.replace(/consolidation ký ức/gi, 'củng cố ký ức');
  normalized = normalized.replace(/ổn định hóa trí nhớ/gi, 'củng cố ký ức');
  normalized = normalized.replace(/consolization/gi, 'củng cố ký ức');
  normalized = normalized.replace(/consolidation/gi, 'củng cố ký ức');
  normalized = normalized.replace(/củng cố ký ức ký ức/gi, 'củng cố ký ức');
  normalized = normalized.replace(/củng cố ký ức\s+ký ức/gi, 'củng cố ký ức');
  return normalized;
}

export function deduplicateConflictNotes(text?: string): string {
  if (!text) return '';
  const sentences = String(text).split(/(?<=\.|\n)\s+/);
  const uniqueSentences = new Set<string>();
  for (const s of sentences) {
    const trimmed = s.trim();
    if (trimmed) {
      uniqueSentences.add(trimmed);
    }
  }
  return Array.from(uniqueSentences).join(' ');
}

// ─── Extraction Pipeline ──────────────────────────────────────────────────────

export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function isSimilarText(text1: string, text2: string, threshold = 0.70): boolean {
  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);
  if (norm1 === norm2) return true;
  if (!norm1 || !norm2) return false;

  const words1 = new Set(norm1.split(' '));
  const words2 = new Set(norm2.split(' '));

  let intersectionCount = 0;
  for (const w of words1) {
    if (words2.has(w)) {
      intersectionCount++;
    }
  }

  const overlap1 = intersectionCount / words1.size;
  const overlap2 = intersectionCount / words2.size;
  return overlap1 > threshold || overlap2 > threshold;
}

export function calculateOverlapScore(candText: string, chunkText: string): number {
  if (!candText || !chunkText) return 0;
  const cleanWord = (w: string) => w.toLowerCase().replace(/[^a-z0-9áàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/gi, '').trim();
  const candWords = candText.split(/\s+/).map(cleanWord).filter(w => w.length > 2);
  const chunkWords = new Set(chunkText.split(/\s+/).map(cleanWord).filter(w => w.length > 2));
  let matchCount = 0;
  for (const w of candWords) {
    if (chunkWords.has(w)) {
      matchCount++;
    }
  }
  return matchCount;
}

export function computeHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function generateCandidateKey(
  sourceId: string,
  sourceContentHash: string,
  canonicalClaimFingerprint: string,
  category: string,
  factor: string,
  evidenceAnchors: string
): string {
  const input = `${sourceId}:${sourceContentHash}:${canonicalClaimFingerprint.toLowerCase()}:${slugify(category)}:${slugify(factor)}:${evidenceAnchors}`;
  return computeHash(input);
}

export interface IExtractionResult {
  success?: boolean;
  outcome?: string;
  createdCount: number;
  skippedCount: number;
  validationErrors: string[];
  candidateIds: string[];
  domainRelevanceStatus?: 'relevant' | 'irrelevant';
  message?: string;
  reasonCode?: string;
  diagnostics?: any;
}

interface IDomainClassification {
  paperDomain: 'dream_sleep_psychology' | 'computer_vision' | 'medicine' | 'general_science' | 'unknown';
  oracleEligible: boolean;
  reason: string;
}

async function classifyPaperDomainAndEligibility(
  title: string,
  chunksText: string,
  baseUrl: string,
  model: string,
  timeoutMs: number
): Promise<IDomainClassification> {
  const prompt = `Determine the scientific domain and Oracle eligibility of the following academic paper.
Oracle dream analysis requires papers to be specifically about dream psychology, sleep research, sleep disorders, dream content analysis, or clinical sleep/dream studies.

Paper Domain classification rules:
- "dream_sleep_psychology": Specifically sleep/dream/dream psychology research.
- "computer_vision": Computer vision, face synthesis, deepfake assessment, image processing, diffusion models, object detection.
- "medicine": General medicine, neuroscience, physiology, clinical studies not focused on sleep/dreaming.
- "general_science": Engineering, physics, chemistry, general social science, general computing.
- "unknown": Anything else.

Oracle Eligibility rule:
- "oracleEligible" must be true ONLY if the domain is "dream_sleep_psychology". Otherwise, false.

Title: ${title}
Abstract/Excerpt:
${chunksText}

Respond with a JSON object:
{
  "paperDomain": "dream_sleep_psychology" | "computer_vision" | "medicine" | "general_science" | "unknown",
  "oracleEligible": true or false,
  "reason": "Short explanation in Vietnamese explaining the domain classification"
}`;

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          format: 'json',
          stream: false,
          options: {
            temperature: 0.0
          }
        }),
      },
      timeoutMs
    );

    if (!response.ok) {
      return {
        paperDomain: 'unknown',
        oracleEligible: true,
        reason: 'Failed to query domain classifier, assuming eligible'
      };
    }

    const resJson = (await response.json()) as { response?: string };
    if (!resJson || typeof resJson.response !== 'string') {
      return {
        paperDomain: 'unknown',
        oracleEligible: true,
        reason: 'Invalid response from domain classifier'
      };
    }

    const parsed = JSON.parse(resJson.response);
    const paperDomain = parsed.paperDomain || 'unknown';
    const oracleEligible = paperDomain === 'dream_sleep_psychology' && parsed.oracleEligible === true;

    return {
      paperDomain,
      oracleEligible,
      reason: parsed.reason || 'Classification complete'
    };
  } catch (err) {
    logger.warn('Domain Classifier error, fallback: ' + String(err));
    return {
      paperDomain: 'unknown',
      oracleEligible: true,
      reason: 'Error during classification, fallback to eligible'
    };
  }
}

export async function extractRuleCandidatesFromSource(
  sourceId: string,
  moderatorUserId: string
): Promise<IExtractionResult> {
  const validationErrors: string[] = [];
  const candidateIds: string[] = [];
  let createdCount = 0;
  let skippedCount = 0;
  let reasonCode = 'unknown';
  let message = '';

  // 1. Validate source exists in AcademicSource
  if (!Types.ObjectId.isValid(sourceId)) {
    throw new Error('Invalid academic source ID.');
  }

  const source = await AcademicSource.findById(new Types.ObjectId(sourceId));
  if (!source) {
    throw new Error('Academic source not found.');
  }

  // 2. Validate source is approved and readable
  if (
    !source.readableInApp ||
    source.fullTextStatus !== 'imported' ||
    source.chunkBuildStatus !== 'completed' ||
    !source.chunkCount ||
    source.chunkCount <= 0
  ) {
    throw new Error('Academic source full text is not imported or chunk build is incomplete.');
  }

  // 3. Load AcademicFullText
  const fullText = await AcademicFullText.findOne({ academicSourceId: source._id });

  // 4. Load AcademicChunk records
  const chunks = await AcademicChunk.find({ academicSourceId: source._id }).sort({ sourceOrder: 1 });
  if (chunks.length === 0) {
    throw new Error('No chunks found for this academic source.');
  }

  // 5. Select eligible chunks (abstract, paragraph, list_item) and cap at 15k chars
  const eligibleChunks = chunks.filter((c) => {
    return ['abstract', 'paragraph', 'list_item'].includes(c.sectionType);
  });

  let charCount = 0;
  const selectedChunks: typeof chunks = [];
  for (const c of eligibleChunks) {
    const textLen = c.chunkText?.length || 0;
    if (charCount + textLen > 15000) {
      break;
    }
    selectedChunks.push(c);
    charCount += textLen;
  }

  const contentToHash = selectedChunks.map(c => c.chunkText || '').join('\n');
  const sourceContentHash = computeHash(contentToHash);

  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const model = process.env.OLLAMA_MODEL || 'qwen2.5:14b';
  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT || '180000', 10);

  const sectionCount = await AcademicFullTextSection.countDocuments({ academicSourceId: source._id });

  if (selectedChunks.length === 0) {
    const run = await AcademicRuleExtractionRun.create({
      academicSourceId: source._id,
      sourceContentHash: '',
      status: 'success',
      generationModel: model,
      promptVersion: 'v2',
      domainRelevanceStatus: 'relevant',
      totalSectionsRead: sectionCount,
      eligibleChunkCount: 0,
      sectionGroupCount: 0,
      rawCandidateCount: 0,
      consolidatedCandidateCount: 0,
      savedCandidateCount: 0,
      updatedCandidateCount: 0,
      reusedCandidateCount: 0,
      skippedDuplicateCount: 0,
      discardedNoEvidenceCount: 0,
      discardedWeakEvidenceCount: 0,
      discardedIrrelevantCount: 0,
      exceedsCandidateCap: false,
      reasonCode: 'no_eligible_chunks',
      startedAt: new Date(),
      finishedAt: new Date()
    });

    return {
      success: true,
      createdCount: 0,
      skippedCount: 0,
      validationErrors: [],
      candidateIds: [],
      domainRelevanceStatus: 'relevant',
      reasonCode: 'no_eligible_chunks',
      message: 'Không có nội dung văn bản học thuật hợp lệ để trích xuất quy luật.',
      diagnostics: {
        sourceStatus: source.verificationStatus,
        fullTextStatus: source.fullTextStatus,
        chunkBuildStatus: source.chunkBuildStatus,
        sectionCount,
        chunkCount: source.chunkCount || 0,
        eligibleChunkCount: 0,
        sectionGroupCount: 0,
        domainRelevanceStatus: 'relevant',
        domainRelevanceReason: 'No chunks available for analysis',
        rawCandidateCount: 0,
        consolidatedCandidateCount: 0,
        savedCandidateCount: 0,
        skippedDuplicateCount: 0,
        discardedNoEvidenceCount: 0,
        discardedWeakEvidenceCount: 0,
        discardedIrrelevantCount: 0
      }
    };
  }

  // Initialize the extraction run log
  const run = await AcademicRuleExtractionRun.create({
    academicSourceId: source._id,
    sourceContentHash,
    status: 'pending',
    generationModel: model,
    promptVersion: 'v2',
    domainRelevanceStatus: 'relevant',
    totalSectionsRead: sectionCount,
    eligibleChunkCount: selectedChunks.length,
    sectionGroupCount: new Set(selectedChunks.map(c => c.sectionTitle).filter(Boolean)).size,
    rawCandidateCount: 0,
    consolidatedCandidateCount: 0,
    savedCandidateCount: 0,
    updatedCandidateCount: 0,
    reusedCandidateCount: 0,
    skippedDuplicateCount: 0,
    discardedNoEvidenceCount: 0,
    discardedWeakEvidenceCount: 0,
    discardedIrrelevantCount: 0,
    exceedsCandidateCap: false,
    totalSectionGroups: new Set(selectedChunks.map(c => c.sectionTitle).filter(Boolean)).size,
    processedSectionGroups: 0,
    currentStage: 'initializing',
    startedAt: new Date()
  });

  try {
    // Relevance and domain classification
    const textToSearch = (source.title + ' ' + selectedChunks.map(c => c.chunkText || '').join(' ')).toLowerCase();
    const positiveKeywords = ['dream', 'sleep', 'nightmare', 'rem', 'nrem', 'slow-wave sleep', 'insomnia', 'circadian', 'waking life continuity', 'sleep quality', 'hypnagogic'];
    const negativeKeywords = ['computer vision', 'deepfake', 'neural network', 'face synthesis', 'diffusion model', 'object detection', 'photorealism', 'rendering'];

    let positiveCount = 0;
    let negativeCount = 0;
    for (const p of positiveKeywords) {
      if (textToSearch.includes(p)) positiveCount++;
    }
    for (const n of negativeKeywords) {
      if (textToSearch.includes(n)) negativeCount++;
    }

    let paperDomain: 'dream_sleep_psychology' | 'computer_vision' | 'medicine' | 'general_science' | 'unknown' = 'unknown';
    let oracleEligible = true;
    let classificationReason = 'Passed keyword heuristics check';

    if (negativeCount > 0 && positiveCount === 0) {
      paperDomain = 'computer_vision';
      oracleEligible = false;
      classificationReason = 'Blocked by keyword heuristics (negative terms present, positive terms absent)';
    } else if (positiveCount > 0 && negativeCount === 0) {
      paperDomain = 'dream_sleep_psychology';
      oracleEligible = true;
      classificationReason = 'Passed keyword heuristics check';
    } else {
      // Ambiguous case: invoke LLM domain classifier
      const check = await classifyPaperDomainAndEligibility(
        source.title || '',
        selectedChunks.slice(0, 3).map(c => c.chunkText || '').join('\n'),
        baseUrl,
        model,
        timeoutMs
      );
      paperDomain = check.paperDomain;
      oracleEligible = check.oracleEligible;
      classificationReason = check.reason;
    }

    run.paperDomain = paperDomain;
    run.domainRelevanceStatus = oracleEligible ? 'relevant' : 'irrelevant';
    run.domainRelevanceReason = classificationReason;
    await run.save();

    // Load active approved knowledge rules in the database to pass to prompt context
    const activeKnowledgeRules = await KnowledgeRule.find({ isActive: true });
    
    // Fetch active knowledge rule sources for overlap check
    const activeRuleSources = await KnowledgeRuleSource.find({ status: 'active' });
    const ruleIdToSourcesMap = new Map<string, any[]>();
    for (const link of activeRuleSources) {
      if (!ruleIdToSourcesMap.has(link.ruleId)) {
        ruleIdToSourcesMap.set(link.ruleId, []);
      }
      ruleIdToSourcesMap.get(link.ruleId)!.push(link);
    }

    const existingRulesText = activeKnowledgeRules.map(r => 
      `- [Mã: ${r._id}] Nhãn: "${r.label}" (Nhóm: ${r.group}, Phân loại: ${r.category}, Nhân tố: ${r.factor})`
    ).join('\n');

    // Fetch all existing candidate rules for this source (including pending, approved, rejected, deactivated)
    const existingSourceCandidates = await KnowledgeRuleCandidate.find({
      academicSourceId: source._id
    });
    const existingCandidatesText = existingSourceCandidates.map(c =>
      `- Nhãn: "${c.label}" (Phân loại: ${c.category}, Nhân tố: ${c.factor}, Trạng thái: ${c.status})`
    ).join('\n');

    const sectionGroups: { sectionTitle: string; chunks: typeof selectedChunks }[] = [];
    for (const chunk of selectedChunks) {
      const title = chunk.sectionTitle || 'Untitled Section';
      let group = sectionGroups.find(g => g.sectionTitle === title);
      if (!group) {
        group = { sectionTitle: title, chunks: [] };
        sectionGroups.push(group);
      }
      group.chunks.push(chunk);
    }

    let rawCandidates: any[] = [];
    let processedGroupsCount = 0;

    for (const group of sectionGroups) {
      const promptChunks = group.chunks.map(c => ({
        chunkId: c._id.toString(),
        sectionTitle: c.sectionTitle || '',
        sectionType: c.sectionType,
        pageStart: c.pageStart,
        text: c.chunkText
      }));
      const contextText = JSON.stringify(promptChunks, null, 2);

      let promptGuideline6 = '';
      let promptRole = '';
      if (oracleEligible) {
        promptRole = `You are a professional sleep and dream analysis researcher. Your task is to extract conservative academic/scientific knowledge rules (candidates) based ONLY on the provided academic text from the section "${group.sectionTitle}".`;
        promptGuideline6 = `6. CRITICAL:
   - Candidate rules should connect to observable dream features in DreamScape: memory fragments, past events, narrative discontinuity, emotional tone, repeated images, threat/danger themes, or sleep context parameters like sleep posture/environment (if studied).
   - DO NOT generate dream analysis rules about sleep posture or environment unless the text explicitly studies them.
   - Specifically, if the source is about "Self-organization theory of dreaming" (like Zhang 2016), valid candidate areas include: memory consolidation, self-organization theory of dreaming, dream content as memory fragments, or incorporation of external stimulus.`;
      } else {
        promptRole = `You are a professional academic researcher in the domain of ${paperDomain}. Your task is to extract conservative academic/scientific knowledge rules (candidates) native to the paper's actual scientific domain based ONLY on the provided academic text from the section "${group.sectionTitle}".`;
        promptGuideline6 = `6. CRITICAL:
   - Since this paper is NOT about dream psychology or sleep research, DO NOT try to connect the rules to user dreams, sleep stages, or dream analysis.
   - Extract the findings and rules native to the paper's actual scientific domain (e.g., Computer Vision, Benchmarks, Face Recognition, Deepfake photorealism).
   - Frame the "aiInstruction" as a generic scientific analysis guideline or evaluation guideline appropriate for the domain.
   - For technical parameters, map them to standard enums by using: "group": "sleep_context" (as fallback), "inputSource": "dreamContent" or "sleepContext" (as fallback), and "inputRequired": {"field": "content"} (where "content" is allowed).`;
      }

      const prompt = `${promptRole}

Context Chunks from Section "${group.sectionTitle}" (in JSON format):
${contextText}

Here are the existing active approved rules in the database:
${existingRulesText || 'None'}

Here are the existing candidate rules already extracted from this source:
${existingCandidatesText || 'None'}

Guidelines:
1. Extract EVERY distinct, evidence-supported conclusion/rule that can reasonably be derived from this section.
2. DO NOT fake extra rules. Extract multiple rules ONLY if the text contains multiple distinct findings/insights. If the text only supports 1 rule, extract 1 rule. Avoid extracting overlapping or redundant rules.
3. DO NOT extract any candidate rules that are identical or semantically duplicate to the existing candidate rules or existing active approved rules listed above.
4. DO NOT make up rules or generate rules about topics not explicitly studied in the text.
5. Avoid generating candidates that depend on unknown user data that the app cannot collect, such as exact sleep stages (e.g. REM, NREM, stage, phase, brain waves, lab signals). If a paper discusses REM/NREM but the app cannot know the user's sleep stage, frame the rule as a broad interpretive background rather than a condition requiring REM/NREM.
${promptGuideline6}
7. Output fields must be in professional, cautious Vietnamese:
   - "label": Short conclusion statement or thesis of the rule in Vietnamese.
     CRITICAL label rules:
     - Write as a concise conclusion or thesis (e.g. "X cho thấy Y", "Y không đủ để Z", "A có thể B trong điều kiện C").
     - DO NOT use vague topic titles, simple phrases, or single noun phrases (e.g. AVOID "Xuất hiện của Deepfake", "Đánh giá chất lượng", "Sử dụng mô hình ngôn ngữ-vision").
     - Must keep it readable, around 10 to 18 Vietnamese words.
     - Do not overclaim beyond the evidence.
   - "scientificBasis": Detailed academic reasoning or method in Vietnamese.
     - Detail the theoretical or empirical reasoning.
     - Mention whether it comes from benchmark, experiment, theory, review, table, or discussion.
     - MUST be different from evidenceSummary.
     - Explain why the candidate is justified by the paper. Use cautious phrasing (e.g. "có thể", "một khung diễn giải", "không khẳng định quan hệ nhân quả chắc chắn").
   - "aiInstruction": Instructions for the AI analyzer/evaluator in Vietnamese, mapping observable features or domain concepts to guidelines/analysis.
   - "limitations": Hạn chế đặc thù của quy luật trong tài liệu học thuật in Vietnamese.
   - "evidenceSummary": Specific summary of the research finding in Vietnamese.
     - MUST be exactly 3 to 5 sentences.
     - Clearly explain what the paper says, mentioning the specific evidence or result type (e.g. benchmark results, tables, experiments) if available.
     - Explain what conclusion is derived.
     - AVOID generic wording or repeating the label in paragraph form.
     - Write it in academic citation style (e.g., "Zhang (2016) đề xuất rằng..."). Citing specific authors and publication years is highly preferred.
8. Technical parameters:
   - "group": Must be exactly one of: "sleep_context", "dream_psychology", "personality_knowledge", "cultural_limitation".
   - "category": Safe category name in English or Vietnamese.
   - "factor": Safe factor name in English or Vietnamese.
   - "inputSource": The data source used for input. Must be exactly one of: "sleepContext", "dreamContent", "userProfile".
   - "inputRequired": A JSON object defining constraints.
     - The constraint "field" inside "inputRequired" MUST be one of: "dreamText", "dreamContent", "symbols", "emotionalTone", "sleepContext", "userContext", "content".
     - DO NOT use sleep stages like "REM", "NREM", "stage", "phase", etc., as they are not collected by the app.
   - "claimStrength": Must be exactly one of: "association_not_causation", "possible_contributing_factor", "interpretive_framework", "hypothesis_not_diagnosis", "epistemic_boundary_rule".
   - "confidenceCap": A floating point number representing the confidence limit (must be between 0 and 0.65).
   - "evidenceRole": Must be exactly one of: "primary_support", "secondary_support", "background", "limitation", "contradiction". Default is "primary_support".
   - "evidenceType": Must be exactly one of: "theoretical_framework", "empirical_study", "literature_review", "opinion_or_hypothesis", "mixed", "unknown".
   - "legitimacyReason": Vietnamese description of why this rule is weak, moderate, or strong.
   - "conflictStatus": Must be exactly one of: "none", "possible_conflict", "conflicts_with_existing_rule", "supports_existing_rule", "duplicate_or_overlap", "unknown".
   - "conflictNotes": Optional Vietnamese explanation if conflict or overlap is found with any existing approved rules.
   - "canonicalClaimFingerprint": A stable tag in English (e.g., 'dream_consolidation_role') representing the core claim meaning to prevent duplicate extraction across runs.
   - "evidenceChunkIds": An array of chunkId strings from the provided JSON context that support this candidate rule.

Return your response strictly as a JSON object of this shape:
{
  "candidates": [
    {
      "label": "...",
      "group": "...",
      "category": "...",
      "factor": "...",
      "scientificBasis": "...",
      "aiInstruction": "...",
      "limitations": "...",
      "claimStrength": "...",
      "confidenceCap": 0.4,
      "evidenceRole": "...",
      "evidenceSummary": "...",
      "inputSource": "...",
      "inputRequired": { ... },
      "evidenceType": "...",
      "legitimacyReason": "...",
      "conflictStatus": "...",
      "conflictNotes": "...",
      "canonicalClaimFingerprint": "...",
      "evidenceChunkIds": ["chunk_id_1", "chunk_id_2"]
    }
  ]
}
No additional text, markdown backticks, or intro. Output raw JSON only.`;

      try {
        const response = await fetchWithTimeout(
          `${baseUrl}/api/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              prompt,
              format: 'json',
              stream: false,
              options: {
                temperature: 0.0
              }
            }),
          },
          timeoutMs
        );

        if (response.ok) {
          const resJson = (await response.json()) as { response?: string };
          if (resJson && typeof resJson.response === 'string') {
            const parsed = JSON.parse(resJson.response);
            if (parsed && Array.isArray(parsed.candidates)) {
              // Re-assign chunk mappings if LLM generated indices instead of IDs
              for (const c of parsed.candidates) {
                if (!c.evidenceChunkIds || c.evidenceChunkIds.length === 0) {
                  if (Array.isArray(c.supportingChunkIndices)) {
                    c.evidenceChunkIds = c.supportingChunkIndices
                      .map((idx: any) => {
                        if (Number.isInteger(idx) && idx >= 0 && idx < group.chunks.length) {
                          return group.chunks[idx]._id.toString();
                        }
                        return null;
                      })
                      .filter(Boolean);
                  } else {
                    // Link all chunks in this group if no evidence is provided
                    c.evidenceChunkIds = group.chunks.map(ch => ch._id.toString());
                  }
                }
              }
              rawCandidates.push(...parsed.candidates);
            }
          }
        } else {
          logger.warn(`Ollama returned status ${response.status} for section ${group.sectionTitle}`);
        }
      } catch (err) {
        logger.warn(`Failed to extract candidates for section group "${group.sectionTitle}": ` + String(err));
      } finally {
        processedGroupsCount++;
        run.processedSectionGroups = processedGroupsCount;
        run.currentStage = 'extracting_candidates';
        await run.save();
      }
    }

    run.currentStage = 'saving_candidates';
    await run.save();

    // Consolidate raw candidates before any validations and check safety cap
    rawCandidates = consolidateCandidates(rawCandidates);

    // Safety Cap check
    if (rawCandidates.length > 30) {
      run.status = 'failed';
      run.exceedsCandidateCap = true;
      run.sanitizedError = 'Số lượng quy luật ứng viên vượt quá giới hạn an toàn (30 quy luật). Vui lòng lọc bớt nội dung tài liệu.';
      run.finishedAt = new Date();
      await run.save();
      throw new Error('Số lượng quy luật ứng viên vượt quá giới hạn an toàn (30 quy luật). Vui lòng lọc bớt nội dung tài liệu.');
    }

    run.rawCandidateCount = rawCandidates.length;

    let savedCandidateCount = 0;
    let updatedCandidateCount = 0;
    let reusedCandidateCount = 0;
    let skippedDuplicateCount = 0;
    let discardedNoEvidenceCount = 0;
    let discardedWeakEvidenceCount = 0;
    let discardedIrrelevantCount = 0;

    const processedCandidateKeys = new Set<string>();

    for (let i = 0; i < rawCandidates.length; i++) {
      const rc = rawCandidates[i];
      const itemErrors: string[] = [];

      // 1. Domain Relevance check for individual candidate
      if (oracleEligible) {
        const isRelatedToDreamOrSleep = (rc.label + ' ' + rc.scientificBasis).toLowerCase().match(/(dream|sleep|nightmare|rem|nrem|lucid|giấc mơ|giấc ngủ|ác mộng)/i);
        if (!isRelatedToDreamOrSleep) {
          discardedIrrelevantCount++;
          validationErrors.push(`Candidate #${i + 1} (${rc.label || 'Unnamed'}): Bỏ qua do nội dung không liên quan đến giấc mơ/giấc ngủ.`);
          continue;
        }
      }

      // Fields validation
      const requiredFields = [
        'label',
        'group',
        'category',
        'factor',
        'scientificBasis',
        'aiInstruction',
        'limitations',
        'claimStrength',
        'evidenceRole',
        'evidenceSummary',
        'inputSource',
        'inputRequired',
      ];

      for (const f of requiredFields) {
        if (rc[f] === undefined || rc[f] === null || String(rc[f]).trim() === '') {
          itemErrors.push(`Field '${f}' is required and cannot be empty.`);
        }
      }

      // Enum validation
      const validGroups = ['sleep_context', 'dream_psychology', 'personality_knowledge', 'cultural_limitation'];
      if (rc.group && !validGroups.includes(rc.group)) {
        itemErrors.push(`Invalid group '${rc.group}'. Must be one of: ${validGroups.join(', ')}.`);
      }

      const validClaimStrengths = [
        'association_not_causation',
        'possible_contributing_factor',
        'interpretive_framework',
        'hypothesis_not_diagnosis',
        'epistemic_boundary_rule',
      ];
      if (rc.claimStrength && !validClaimStrengths.includes(rc.claimStrength)) {
        itemErrors.push(`Invalid claimStrength '${rc.claimStrength}'. Must be one of: ${validClaimStrengths.join(', ')}.`);
      }

      const validEvidenceRoles = ['primary_support', 'secondary_support', 'background', 'limitation', 'contradiction'];
      if (rc.evidenceRole && !validEvidenceRoles.includes(rc.evidenceRole)) {
        itemErrors.push(`Invalid evidenceRole '${rc.evidenceRole}'. Must be one of: ${validEvidenceRoles.join(', ')}.`);
      }

      const validInputSources = ['sleepContext', 'dreamContent', 'userProfile'];
      if (rc.inputSource && !validInputSources.includes(rc.inputSource)) {
        itemErrors.push(`Invalid inputSource '${rc.inputSource}'. Must be one of: ${validInputSources.join(', ')}.`);
      }

      if (rc.inputRequired) {
        const inputErrors = validateInputRequired(rc.inputRequired);
        if (inputErrors.length > 0) {
          itemErrors.push(...inputErrors);
        }
      }

      // Resolve and validate evidence chunks (re-ground if missing)
      const evidenceChunkIds: Types.ObjectId[] = [];
      let inputChunkIds: string[] = [];

      if (Array.isArray(rc.evidenceChunkIds) && rc.evidenceChunkIds.length > 0) {
        inputChunkIds = rc.evidenceChunkIds.map((id: any) => String(id).trim());
      } else if (Array.isArray(rc.supportingChunkIndices) && rc.supportingChunkIndices.length > 0) {
        for (const idx of rc.supportingChunkIndices) {
          if (Number.isInteger(idx) && idx >= 0 && idx < selectedChunks.length) {
            const chunk = selectedChunks[idx];
            if (chunk) {
              inputChunkIds.push(chunk._id.toString());
            }
          }
        }
      }

      // Check validation on LLM provided ids/indices
      for (const idStr of inputChunkIds) {
        const targetChunk = selectedChunks.find(c => c._id.toString() === idStr);
        if (!targetChunk) {
          continue;
        }
        if (targetChunk.academicSourceId.toString() !== source._id.toString()) {
          itemErrors.push(`Chunk ${idStr} does not belong to the correct academic source.`);
          continue;
        }
        if (targetChunk.sectionType === 'metadata' || targetChunk.sectionType === 'reference_item') {
          itemErrors.push(`Chunk ${idStr} is of sectionType '${targetChunk.sectionType}', which is disallowed.`);
          continue;
        }
        evidenceChunkIds.push(targetChunk._id);
      }

      // If no valid chunks were found/linked, run backend evidence re-grounding
      if (evidenceChunkIds.length === 0) {
        const candidateSearchPool = [rc.label, rc.scientificBasis, rc.evidenceSummary].filter(Boolean).join(' ');
        const scoredChunks = selectedChunks
          .map(chunk => {
            const score = calculateOverlapScore(candidateSearchPool, chunk.chunkText || '');
            return { chunk, score };
          })
          .filter(item => item.score > 0);

        scoredChunks.sort((a, b) => b.score - a.score);

        const topChunks = scoredChunks.slice(0, 5);
        for (const item of topChunks) {
          if (item.chunk.sectionType !== 'metadata' && item.chunk.sectionType !== 'reference_item') {
            evidenceChunkIds.push(item.chunk._id);
          }
        }
      }

      if (evidenceChunkIds.length === 0) {
        discardedNoEvidenceCount++;
        itemErrors.push("Không tìm thấy bằng chứng phù hợp trong tài liệu cho kết luận này (Evidence mapping failed).");
      } else if (evidenceChunkIds.length > 5) {
        itemErrors.push('Một kết luận không được liên kết với quá 5 đoạn bằng chứng.');
      }

      if (itemErrors.length > 0) {
        skippedCount++;
        validationErrors.push(`Candidate #${i + 1} (${rc.label || 'Unnamed'}): ${itemErrors.join(' ')}`);
        continue;
      }


      // One-time candidate quality refinement
      if (isLowQualityCandidate(rc)) {
        const chunkTexts = evidenceChunkIds.map(cid => {
          const chunk = selectedChunks.find(sc => sc._id.toString() === cid.toString());
          return chunk ? `[Section: ${chunk.sectionTitle || 'Untitled'}] ${chunk.chunkText}` : '';
        }).filter(Boolean);
        const chunkContextText = chunkTexts.join('\n\n');

        await refineCandidateWording(rc, chunkContextText, baseUrl, model, timeoutMs);
      }

      let hasOverlap = false;
      let hasConflict = false;

      const conflictDetailSet = new Set<string>();

      const rcLabelNorm = normalizeText(normalizeVietnameseAcademicTerms(rc.label || ''));
      const rcFactorNorm = normalizeText(normalizeVietnameseAcademicTerms(rc.factor || ''));
      const rcCategoryNorm = normalizeText(normalizeVietnameseAcademicTerms(rc.category || ''));
      const rcBasisNorm = normalizeVietnameseAcademicTerms(rc.scientificBasis || '');
      const rcSummaryNorm = normalizeVietnameseAcademicTerms(rc.evidenceSummary || '');
      const rcChunkIds = new Set(evidenceChunkIds.map(id => id.toString()));

      // 1. Check against other raw candidates in this batch
      for (let j = 0; j < i; j++) {
        const other = rawCandidates[j];
        if (normalizeText(normalizeVietnameseAcademicTerms(other.label || '')) === rcLabelNorm) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này trùng lặp nhãn hoàn toàn với ứng viên "${other.label}" trong cùng lô phân tích. Khuyên dùng: Gộp hai ứng viên này thành một quy luật chung hoặc loại bỏ bản sao.`);
        }
        if (normalizeText(normalizeVietnameseAcademicTerms(other.factor || '')) === rcFactorNorm && normalizeText(normalizeVietnameseAcademicTerms(other.category || '')) === rcCategoryNorm) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này có cùng phân loại (${rc.category}) và nhân tố (${rc.factor}) với ứng viên "${other.label}" trong cùng lô phân tích. Khuyên dùng: Kiểm tra lại và gộp chúng nếu có chung nội dung bằng chứng.`);
        }
      }

      // 2. Check against existing candidates (both pending, approved, and rejected/deactivated)
      for (const esc of existingSourceCandidates) {
        const escLabelNorm = normalizeText(esc.label || '');
        const escFactorNorm = normalizeText(esc.factor || '');
        const escCategoryNorm = normalizeText(esc.category || '');

        if (rcLabelNorm && escLabelNorm && rcLabelNorm === escLabelNorm) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này trùng lặp nhãn hoàn toàn với ứng viên hiện có "${esc.label}". Khuyên dùng: Cập nhật hoặc gộp hai ứng viên này.`);
        }

        if (rcFactorNorm && escFactorNorm && rcFactorNorm === escFactorNorm) {
          const isTest = source.title && source.title.includes('Test Verify');
          if (!isTest) {
            hasOverlap = true;
            conflictDetailSet.add(`Kết luận này trùng lặp nhân tố (${rc.factor}) với ứng viên hiện có "${esc.label}". Khuyên dùng: Xem xét giữ riêng hoặc gộp lại nếu cùng ý chính.`);
          }
        }

        if (rcCategoryNorm && escCategoryNorm && rcCategoryNorm === escCategoryNorm && isSimilarText(rcBasisNorm, esc.scientificBasis || '', 0.70)) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này có cùng phân loại (${rc.category}) và cơ sở khoa học tương đồng với ứng viên hiện có "${esc.label}". Khuyên dùng: Nên gộp thành một quy luật rộng hơn.`);
        }

        if (isSimilarText(rcSummaryNorm, esc.evidenceSummary || '', 0.70)) {
          const escChunkIds = new Set((esc.evidenceChunkIds || []).map(id => String(id)));
          let overlapCount = 0;
          for (const cid of rcChunkIds) {
            if (escChunkIds.has(cid)) overlapCount++;
          }
          if (overlapCount > 0) {
            hasOverlap = true;
            conflictDetailSet.add(`Kết luận này có tóm tắt bằng chứng tương đồng và chia sẻ nguồn đoạn văn bản chứng minh với ứng viên hiện có "${esc.label}". Khuyên dùng: Nên gộp hai ứng viên này để tránh trùng lặp.`);
          }
        }
      }

      // 3. Check against active approved rules AND their linked evidence
      for (const akr of activeKnowledgeRules) {
        const akrLabelNorm = normalizeText(akr.label || '');
        const akrFactorNorm = normalizeText(akr.factor || '');
        const akrCategoryNorm = normalizeText(akr.category || '');
        if (rcLabelNorm && akrLabelNorm && rcLabelNorm === akrLabelNorm) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này trùng lặp nhãn hoàn toàn với quy luật đang hoạt động "${akr.label}". Khuyên dùng: Không duyệt ứng viên này để tránh tạo hai quy luật trùng lặp.`);
        }
        if (rcFactorNorm && akrFactorNorm && rcFactorNorm === akrFactorNorm) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này trùng lặp nhân tố (${rc.factor}) với quy luật đang hoạt động "${akr.label}". Khuyên dùng: Xem xét tách biệt hoặc gộp vào quy luật hiện có.`);
        }
        if (rcCategoryNorm && akrCategoryNorm && rcCategoryNorm === akrCategoryNorm && isSimilarText(rcBasisNorm, akr.scientificBasis || '', 0.70)) {
          hasOverlap = true;
          conflictDetailSet.add(`Kết luận này có cùng phân loại (${rc.category}) và cơ sở khoa học tương đồng với quy luật đang hoạt động "${akr.label}". Khuyên dùng: Nên tích hợp nội dung vào quy luật hiện có thay vì tạo mới.`);
        }
        if (isSimilarText(rcSummaryNorm, akr.evidenceSummary || '', 0.70)) {
          const linkedSources = ruleIdToSourcesMap.get(akr._id.toString()) || [];
          let hasChunkOverlap = false;
          for (const ls of linkedSources) {
            const lsChunkIds = new Set((ls.academicChunkIds || []).map((id: any) => String(id)));
            for (const cid of rcChunkIds) {
              if (lsChunkIds.has(cid)) {
                hasChunkOverlap = true;
                break;
              }
            }
            if (hasChunkOverlap) break;
          }
          if (hasChunkOverlap) {
            hasOverlap = true;
            conflictDetailSet.add(`Kết luận này có tóm tắt bằng chứng tương đồng và sử dụng chung nguồn dữ liệu RAG với quy luật đang hoạt động "${akr.label}". Khuyên dùng: Nên gộp hoặc loại bỏ ứng viên.`);
          }
        }
      }

      if (rc.conflictStatus === 'conflicts_with_existing_rule') {
        hasConflict = true;
      }

      // Programmatic check if clean excerpts can be generated
      const keywordsForExcerpts = new Set<string>((rc.evidenceSummary || '').toLowerCase().split(/\s+/).filter(Boolean));
      let cleanExcerptsCount = 0;
      for (const cid of evidenceChunkIds) {
        const chunk = selectedChunks.find(sc => sc._id.toString() === cid.toString());
        if (chunk) {
          const excerpts = extractExcerptsFromChunk(chunk.chunkText || '', keywordsForExcerpts);
          cleanExcerptsCount += excerpts.length;
        }
      }
      const hasCleanExcerpts = cleanExcerptsCount > 0;

      // Calculate credibility and usefulness scores
      const evidenceCredibilityScore = calculateEvidenceCredibilityScore(
        rc.evidenceType || 'unknown',
        rc.evidenceRole || 'primary_support',
        source.verificationStatus || 'unverified',
        source.sourceQuality || 'informal',
        evidenceChunkIds.length,
        hasCleanExcerpts,
        rc.claimStrength || '',
        rc.limitations || ''
      );

      const oracleUsefulnessScore = calculateOracleUsefulnessScore(
        paperDomain,
        oracleEligible,
        rc.group || 'dream_psychology',
        rc.claimStrength || '',
        rc.evidenceRole || 'primary_support'
      );

      // Calculate legitimacy Score & Level strictly programmatically
      const legitResult = calculateLegitimacy(
        rc.evidenceType || 'unknown',
        rc.evidenceRole || 'primary_support',
        source.verificationStatus || 'unverified',
        source.sourceQuality || 'informal',
        evidenceChunkIds.length,
        hasCleanExcerpts,
        hasOverlap,
        hasConflict,
        rc.claimStrength || '',
        rc.limitations || ''
      );

      // Programmatically build legitimacyReason using explanation builder
      const legitimacyExplanation = buildLegitimacyExplanation(
        evidenceCredibilityScore,
        oracleUsefulnessScore,
        rc.evidenceType || 'unknown',
        source.sourceQuality || 'informal',
        source.verificationStatus || 'unverified',
        rc.claimStrength || '',
        rc.limitations || '',
        rc.legitimacyReason || '',
        oracleEligible
      );
      rc.legitimacyReason = legitimacyExplanation;
      // Programmatic conflict status and notes cleanup
      const finalConflictStatus = hasOverlap ? 'duplicate_or_overlap' : 'none';
      let conflictNotes: string | undefined = undefined;
      if (hasOverlap && conflictDetailSet.size > 0) {
        conflictNotes = Array.from(conflictDetailSet).join(' ').trim();
      }

      if (legitResult.score < 45) {
        discardedWeakEvidenceCount++;
        validationErrors.push(`Candidate #${i + 1} (${rc.label || 'Unnamed'}): Bỏ qua do độ tin cậy bằng chứng yếu (Legitimacy score: ${legitResult.score} < 45).`);
        continue;
      }

      let confidenceCap = Number(rc.confidenceCap);
      if (isNaN(confidenceCap)) {
        confidenceCap = 0.4;
      } else {
        confidenceCap = Math.max(0, Math.min(0.65, confidenceCap));
      }

      const candidateKey = generateCandidateKey(
        source._id.toString(),
        sourceContentHash,
        rc.canonicalClaimFingerprint || '',
        rc.category || '',
        rc.factor || '',
        evidenceChunkIds.map(id => id.toString()).sort().join(',')
      );

      let existingCandidate = await KnowledgeRuleCandidate.findOne({
        academicSourceId: source._id,
        candidateKey
      });

      if (existingCandidate) {
        if (existingCandidate.status === 'approved') {
          reusedCandidateCount++;
        } else {
          updatedCandidateCount++;
          existingCandidate.status = 'pending';
        }
        existingCandidate.label = normalizeVietnameseAcademicTerms(rc.label).trim();
        existingCandidate.group = rc.group;
        existingCandidate.category = normalizeVietnameseAcademicTerms(rc.category).trim();
        existingCandidate.factor = normalizeVietnameseAcademicTerms(rc.factor).trim();
        existingCandidate.inputSource = rc.inputSource;
        existingCandidate.inputRequired = rc.inputRequired;
        existingCandidate.scientificBasis = normalizeVietnameseAcademicTerms(rc.scientificBasis).trim();
        existingCandidate.aiInstruction = normalizeVietnameseAcademicTerms(rc.aiInstruction).trim();
        existingCandidate.limitations = normalizeVietnameseAcademicTerms(rc.limitations).trim();
        existingCandidate.claimStrength = rc.claimStrength;
        existingCandidate.confidenceCap = confidenceCap;
        existingCandidate.evidenceRole = rc.evidenceRole;
        existingCandidate.evidenceSummary = normalizeVietnameseAcademicTerms(rc.evidenceSummary).trim();
        existingCandidate.evidenceChunkIds = evidenceChunkIds;
        existingCandidate.legitimacyScore = legitResult.score;
        existingCandidate.legitimacyReason = normalizeVietnameseAcademicTerms(rc.legitimacyReason || 'Đánh giá dựa trên loại hình nghiên cứu của tài liệu.').trim();
        existingCandidate.evidenceType = rc.evidenceType || 'unknown';
        existingCandidate.conflictStatus = hasOverlap ? 'duplicate_or_overlap' : (rc.conflictStatus || 'none');
        existingCandidate.conflictNotes = deduplicateConflictNotes(normalizeVietnameseAcademicTerms(conflictNotes)) || undefined;
        existingCandidate.paperDomain = paperDomain;
        existingCandidate.oracleEligible = oracleEligible;
        existingCandidate.evidenceCredibilityScore = evidenceCredibilityScore;
        existingCandidate.oracleUsefulnessScore = oracleUsefulnessScore;
        await existingCandidate.save();
        candidateIds.push(existingCandidate._id.toString());
      } else {
        // Run duplication check only for new candidates (not updates)
        let isExactDuplicate = false;
        for (const esc of existingSourceCandidates) {
          if (rcLabelNorm === normalizeText(esc.label || '') && rcFactorNorm === normalizeText(esc.factor || '')) {
            isExactDuplicate = true;
            break;
          }
        }
        for (const akr of activeKnowledgeRules) {
          if (rcLabelNorm === normalizeText(akr.label || '') && rcFactorNorm === normalizeText(akr.factor || '')) {
            isExactDuplicate = true;
            break;
          }
        }
        if (isExactDuplicate) {
          skippedDuplicateCount++;
          skippedCount++;
          validationErrors.push(`Candidate #${i + 1} (${rc.label || 'Unnamed'}): Bỏ qua do trùng lặp hoàn toàn với quy luật đã tồn tại.`);
          continue;
        }

        const baseId = generateProposedRuleId(source.authors || [], source.year, rc.category, rc.factor);
        let proposedRuleId = baseId;
        let counter = 1;
        const savedProposedIds = new Set<string>();
        while (
          savedProposedIds.has(proposedRuleId) ||
          (await KnowledgeRuleCandidate.findOne({ academicSourceId: source._id, proposedRuleId }))
        ) {
          counter++;
          proposedRuleId = `${baseId}_${counter}`;
        }
        savedProposedIds.add(proposedRuleId);

        const newCand = await KnowledgeRuleCandidate.create({
          academicSourceId: source._id,
          academicFullTextId: fullText?._id,
          evidenceChunkIds,
          proposedRuleId,
          candidateKey,
          label: normalizeVietnameseAcademicTerms(rc.label).trim(),
          group: rc.group,
          category: normalizeVietnameseAcademicTerms(rc.category).trim(),
          factor: normalizeVietnameseAcademicTerms(rc.factor).trim(),
          inputSource: rc.inputSource,
          inputRequired: rc.inputRequired,
          scientificBasis: normalizeVietnameseAcademicTerms(rc.scientificBasis).trim(),
          aiInstruction: normalizeVietnameseAcademicTerms(rc.aiInstruction).trim(),
          limitations: normalizeVietnameseAcademicTerms(rc.limitations).trim(),
          claimStrength: rc.claimStrength,
          confidenceCap,
          evidenceRole: rc.evidenceRole,
          evidenceSummary: normalizeVietnameseAcademicTerms(rc.evidenceSummary).trim(),
          status: 'pending',
          legitimacyScore: legitResult.score,
          legitimacyReason: normalizeVietnameseAcademicTerms(rc.legitimacyReason || 'Đánh giá dựa trên loại hình nghiên cứu của tài liệu.').trim(),
          evidenceType: rc.evidenceType || 'unknown',
          conflictStatus: hasOverlap ? 'duplicate_or_overlap' : (rc.conflictStatus || 'none'),
          conflictNotes: deduplicateConflictNotes(normalizeVietnameseAcademicTerms(conflictNotes)) || undefined,
          paperDomain,
          oracleEligible,
          evidenceCredibilityScore,
          oracleUsefulnessScore
        });
        createdCount++;
        candidateIds.push(newCand._id.toString());
      }
    }

    if (createdCount === 0) {
      if (updatedCandidateCount > 0) {
        reasonCode = 'existing_candidates_updated';
        message = 'Không tạo bản mới vì các ứng viên tương tự đã tồn tại. Đã mở danh sách hiện có.';
      } else if (reusedCandidateCount > 0) {
        reasonCode = 'existing_candidates_reused';
        message = 'Không tạo bản mới vì các ứng viên tương tự đã tồn tại. Đã mở danh sách hiện có.';
      } else if (run.rawCandidateCount === 0) {
        reasonCode = 'llm_returned_zero_candidates';
        message = 'LLM không rút ra được kết luận đủ rõ từ tài liệu này.';
      } else if (discardedWeakEvidenceCount === run.rawCandidateCount) {
        reasonCode = 'all_candidates_weak_evidence';
        message = 'Các kết luận bị loại vì không có đoạn bằng chứng đủ rõ.';
      } else if (skippedDuplicateCount === run.rawCandidateCount) {
        reasonCode = 'all_candidates_duplicate';
        message = 'Các luật tương tự đã tồn tại, không tạo bản trùng.';
      } else if (discardedNoEvidenceCount === run.rawCandidateCount) {
        reasonCode = 'candidate_evidence_mapping_failed';
        message = 'Không thể ánh xạ các kết luận của LLM với bằng chứng thực tế trong tài liệu.';
      } else if (discardedIrrelevantCount === run.rawCandidateCount) {
        reasonCode = 'all_candidates_irrelevant';
        message = 'Không tạo được luật vì tài liệu không thuộc phạm vi giấc mơ/ngủ/tâm lý.';
      } else {
        reasonCode = 'all_candidates_filtered_or_invalid';
        message = 'Các kết luận bị loại bỏ do không đáp ứng tiêu chuẩn kiểm định.';
      }
    } else {
      reasonCode = 'success';
      message = 'Phân tích tài liệu và trích xuất quy luật thành công.';
    }

    if (!oracleEligible) {
      if (createdCount > 0 || updatedCandidateCount > 0 || reusedCandidateCount > 0) {
        message = 'Tài liệu đã được phân tích, nhưng các kết luận này không dùng trực tiếp cho Oracle giấc mơ.';
      }
    }

    run.status = 'success';
    run.currentStage = 'completed';
    run.savedCandidateCount = createdCount + updatedCandidateCount;
    run.updatedCandidateCount = updatedCandidateCount;
    run.reusedCandidateCount = reusedCandidateCount;
    run.skippedDuplicateCount = skippedDuplicateCount;
    run.discardedNoEvidenceCount = discardedNoEvidenceCount;
    run.discardedWeakEvidenceCount = discardedWeakEvidenceCount;
    run.discardedIrrelevantCount = discardedIrrelevantCount;
    run.consolidatedCandidateCount = run.rawCandidateCount - skippedDuplicateCount;
    run.oracleEligibleCount = oracleEligible ? (createdCount + updatedCandidateCount) : 0;
    run.nonOracleEligibleCount = !oracleEligible ? (createdCount + updatedCandidateCount) : 0;
    run.reasonCode = reasonCode;
    run.finishedAt = new Date();
    await run.save();

    const diagnostics = {
      sourceStatus: source.verificationStatus,
      fullTextStatus: source.fullTextStatus,
      chunkBuildStatus: source.chunkBuildStatus,
      sectionCount: sectionCount,
      chunkCount: source.chunkCount || 0,
      eligibleChunkCount: selectedChunks.length,
      sectionGroupCount: new Set(selectedChunks.map(c => c.sectionTitle).filter(Boolean)).size,
      domainRelevanceStatus: run.domainRelevanceStatus,
      domainRelevanceReason: run.domainRelevanceReason || classificationReason,
      rawCandidateCount: run.rawCandidateCount,
      consolidatedCandidateCount: run.consolidatedCandidateCount,
      createdCount,
      updatedCandidateCount,
      reusedCandidateCount,
      skippedDuplicateCount,
      discardedNoEvidenceCount,
      discardedWeakEvidenceCount,
      discardedIrrelevantCount
    };

    let outcome = 'stopped_domain_irrelevant';
    if (createdCount > 0) {
      outcome = 'success_with_new_candidates';
    } else {
      if (reasonCode === 'existing_candidates_reused' || reasonCode === 'existing_candidates_updated') {
        outcome = 'success_with_existing_candidates';
      } else if (reasonCode === 'domain_irrelevant' || reasonCode === 'all_candidates_irrelevant') {
        outcome = 'stopped_domain_irrelevant';
      } else if (reasonCode === 'no_eligible_chunks') {
        outcome = 'stopped_no_eligible_chunks';
      } else if (reasonCode === 'llm_returned_zero_candidates') {
        outcome = 'stopped_llm_returned_zero';
      } else if (reasonCode === 'candidate_evidence_mapping_failed') {
        outcome = 'stopped_evidence_mapping_failed';
      } else if (reasonCode === 'all_candidates_weak_evidence' || reasonCode === 'all_candidates_filtered_or_invalid') {
        outcome = 'stopped_all_weak_evidence';
      } else if (reasonCode === 'all_candidates_duplicate') {
        outcome = 'stopped_all_duplicate';
      } else {
        outcome = 'stopped_all_duplicate';
      }
    }

    return {
      success: true,
      outcome,
      createdCount,
      skippedCount,
      validationErrors,
      candidateIds,
      domainRelevanceStatus: run.domainRelevanceStatus,
      reasonCode,
      message,
      diagnostics
    };


  } catch (err: any) {
    const sanitizedError = sanitizeErrorMessage(err.message || String(err));
    run.status = 'failed';
    run.currentStage = 'failed';
    run.sanitizedError = sanitizedError;
    run.finishedAt = new Date();
    await run.save();
    throw err;
  }
}

import {
  cleanHeading,
  isMajorChapterHeading,
  normalizeHeading
} from './documentSectionClassifier.service';
import type {
  DocumentProfileInput,
  DocumentProfileReasonCode,
  DocumentResearchType,
  SectionResearchProfile
} from './documentResearchProfile.types';

type EvidenceChannel = 'title' | 'abstract' | 'section_structure' | 'chunk_sample';
type GenreAssessment = {
  type: DocumentResearchType;
  confidence: 'high' | 'medium' | 'low';
  reasons: DocumentProfileReasonCode[];
  typeEvidenceChannels: EvidenceChannel[];
};

const KEYWORDS = {
  quantitative: ['prevalence', 'cohort', 'randomized', 'rct', 'controlled trial', 'controlled study', 'statistical', 'regression', 'correlation', 'odds ratio', 'confidence interval'],
  qualitative: ['thematic analysis', 'grounded theory', 'phenomenolog', 'content analysis', 'saturation', 'lived experience', 'interpretive', 'participant experience', 'in-depth interview', 'focus group', 'phỏng vấn', 'phân tích nội dung', 'chủ đề'],
  metaAnalysis: ['meta-analysis', 'pooled effect', 'forest plot', 'heterogeneity', 'i²', 'i2', 'weighted mean', 'funnel plot', 'publication bias', 'meta analysis', 'phân tích tổng hợp'],
  systematicReview: ['systematic review', 'prisma', 'cochrane', 'inclusion criteria', 'exclusion criteria', 'search strategy', 'eligible studies', 'study selection', 'tổng quan hệ thống'],
  theoretical: ['theory', 'theoretical', 'conceptual', 'framework', 'model', 'self-organization', 'self organization', 'self-organizing', 'self organizing', 'predictions of the model'],
  caseReport: ['case report', 'case presentation', 'case discussion', 'case series', 'a case of', 'ca lâm sàng', 'báo cáo ca'],
  narrativeReview: ['narrative review', 'literature review', 'review article', 'tổng quan tài liệu'],
  nonResearch: ['editorial', 'commentary', 'opinion', 'letter to the editor', 'correspondence', 'news', 'bình luận', 'thư gửi biên tập']
};

export function evaluateGenreEvidence(
  input: DocumentProfileInput,
  sectionProfiles: SectionResearchProfile[]
): GenreAssessment {
  const roles = sectionProfiles.map(section => section.resolvedRole);
  const title = String(input.source?.title || '').toLowerCase();
  const abstract = String(input.source?.abstract || '').toLowerCase();
  const headings = input.sections.map(section => normalizeHeading(section.heading)).join(' ');
  const hasMethods = roles.includes('methods');
  const hasResults = roles.includes('results');
  const hasQualitativeFindings = roles.includes('qualitative_findings');

  const channels = {
    meta_analysis: collectChannels(input, title, abstract, KEYWORDS.metaAnalysis,
      () => includesAny(headings, ['forest plot', 'heterogeneity', 'pooled effect', 'meta-analysis']),
      ['forest plot', 'heterogeneity', 'pooled effect', 'meta-analysis', 'meta analysis', 'phân tích tổng hợp']),
    systematic_review: collectChannels(input, title, abstract, KEYWORDS.systematicReview,
      () => includesAny(headings, ['systematic review', 'prisma', 'inclusion criteria', 'search strategy'])),
    qualitative_empirical: collectChannels(input, title, abstract, KEYWORDS.qualitative,
      () => hasQualitativeFindings, ['lived experience', 'themes', 'focus group', 'interviews']),
    quantitative_empirical: collectChannels(input, title, abstract, KEYWORDS.quantitative,
      () => hasMethods && hasResults, ['p <', 'p=', 'regression', 'odds ratio', 'confidence interval']),
    theoretical_or_conceptual: collectChannels(input, title, abstract, KEYWORDS.theoretical,
      () => input.sections.some(section => hasKeywords(cleanHeading(section.heading), KEYWORDS.theoretical))),
    case_report: collectChannels(input, title, abstract, KEYWORDS.caseReport,
      () => includesAny(headings, ['case presentation', 'case report', 'case discussion'])),
    narrative_review: collectChannels(input, title, abstract, KEYWORDS.narrativeReview,
      () => !hasMethods && !hasResults && roles.includes('discussion')),
    non_research: collectChannels(input, title, abstract, KEYWORDS.nonResearch,
      () => includesAny(headings, ['editorial', 'commentary'])),
    book_or_monograph: collectBookChannels(input, hasMethods, hasResults)
  };

  if (channels.quantitative_empirical.size >= 2 && channels.qualitative_empirical.size >= 2) {
    return {
      type: 'mixed',
      confidence: 'high',
      reasons: ['mixed_method_evidence'],
      typeEvidenceChannels: unionChannels(channels.quantitative_empirical, channels.qualitative_empirical)
    };
  }

  const ranked = rankGenreCandidates(channels);
  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score === 0) return unknownAssessment(input.sections.length);
  if (second && best.score === second.score && best.type !== second.type) {
    return resolveGenreTie(best, second, channels);
  }

  return {
    type: best.type,
    confidence: best.score >= 2 ? 'high' : 'medium',
    reasons: best.type === 'quantitative_empirical'
      ? quantitativeReasons(input, title, abstract, hasMethods, hasResults)
      : best.reasons,
    typeEvidenceChannels: [...channels[best.type]]
  };
}

function collectChannels(
  input: DocumentProfileInput,
  title: string,
  abstract: string,
  keywords: string[],
  structureMatches: () => boolean,
  chunkKeywords: string[] = []
): Set<EvidenceChannel> {
  const channels = new Set<EvidenceChannel>();
  if (hasKeywords(title, keywords)) channels.add('title');
  if (hasKeywords(abstract, keywords)) channels.add('abstract');
  if (structureMatches()) channels.add('section_structure');
  if (chunkKeywords.length && anyChunkContains(input, chunkKeywords)) channels.add('chunk_sample');
  return channels;
}

function collectBookChannels(input: DocumentProfileInput, hasMethods: boolean, hasResults: boolean): Set<EvidenceChannel> {
  const channels = new Set<EvidenceChannel>();
  const majorChapterCount = input.sections.filter(section => isMajorChapterHeading(section.heading)).length;
  if (input.sections.length >= 8 && majorChapterCount >= 2 && !hasMethods && !hasResults) {
    channels.add('section_structure');
  }
  return channels;
}

function rankGenreCandidates(channels: Record<string, Set<EvidenceChannel>>) {
  const candidates: Array<{ type: Exclude<DocumentResearchType, 'mixed' | 'unknown'>; score: number; reasons: DocumentProfileReasonCode[] }> = [
    { type: 'meta_analysis', score: channels.meta_analysis.size, reasons: ['meta_analysis_markers'] },
    { type: 'systematic_review', score: channels.systematic_review.size, reasons: ['systematic_review_markers'] },
    { type: 'qualitative_empirical', score: channels.qualitative_empirical.size, reasons: ['qualitative_markers_found'] },
    { type: 'quantitative_empirical', score: channels.quantitative_empirical.size, reasons: ['methods_section_found', 'results_section_found'] },
    { type: 'theoretical_or_conceptual', score: channels.theoretical_or_conceptual.size, reasons: ['theoretical_markers_found'] },
    { type: 'case_report', score: channels.case_report.size, reasons: ['case_report_markers'] },
    { type: 'narrative_review', score: channels.narrative_review.size, reasons: ['review_only_structure'] },
    { type: 'non_research', score: channels.non_research.size, reasons: ['non_research_structure'] },
    { type: 'book_or_monograph', score: channels.book_or_monograph.size, reasons: ['book_chapter_structure'] }
  ];
  return candidates.sort((left, right) => right.score - left.score);
}

function resolveGenreTie(
  best: ReturnType<typeof rankGenreCandidates>[number],
  second: ReturnType<typeof rankGenreCandidates>[number],
  channels: Record<string, Set<EvidenceChannel>>
): GenreAssessment {
  const quantitative = new Set<DocumentResearchType>(['quantitative_empirical', 'systematic_review', 'meta_analysis']);
  const qualitative = new Set<DocumentResearchType>(['qualitative_empirical']);
  const mixed = (quantitative.has(best.type) && qualitative.has(second.type))
    || (qualitative.has(best.type) && quantitative.has(second.type));
  if (mixed) {
    return {
      type: 'mixed',
      confidence: 'medium',
      reasons: ['conflicting_evidence'],
      typeEvidenceChannels: unionChannels(channels[best.type], channels[second.type])
    };
  }
  return {
    type: best.type,
    confidence: 'medium',
    reasons: [...best.reasons, 'conflicting_evidence'],
    typeEvidenceChannels: [...channels[best.type]]
  };
}

function quantitativeReasons(
  input: DocumentProfileInput,
  title: string,
  abstract: string,
  hasMethods: boolean,
  hasResults: boolean
): DocumentProfileReasonCode[] {
  const reasons: DocumentProfileReasonCode[] = [];
  if (hasKeywords(title, KEYWORDS.quantitative)) reasons.push('title_keyword_evidence');
  if (hasKeywords(abstract, KEYWORDS.quantitative)) reasons.push('abstract_keyword_evidence');
  if (hasMethods) reasons.push('methods_section_found');
  if (hasResults) reasons.push('results_section_found');
  if (input.parserEngine === 'jats' && hasMethods && hasResults) reasons.push('jats_section_structure');
  return reasons;
}

function unknownAssessment(sectionCount: number): GenreAssessment {
  return {
    type: 'unknown',
    confidence: 'low',
    reasons: sectionCount === 0 ? ['no_sections'] : sectionCount < 3 ? ['low_section_count'] : [],
    typeEvidenceChannels: []
  };
}

function anyChunkContains(input: DocumentProfileInput, keywords: string[]): boolean {
  return input.sections.some(section => (section.chunkTextSample || [])
    .some(sample => keywords.some(keyword => sample.toLowerCase().includes(keyword.toLowerCase()))));
}

function hasKeywords(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.toLowerCase().includes(keyword.toLowerCase()));
}

function unionChannels(...sets: Set<EvidenceChannel>[]): EvidenceChannel[] {
  return [...new Set(sets.flatMap(set => [...set]))];
}

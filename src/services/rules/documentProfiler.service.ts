/**
 * documentProfiler.service.ts
 *
 * Pure, deterministic document research profiler and extraction strategy router.
 *
 * STRICT CONSTRAINTS:
 * - No Mongoose imports or document objects.
 * - No database connections, LLM calls, network requests, or file I/O.
 * - All inputs and outputs are plain JSON-serializable objects.
 * - Source language is preserved as-is; nothing is translated.
 * - The profiler does NOT estimate rule count or credibility percentages.
 * - Profile results are NOT persisted (caller responsibility).
 */

import type {
  DocumentProfileInput,
  DocumentResearchProfile,
  DocumentResearchType,
  DocumentProfileReasonCode,
  SectionProfileInput,
  SectionResearchProfile,
  SectionRole,
  SectionRoleReasonCode,
  ExtractionStrategy,
  ExtractionStrategyDecision,
  DocumentExtractionPlan,
  SectionUsage,
} from './documentResearchProfile.types';

// ─── Heading Normalization and Cleaning Helpers ───────────────────────────────

function cleanHeading(h: string): string {
  return h.replace(/^(?:chapter|section|part)?\s*\d+(?:\.\d+)*\.?\s*/i, '').trim();
}

function normalizeLetterSpaced(h: string): string {
  const normalized = h.toLowerCase().replace(/\s+/g, ' ').trim();
  const stripped = normalized.replace(/\s+/g, '');
  const targets = ['abstract', 'introduction', 'results', 'discussion', 'references'];
  if (targets.includes(stripped)) {
    const spacesCount = (normalized.match(/ /g) || []).length;
    if (spacesCount === stripped.length - 1) {
      return stripped;
    }
  }
  return h;
}

function normalizeHeading(h: string): string {
  const letterSpacedNormalized = normalizeLetterSpaced(h);
  return letterSpacedNormalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

function contains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

/** Pure helper that inspects chunkTextSample across all sections. */
function anyChunkContains(sections: SectionProfileInput[], keywords: string[]): boolean {
  return sections.some(s => {
    const samples = s.chunkTextSample || [];
    return samples.some(sample => keywords.some(k => contains(sample, k)));
  });
}

// ─── Section role resolution ──────────────────────────────────────────────────

const SECTION_TYPE_MAP: Record<string, SectionRole> = {
  abstract:              'abstract',
  introduction:          'introduction',
  methods:               'methods',
  method:                'methods',
  methodology:           'methods',
  results:               'results',
  findings:              'results',
  qualitative_findings:  'qualitative_findings',
  'qualitative findings':'qualitative_findings',
  'thematic findings':   'qualitative_findings',
  discussion:            'discussion',
  conclusion:            'conclusion',
  conclusions:           'conclusion',
  limitations:           'limitations',
  supplementary:         'supplementary',
  supplement:            'supplementary',
  appendix:              'supplementary',
};

const HEADING_ROLE_KEYWORDS: Array<{ keywords: string[]; role: SectionRole }> = [
  { keywords: ['abstract', 'tóm tắt', 'résumé'], role: 'abstract' },
  { keywords: ['introduction', 'background', 'giới thiệu', 'đặt vấn đề'], role: 'introduction' },
  {
    keywords: ['method', 'methodology', 'study design', 'participants', 'data collection',
               'phương pháp', 'thiết kế nghiên cứu'],
    role: 'methods'
  },
  {
    keywords: ['theme', 'thematic', 'narrative', 'lived experience', 'participant experience',
               'qualitative finding', 'qualitative findings', 'thematic findings', 'chủ đề', 'trải nghiệm'],
    role: 'qualitative_findings'
  },
  {
    keywords: ['result', 'finding', 'outcome', 'kết quả', 'phát hiện'],
    role: 'results'
  },
  { keywords: ['discussion', 'interpretation', 'thảo luận'], role: 'discussion' },
  { keywords: ['conclusion', 'kết luận', 'summary'], role: 'conclusion' },
  { keywords: ['limitation', 'hạn chế'], role: 'limitations' },
  {
    keywords: ['supplement', 'appendix', 'additional material', 'supporting information',
               'phụ lục', 'bổ sung'],
    role: 'supplementary'
  },
];

const METADATA_PREFIXES = [
  'author note',
  'credit authorship',
  'declaration of competing',
  'conflict of interest',
  'data availability',
  'author contributions',
  'funding',
  'acknowledgement',
  'acknowledgments',
  'ethics statement'
];

export function resolveSectionRole(
  section: SectionProfileInput,
  sectionIndex: number,
  totalSections: number
): { role: SectionRole; confidence: 'high' | 'medium' | 'low'; reasons: SectionRoleReasonCode[] } {
  const reasons: SectionRoleReasonCode[] = [];

  // Metadata Prefix check (highest priority, do not allow body/references classification)
  const cleaned = cleanHeading(section.heading);
  const cleanedLower = cleaned.toLowerCase().replace(/\s+/g, ' ').trim();

  if (METADATA_PREFIXES.some(p => cleanedLower.startsWith(p))) {
    return {
      role: 'metadata',
      confidence: 'high',
      reasons: ['heading_exact_match']
    };
  }

  // Strict References allowlist match
  const referencesAllowlist = ['references', 'bibliography', 'literature cited', 'works cited', 'tài liệu tham khảo'];
  if (referencesAllowlist.includes(cleanedLower)) {
    return {
      role: 'references',
      confidence: 'high',
      reasons: ['heading_exact_match']
    };
  }

  // 1. sectionType field exact lookup
  const rawType = (section.sectionType || '').toLowerCase().trim();
  if (rawType && SECTION_TYPE_MAP[rawType]) {
    return {
      role: SECTION_TYPE_MAP[rawType],
      confidence: 'high',
      reasons: ['section_type_field']
    };
  }

  // 2. Heading exact match against the type map
  const normalizedHeading = normalizeHeading(section.heading);
  if (SECTION_TYPE_MAP[normalizedHeading]) {
    return {
      role: SECTION_TYPE_MAP[normalizedHeading],
      confidence: 'high',
      reasons: ['heading_exact_match']
    };
  }

  // 3. Heading keyword matching (iterate in priority order)
  for (const { keywords, role } of HEADING_ROLE_KEYWORDS) {
    if (keywords.some(k => contains(normalizedHeading, k))) {
      reasons.push('heading_keyword_match');
      const confidence: 'high' | 'medium' | 'low' =
        role === 'qualitative_findings' ? 'medium' : 'high';
      return { role, confidence, reasons };
    }
  }

  // Position heuristics can only contribute a low-confidence reason, never determine introduction/references by itself.
  if (sectionIndex === 0) {
    reasons.push('position_first');
  }
  if (sectionIndex === totalSections - 1) {
    reasons.push('position_last');
  }

  // A non-empty, non-furniture section with unrecognized academic heading resolves to 'body' with medium confidence.
  if (section.chunkCount > 0) {
    return {
      role: 'body',
      confidence: 'medium',
      reasons: [...reasons, 'non_furniture_body_fallback']
    };
  }

  reasons.push('fallback_unknown');
  return { role: 'unknown', confidence: 'low', reasons };
}

// ─── Document type inference ──────────────────────────────────────────────────

// Genre keywords
const QUANT_KEYWORDS = ['prevalence', 'cohort', 'randomized', 'rct', 'controlled trial', 'controlled study', 'statistical', 'regression', 'correlation', 'odds ratio', 'confidence interval'];
const QUAL_KEYWORDS = ['thematic analysis', 'grounded theory', 'phenomenolog', 'content analysis', 'saturation', 'lived experience', 'interpretive', 'participant experience', 'in-depth interview', 'focus group', 'phỏng vấn', 'phân tích nội dung', 'chủ đề'];
const META_KEYWORDS = ['meta-analysis', 'pooled effect', 'forest plot', 'heterogeneity', 'i²', 'i2', 'weighted mean', 'funnel plot', 'publication bias', 'meta analysis', 'phân tích tổng hợp'];
const SYS_REV_KEYWORDS = ['systematic review', 'prisma', 'cochrane', 'inclusion criteria', 'exclusion criteria', 'search strategy', 'eligible studies', 'study selection', 'tổng quan hệ thống'];
const THEO_KEYWORDS = ['theory', 'theoretical', 'conceptual', 'framework', 'model', 'self-organization', 'self organization', 'self-organizing', 'self organizing', 'predictions of the model'];
const CASE_KEYWORDS = ['case report', 'case presentation', 'case discussion', 'case series', 'a case of', 'ca lâm sàng', 'báo cáo ca'];
const NARRATIVE_KEYWORDS = ['narrative review', 'literature review', 'review article', 'tổng quan tài liệu'];
const NON_RES_KEYWORDS = ['editorial', 'commentary', 'opinion', 'letter to the editor', 'correspondence', 'news', 'bình luận', 'thư gửi biên tập'];

function hasKeywords(text: string, keywords: string[]): boolean {
  return keywords.some(k => contains(text, k));
}

function evaluateGenreEvidence(
  input: DocumentProfileInput,
  sectionProfiles: SectionResearchProfile[]
): {
  type: DocumentResearchType;
  confidence: 'high' | 'medium' | 'low';
  reasons: DocumentProfileReasonCode[];
  typeEvidenceChannels: ('title' | 'abstract' | 'section_structure' | 'chunk_sample')[];
} {
  const sectionRoles = sectionProfiles.map(s => s.resolvedRole);
  const title = ((input.source?.title) || '').toLowerCase();
  const abstract = ((input.source?.abstract) || '').toLowerCase();
  const allHeadings = input.sections.map(s => normalizeHeading(s.heading)).join(' ');

  const hasMethods = sectionRoles.includes('methods');
  const hasResults = sectionRoles.includes('results');
  const hasQualFindings = sectionRoles.includes('qualitative_findings');

  // Track channels per genre
  const getChannels = (type: DocumentResearchType, keywords: string[], matchStructure: () => boolean, matchChunks: () => boolean): Set<'title' | 'abstract' | 'section_structure' | 'chunk_sample'> => {
    const channels = new Set<'title' | 'abstract' | 'section_structure' | 'chunk_sample'>();
    if (hasKeywords(title, keywords)) channels.add('title');
    if (hasKeywords(abstract, keywords)) channels.add('abstract');
    if (matchStructure()) channels.add('section_structure');
    if (matchChunks()) channels.add('chunk_sample');
    return channels;
  };

  // 1. Meta-analysis
  const metaChannels = getChannels(
    'meta_analysis',
    META_KEYWORDS,
    () => contains(allHeadings, 'forest plot') || contains(allHeadings, 'heterogeneity') || contains(allHeadings, 'pooled effect') || contains(allHeadings, 'meta-analysis'),
    () => anyChunkContains(input.sections, ['forest plot', 'heterogeneity', 'pooled effect', 'meta-analysis', 'meta analysis', 'phân tích tổng hợp'])
  );

  // 2. Systematic review
  const sysRevChannels = getChannels(
    'systematic_review',
    SYS_REV_KEYWORDS,
    () => contains(allHeadings, 'systematic review') || contains(allHeadings, 'prisma') || contains(allHeadings, 'inclusion criteria') || contains(allHeadings, 'search strategy'),
    () => false
  );

  // 3. Qualitative empirical
  const qualChannels = getChannels(
    'qualitative_empirical',
    QUAL_KEYWORDS,
    () => hasQualFindings,
    () => anyChunkContains(input.sections, ['lived experience', 'themes', 'focus group', 'interviews'])
  );

  // 4. Quantitative empirical
  const quantChannels = getChannels(
    'quantitative_empirical',
    QUANT_KEYWORDS,
    () => hasMethods && hasResults,
    () => anyChunkContains(input.sections, ['p <', 'p=', 'regression', 'odds ratio', 'confidence interval'])
  );

  // 5. Theoretical or conceptual
  const theoChannels = getChannels(
    'theoretical_or_conceptual',
    THEO_KEYWORDS,
    () => input.sections.some(s => hasKeywords(cleanHeading(s.heading), THEO_KEYWORDS)),
    () => false
  );

  // 6. Case report
  const caseChannels = getChannels(
    'case_report',
    CASE_KEYWORDS,
    () => contains(allHeadings, 'case presentation') || contains(allHeadings, 'case report') || contains(allHeadings, 'case discussion'),
    () => false
  );

  // 7. Narrative review
  const narrativeChannels = getChannels(
    'narrative_review',
    NARRATIVE_KEYWORDS,
    () => !hasMethods && !hasResults && sectionRoles.includes('discussion'),
    () => false
  );

  // 8. Non research
  const nonResChannels = getChannels(
    'non_research',
    NON_RES_KEYWORDS,
    () => contains(allHeadings, 'editorial') || contains(allHeadings, 'commentary'),
    () => false
  );

  // Check independently strong evidence for mixed method:
  // Both quantitative and qualitative must have >= 2 active channels
  const strongQuant = quantChannels.size >= 2;
  const strongQual = qualChannels.size >= 2;

  // Mixed method logic
  if (strongQuant && strongQual) {
    const combinedChannels = Array.from(new Set<"title" | "abstract" | "section_structure" | "chunk_sample">([...quantChannels, ...qualChannels]));
    return {
      type: 'mixed',
      confidence: 'high',
      reasons: ['mixed_method_evidence'],
      typeEvidenceChannels: combinedChannels
    };
  }

  // Compile active channels count as the score
  const candidates: Array<{ type: DocumentResearchType; score: number; reasons: DocumentProfileReasonCode[] }> = [
    { type: 'meta_analysis', score: metaChannels.size, reasons: ['meta_analysis_markers'] },
    { type: 'systematic_review', score: sysRevChannels.size, reasons: ['systematic_review_markers'] },
    { type: 'qualitative_empirical', score: qualChannels.size, reasons: ['qualitative_markers_found'] },
    { type: 'quantitative_empirical', score: quantChannels.size, reasons: ['methods_section_found', 'results_section_found'] },
    { type: 'theoretical_or_conceptual', score: theoChannels.size, reasons: ['theoretical_markers_found'] },
    { type: 'case_report', score: caseChannels.size, reasons: ['case_report_markers'] },
    { type: 'narrative_review', score: narrativeChannels.size, reasons: ['review_only_structure'] },
    { type: 'non_research', score: nonResChannels.size, reasons: ['non_research_structure'] }
  ];

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const second = candidates[1];

  const getChannelsForType = (type: DocumentResearchType): ('title' | 'abstract' | 'section_structure' | 'chunk_sample')[] => {
    switch (type) {
      case 'meta_analysis': return Array.from(metaChannels);
      case 'systematic_review': return Array.from(sysRevChannels);
      case 'qualitative_empirical': return Array.from(qualChannels);
      case 'quantitative_empirical': return Array.from(quantChannels);
      case 'theoretical_or_conceptual': return Array.from(theoChannels);
      case 'case_report': return Array.from(caseChannels);
      case 'narrative_review': return Array.from(narrativeChannels);
      case 'non_research': return Array.from(nonResChannels);
      default: return [];
    }
  };

  if (best.score === 0) {
    let fallbackReasons: DocumentProfileReasonCode[] = [];
    if (input.sections.length === 0) {
      fallbackReasons = ['no_sections'];
    } else if (input.sections.length < 3) {
      fallbackReasons = ['low_section_count'];
    }
    return {
      type: 'unknown',
      confidence: 'low',
      reasons: fallbackReasons,
      typeEvidenceChannels: []
    };
  }

  // Tie-breaker
  if (second && best.score === second.score && best.type !== second.type) {
    const quantSet = new Set<DocumentResearchType>(['quantitative_empirical', 'systematic_review', 'meta_analysis']);
    const qualSet = new Set<DocumentResearchType>(['qualitative_empirical']);
    if ((quantSet.has(best.type) && qualSet.has(second.type)) || (qualSet.has(best.type) && quantSet.has(second.type))) {
      const combinedChannels = Array.from(new Set<"title" | "abstract" | "section_structure" | "chunk_sample">([
        ...getChannelsForType(best.type),
        ...getChannelsForType(second.type)
      ]));
      return {
        type: 'mixed',
        confidence: 'medium',
        reasons: ['conflicting_evidence'],
        typeEvidenceChannels: combinedChannels
      };
    }
    return {
      type: best.type,
      confidence: 'medium',
      reasons: [...best.reasons, 'conflicting_evidence'],
      typeEvidenceChannels: getChannelsForType(best.type)
    };
  }

  // Confidence based strictly on number of independent evidence channels (must be >= 2 for high confidence)
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (best.score >= 2) {
    confidence = 'high';
  } else if (best.score === 1) {
    confidence = 'medium';
  }

  // Compile final pure support reasons based strictly on best type
  const reasons: DocumentProfileReasonCode[] = [];
  if (best.type === 'quantitative_empirical') {
    if (hasKeywords(title, QUANT_KEYWORDS)) reasons.push('title_keyword_evidence');
    if (hasKeywords(abstract, QUANT_KEYWORDS)) reasons.push('abstract_keyword_evidence');
    if (hasMethods) reasons.push('methods_section_found');
    if (hasResults) reasons.push('results_section_found');
    if (input.parserEngine === 'jats' && hasMethods && hasResults) {
      reasons.push('jats_section_structure');
    }
  } else {
    reasons.push(...best.reasons);
  }

  return {
    type: best.type,
    confidence,
    reasons,
    typeEvidenceChannels: getChannelsForType(best.type)
  };
}

// ─── Public profiler ──────────────────────────────────────────────────────────

/**
 * profileDocument — pure, deterministic profiler.
 *
 * Given a DocumentProfileInput, returns a DocumentResearchProfile.
 * This function has no side effects, no timestamps, and is 100% deterministic.
 */
export function profileDocument(input: DocumentProfileInput): DocumentResearchProfile {
  const sourceLanguage = input.source?.detectedLanguage ?? 'unknown';

  // 1. First pass: Resolve each section's role
  const sectionProfiles: SectionResearchProfile[] = input.sections.map((section, idx) => {
    const { role, confidence, reasons } = resolveSectionRole(section, idx, input.sections.length);
    return {
      sectionId: section.sectionId,
      heading: section.heading,
      sectionOrder: section.sectionOrder,
      resolvedRole: role,
      roleConfidence: confidence,
      roleReasonCodes: reasons,
    };
  });

  // 1.5. Mappings for Statements container
  for (let idx = 0; idx < sectionProfiles.length; idx++) {
    const sp = sectionProfiles[idx];
    const cleaned = cleanHeading(sp.heading).toLowerCase().replace(/\s+/g, ' ').trim();
    if (cleaned === 'statements') {
      const afterConclusion = sectionProfiles.slice(0, idx).some(prev => prev.resolvedRole === 'conclusion');
      let followedByMetadata = false;
      if (idx + 1 < sectionProfiles.length) {
        const nextSp = sectionProfiles[idx + 1];
        const nextCleaned = cleanHeading(nextSp.heading).toLowerCase().replace(/\s+/g, ' ').trim();
        followedByMetadata = nextSp.resolvedRole === 'metadata' || METADATA_PREFIXES.some(p => nextCleaned.startsWith(p));
      }
      if (afterConclusion || followedByMetadata) {
        sp.resolvedRole = 'metadata';
        sp.roleConfidence = 'high';
        sp.roleReasonCodes = ['metadata_container_pattern'];
      }
    }
  }

  // 2. Second pass: Sequential structural-role inheritance
  let activeInheritedRole: SectionRole | null = null;
  for (const sp of sectionProfiles) {
    const boundaryRoles: SectionRole[] = [
      'introduction', 'methods', 'results', 'discussion', 'conclusion',
      'limitations', 'references', 'metadata', 'supplementary', 'qualitative_findings'
    ];

    if (boundaryRoles.includes(sp.resolvedRole)) {
      const activeRoles: SectionRole[] = ['methods', 'results', 'discussion', 'qualitative_findings'];
      if (activeRoles.includes(sp.resolvedRole)) {
        activeInheritedRole = sp.resolvedRole;
      } else {
        activeInheritedRole = null;
      }
    } else if (sp.resolvedRole === 'body') {
      if (activeInheritedRole) {
        sp.resolvedRole = activeInheritedRole;
        sp.roleReasonCodes = [...sp.roleReasonCodes, 'inherited_structural_role'];
      }
    }
  }

  // 3. Collect multi-signal evidence and infer document type
  const { type, confidence, reasons, typeEvidenceChannels } = evaluateGenreEvidence(input, sectionProfiles);

  return {
    documentId: input.documentId,
    documentType: type,
    typeConfidence: confidence,
    typeReasonCodes: reasons,
    sourceLanguage,
    sectionProfiles,
    typeEvidenceChannels,
  };
}

// ─── Public strategy router ───────────────────────────────────────────────────

function determineUsageAndStrategy(
  documentType: DocumentResearchType,
  sectionRole: SectionRole,
  roleConfidence: 'high' | 'medium' | 'low',
  roleReasonCodes: SectionRoleReasonCode[]
): { usage: SectionUsage; strategy: ExtractionStrategy; reason: string } {
  // 1. Always skip roles
  const alwaysSkip: SectionRole[] = ['references', 'metadata', 'supplementary'];
  if (alwaysSkip.includes(sectionRole)) {
    return {
      usage: 'skip',
      strategy: 'skip',
      reason: `Section role '${sectionRole}' always routes to skip.`
    };
  }

  // 2. Context-providing roles for empirical/reviews
  const contextSkip: SectionRole[] = ['abstract'];
  if (contextSkip.includes(sectionRole)) {
    return {
      usage: 'context',
      strategy: 'skip',
      reason: `Section role '${sectionRole}' is context-only.`
    };
  }

  // 3. Skip unknown/non_research documents
  if (documentType === 'non_research' || documentType === 'unknown') {
    return {
      usage: 'skip',
      strategy: 'skip',
      reason: `Document type '${documentType}' cannot produce candidates.`
    };
  }

  // 4. Unknown section role -> skip
  if (sectionRole === 'unknown') {
    return {
      usage: 'skip',
      strategy: 'skip',
      reason: `Section role 'unknown' is skipped.`
    };
  }

  // 5. Per document type routing
  switch (documentType) {
    case 'quantitative_empirical': {
      if (['abstract', 'introduction', 'methods', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Empirical study section role '${sectionRole}' is context.`
        };
      }
      if (['results', 'discussion', 'conclusion'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'quantitative_results',
          reason: 'Quantitative results/discussion section in empirical study.'
        };
      }
      if (sectionRole === 'qualitative_findings') {
        return {
          usage: 'target',
          strategy: 'qualitative_themes',
          reason: 'Qualitative findings in quantitative study.'
        };
      }
      if (sectionRole === 'body') {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: 'Orphan body section in empirical study provides context only.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped in quantitative.`
      };
    }

    case 'qualitative_empirical': {
      if (['abstract', 'introduction', 'methods', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Empirical study section role '${sectionRole}' is context.`
        };
      }
      if (['results', 'discussion', 'conclusion', 'qualitative_findings'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'qualitative_themes',
          reason: 'Qualitative findings/results/discussion section in qualitative study.'
        };
      }
      if (sectionRole === 'body') {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: 'Orphan body section in empirical study provides context only.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    case 'systematic_review':
    case 'meta_analysis': {
      if (['abstract', 'introduction', 'methods'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Review study section role '${sectionRole}' is context.`
        };
      }
      if (['results', 'discussion', 'conclusion', 'qualitative_findings', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'review_synthesis',
          reason: `${documentType}: synthesis sections targeted for review_synthesis strategy.`
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    case 'narrative_review': {
      if (['abstract', 'methods', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Narrative review section role '${sectionRole}' is context.`
        };
      }
      if (['introduction', 'body', 'results', 'discussion', 'conclusion', 'qualitative_findings'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'review_synthesis',
          reason: 'Narrative review target section.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    case 'theoretical_or_conceptual': {
      if (['abstract', 'methods', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Theoretical/conceptual section role '${sectionRole}' is context.`
        };
      }
      if (['introduction', 'body', 'results', 'discussion', 'conclusion', 'qualitative_findings'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'theoretical_framework',
          reason: 'Theoretical/conceptual framework target section.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    case 'case_report': {
      if (['abstract', 'introduction', 'methods'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Case report section role '${sectionRole}' is context.`
        };
      }
      if (['results', 'discussion', 'conclusion', 'qualitative_findings', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'case_scoped',
          reason: 'Case report target section.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    case 'mixed': {
      if (['abstract', 'introduction', 'methods', 'limitations'].includes(sectionRole)) {
        return {
          usage: 'context',
          strategy: 'skip',
          reason: `Mixed methods section role '${sectionRole}' is context.`
        };
      }
      if (sectionRole === 'results') {
        return {
          usage: 'target',
          strategy: 'quantitative_results',
          reason: 'Mixed methods: quantitative results target section.'
        };
      }
      if (sectionRole === 'qualitative_findings') {
        return {
          usage: 'target',
          strategy: 'qualitative_themes',
          reason: 'Mixed methods: qualitative findings target section.'
        };
      }
      if (['discussion', 'conclusion', 'body'].includes(sectionRole)) {
        return {
          usage: 'target',
          strategy: 'mixed_section_routing',
          reason: 'Mixed methods: discussion/conclusion/body target section.'
        };
      }
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Section role '${sectionRole}' is skipped.`
      };
    }

    default:
      return {
        usage: 'skip',
        strategy: 'skip',
        reason: `Unhandled document type '${documentType}'.`
      };
  }
}

/**
 * routeExtractionStrategy — pure, deterministic extraction strategy router.
 *
 * Given a DocumentResearchProfile, produces a DocumentExtractionPlan mapping
 * each section to an extraction strategy. This function performs no I/O.
 */
export function routeExtractionStrategy(profile: DocumentResearchProfile): DocumentExtractionPlan {
  const sectionDecisions: ExtractionStrategyDecision[] = profile.sectionProfiles.map(sp => {
    const { usage, strategy, reason } = determineUsageAndStrategy(
      profile.documentType,
      sp.resolvedRole,
      sp.roleConfidence,
      sp.roleReasonCodes
    );
    return {
      sectionId: sp.sectionId,
      sectionRole: sp.resolvedRole,
      usage,
      strategy,
      strategyReason: reason,
      roleConfidence: sp.roleConfidence,
      roleReasonCodes: sp.roleReasonCodes,
    };
  });

  const hasTargets = sectionDecisions.some(d => d.usage === 'target');
  const allExcluded = sectionDecisions.every(d => d.usage === 'skip');

  return {
    documentId: profile.documentId,
    documentType: profile.documentType,
    sourceLanguage: profile.sourceLanguage,
    sectionDecisions,
    hasTargets,
    allExcluded,
  };
}

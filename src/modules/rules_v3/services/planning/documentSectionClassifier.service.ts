import type {
  SectionProfileInput,
  SectionResearchProfile,
  SectionRole,
  SectionRoleReasonCode
} from './documentResearchProfile.types';

const SECTION_TYPE_MAP: Record<string, SectionRole> = {
  abstract: 'abstract',
  introduction: 'introduction',
  methods: 'methods',
  method: 'methods',
  methodology: 'methods',
  results: 'results',
  findings: 'results',
  qualitative_findings: 'qualitative_findings',
  'qualitative findings': 'qualitative_findings',
  'thematic findings': 'qualitative_findings',
  discussion: 'discussion',
  conclusion: 'conclusion',
  conclusions: 'conclusion',
  limitations: 'limitations',
  supplementary: 'supplementary',
  supplement: 'supplementary',
  appendix: 'supplementary'
};

const HEADING_ROLE_KEYWORDS: Array<{ keywords: string[]; role: SectionRole }> = [
  { keywords: ['abstract', 'tóm tắt', 'résumé'], role: 'abstract' },
  { keywords: ['introduction', 'background', 'giới thiệu', 'đặt vấn đề'], role: 'introduction' },
  {
    keywords: ['method', 'methodology', 'study design', 'participants', 'data collection', 'phương pháp', 'thiết kế nghiên cứu'],
    role: 'methods'
  },
  {
    keywords: ['theme', 'thematic', 'narrative', 'lived experience', 'participant experience', 'qualitative finding', 'qualitative findings', 'thematic findings', 'chủ đề', 'trải nghiệm'],
    role: 'qualitative_findings'
  },
  { keywords: ['result', 'finding', 'outcome', 'kết quả', 'phát hiện'], role: 'results' },
  { keywords: ['discussion', 'interpretation', 'thảo luận'], role: 'discussion' },
  { keywords: ['conclusion', 'kết luận', 'summary'], role: 'conclusion' },
  { keywords: ['limitation', 'hạn chế'], role: 'limitations' },
  {
    keywords: ['supplement', 'appendix', 'additional material', 'supporting information', 'phụ lục', 'bổ sung'],
    role: 'supplementary'
  }
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

export function classifyDocumentSections(sections: SectionProfileInput[]): SectionResearchProfile[] {
  const profiles = sections.map((section, index) => {
    const resolved = resolveSectionRole(section, index, sections.length);
    return {
      sectionId: section.sectionId,
      heading: section.heading,
      sectionOrder: section.sectionOrder,
      resolvedRole: resolved.role,
      roleConfidence: resolved.confidence,
      roleReasonCodes: resolved.reasons
    };
  });

  markStatementsMetadataContainers(profiles);
  inheritStructuralRoles(profiles);
  return profiles;
}

export function resolveSectionRole(
  section: SectionProfileInput,
  sectionIndex: number,
  totalSections: number
): { role: SectionRole; confidence: 'high' | 'medium' | 'low'; reasons: SectionRoleReasonCode[] } {
  const cleanedHeading = cleanHeading(section.heading);
  const normalizedCleanedHeading = normalizeHeading(cleanedHeading);

  if (METADATA_PREFIXES.some(prefix => normalizedCleanedHeading.startsWith(prefix))) {
    return exactRole('metadata');
  }
  if (['references', 'bibliography', 'literature cited', 'works cited', 'tài liệu tham khảo']
    .includes(normalizedCleanedHeading)) {
    return exactRole('references');
  }

  const sectionType = String(section.sectionType || '').toLowerCase().trim();
  if (sectionType && SECTION_TYPE_MAP[sectionType]) {
    return { role: SECTION_TYPE_MAP[sectionType], confidence: 'high', reasons: ['section_type_field'] };
  }

  const normalizedHeading = normalizeHeading(section.heading);
  if (SECTION_TYPE_MAP[normalizedHeading]) {
    return exactRole(SECTION_TYPE_MAP[normalizedHeading]);
  }

  for (const mapping of HEADING_ROLE_KEYWORDS) {
    if (mapping.keywords.some(keyword => normalizedHeading.includes(keyword.toLowerCase()))) {
      return {
        role: mapping.role,
        confidence: mapping.role === 'qualitative_findings' ? 'medium' : 'high',
        reasons: ['heading_keyword_match']
      };
    }
  }

  const positionReasons: SectionRoleReasonCode[] = [];
  if (sectionIndex === 0) positionReasons.push('position_first');
  if (sectionIndex === totalSections - 1) positionReasons.push('position_last');
  if (section.chunkCount > 0) {
    return {
      role: 'body',
      confidence: 'medium',
      reasons: [...positionReasons, 'non_furniture_body_fallback']
    };
  }
  return { role: 'unknown', confidence: 'low', reasons: [...positionReasons, 'fallback_unknown'] };
}

export function cleanHeading(heading: string): string {
  return heading.replace(/^(?:chapter|section|part)?\s*\d+(?:\.\d+)*\.?\s*/i, '').trim();
}

export function normalizeHeading(heading: string): string {
  const normalized = heading.toLowerCase().replace(/\s+/g, ' ').trim();
  const stripped = normalized.replace(/\s+/g, '');
  const letterSpacedTargets = ['abstract', 'introduction', 'results', 'discussion', 'references'];
  const spacesCount = (normalized.match(/ /g) || []).length;
  const value = letterSpacedTargets.includes(stripped) && spacesCount === stripped.length - 1
    ? stripped
    : heading;
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isMajorChapterHeading(heading: string): boolean {
  return /^\s*(?:chapter|chương)?\s*\d+\s*[.):-]\s+\S/i.test(heading.trim());
}

export function isBookBackMatterHeading(heading: string): boolean {
  const normalized = normalizeHeading(heading).replace(/^\d+(?:\.\d+)*\.?\s*/, '');
  return /^(?:chu giai|chú giải|glossary|index|bibliography|references|tai lieu tham khao|tài liệu tham khảo|about the author|ve tac gia|về tác giả)(?:\b|$)/i.test(normalized);
}

export function isBookFrontMatterHeading(heading: string): boolean {
  const normalized = normalizeHeading(heading);
  return /^(?:muc luc|mục lục|contents|table of contents|loi noi dau|lời nói đầu|loi tua|lời tựa|preface|foreword|copyright)(?:\b|$)/i.test(normalized);
}

function markStatementsMetadataContainers(profiles: SectionResearchProfile[]): void {
  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    if (normalizeHeading(cleanHeading(profile.heading)) !== 'statements') continue;
    const afterConclusion = profiles.slice(0, index).some(item => item.resolvedRole === 'conclusion');
    const next = profiles[index + 1];
    const followedByMetadata = Boolean(next && (
      next.resolvedRole === 'metadata'
      || METADATA_PREFIXES.some(prefix => normalizeHeading(cleanHeading(next.heading)).startsWith(prefix))
    ));
    if (!afterConclusion && !followedByMetadata) continue;
    profile.resolvedRole = 'metadata';
    profile.roleConfidence = 'high';
    profile.roleReasonCodes = ['metadata_container_pattern'];
  }
}

function inheritStructuralRoles(profiles: SectionResearchProfile[]): void {
  let activeRole: SectionRole | null = null;
  const boundaries: SectionRole[] = [
    'introduction', 'methods', 'results', 'discussion', 'conclusion',
    'limitations', 'references', 'metadata', 'supplementary', 'qualitative_findings'
  ];
  const inheritable: SectionRole[] = ['methods', 'results', 'discussion', 'qualitative_findings'];

  for (const profile of profiles) {
    if (boundaries.includes(profile.resolvedRole)) {
      activeRole = inheritable.includes(profile.resolvedRole) ? profile.resolvedRole : null;
      continue;
    }
    if (profile.resolvedRole === 'body' && activeRole) {
      profile.resolvedRole = activeRole;
      profile.roleReasonCodes = [...profile.roleReasonCodes, 'inherited_structural_role'];
    }
  }
}

function exactRole(role: SectionRole) {
  return { role, confidence: 'high' as const, reasons: ['heading_exact_match' as const] };
}

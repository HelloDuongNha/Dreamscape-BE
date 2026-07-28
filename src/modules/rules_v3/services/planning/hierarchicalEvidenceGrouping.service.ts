import { isMajorChapterHeading } from './documentSectionClassifier.service';
import type {
  DocumentExtractionPlan,
  DocumentResearchProfile,
  ExtractionStrategy,
} from './documentResearchProfile.types';

export interface EvidenceCandidateGroup {
  label: string;
  strategy: ExtractionStrategy;
  sectionIds: string[];
}

export interface EvidenceCandidateGrouping {
  organizationMode: 'article_sections' | 'book_chapters';
  candidateGroups: EvidenceCandidateGroup[];
}

interface ChapterSection {
  sectionId: string;
  strategy: ExtractionStrategy;
}

interface ChapterGroup {
  chapterHeading: string;
  sections: ChapterSection[];
}

interface StrategyGroup extends EvidenceCandidateGroup {
  chapterHeading: string;
}

// Groups target sections by chapter when the document has a real chapter structure.
export function buildEvidenceCandidateGroups(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
): EvidenceCandidateGrouping {
  if (profile.documentType === 'book_or_monograph') {
    const chapterGroups = buildBookGroups(profile, extractionPlan);
    if (chapterGroups.length > 0) {
      return {
        organizationMode: 'book_chapters',
        candidateGroups: chapterGroups,
      };
    }
  }

  return {
    organizationMode: 'article_sections',
    candidateGroups: buildSectionGroups(profile, extractionPlan),
  };
}

function buildBookGroups(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
): EvidenceCandidateGroup[] {
  if (!profile.sectionProfiles.some(section => isMajorChapterHeading(section.heading))) {
    return [];
  }

  const decisionsBySection = new Map(
    extractionPlan.sectionDecisions.map(decision => [decision.sectionId, decision]),
  );
  const chapters = collectChapters(profile, decisionsBySection);
  const strategyGroups = chapters.flatMap(chapter =>
    splitChapterByStrategy(chapter, decisionsBySection),
  );
  const groupCountByChapter = countGroupsByChapter(strategyGroups);

  return strategyGroups.map(group => ({
    label: (groupCountByChapter.get(group.chapterHeading) || 0) > 1
      ? `${group.chapterHeading} (${group.strategy})`
      : group.chapterHeading,
    strategy: group.strategy,
    sectionIds: group.sectionIds,
  }));
}

function collectChapters(
  profile: DocumentResearchProfile,
  decisionsBySection: Map<string, DocumentExtractionPlan['sectionDecisions'][number]>,
): ChapterGroup[] {
  const chapters: ChapterGroup[] = [];
  let currentChapter: ChapterGroup | null = null;

  for (const section of profile.sectionProfiles) {
    const decision = decisionsBySection.get(section.sectionId);
    if (!decision) continue;

    if (isMajorChapterHeading(section.heading)) {
      if (currentChapter) chapters.push(currentChapter);
      currentChapter = { chapterHeading: section.heading, sections: [] };
    }

    if (currentChapter) {
      currentChapter.sections.push({
        sectionId: section.sectionId,
        strategy: decision.strategy,
      });
    }
  }

  if (currentChapter) chapters.push(currentChapter);
  return chapters;
}

function splitChapterByStrategy(
  chapter: ChapterGroup,
  decisionsBySection: Map<string, DocumentExtractionPlan['sectionDecisions'][number]>,
): StrategyGroup[] {
  const targets = chapter.sections.filter(section => {
    const decision = decisionsBySection.get(section.sectionId);
    return decision?.usage === 'target' && decision.strategy !== 'skip';
  });
  if (targets.length === 0) return [];

  const groups: StrategyGroup[] = [];
  for (const section of targets) {
    const current = groups[groups.length - 1];
    if (current?.strategy === section.strategy) {
      current.sectionIds.push(section.sectionId);
      continue;
    }
    groups.push({
      chapterHeading: chapter.chapterHeading,
      label: chapter.chapterHeading,
      strategy: section.strategy,
      sectionIds: [section.sectionId],
    });
  }
  return groups;
}

function countGroupsByChapter(groups: StrategyGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    counts.set(group.chapterHeading, (counts.get(group.chapterHeading) || 0) + 1);
  }
  return counts;
}

function buildSectionGroups(
  profile: DocumentResearchProfile,
  extractionPlan: DocumentExtractionPlan,
): EvidenceCandidateGroup[] {
  const sectionsById = new Map(
    profile.sectionProfiles.map(section => [section.sectionId, section]),
  );

  return extractionPlan.sectionDecisions
    .filter(decision => decision.usage === 'target' && decision.strategy !== 'skip')
    .map(decision => ({
      label: sectionsById.get(decision.sectionId)?.heading || decision.sectionRole,
      strategy: decision.strategy,
      sectionIds: [decision.sectionId],
    }));
}

import {
  isBookBackMatterHeading,
  isBookFrontMatterHeading,
  isMajorChapterHeading
} from './documentSectionClassifier.service';
import type {
  DocumentExtractionPlan,
  DocumentResearchProfile,
  ExtractionStrategyDecision
} from './documentResearchProfile.types';
import { determineSectionRoute } from './documentSectionRouting.service';

export function routeExtractionStrategy(profile: DocumentResearchProfile): DocumentExtractionPlan {
  let reachedBookBody = false;
  let reachedBookBackMatter = false;
  const sectionDecisions: ExtractionStrategyDecision[] = profile.sectionProfiles.map(section => {
    if (profile.documentType === 'book_or_monograph') {
      const bookDecision = routeBookFurniture(section, reachedBookBody, reachedBookBackMatter);
      if (isBookBackMatterHeading(section.heading)) reachedBookBackMatter = true;
      if (isMajorChapterHeading(section.heading)) reachedBookBody = true;
      if (bookDecision) return bookDecision;
    }

    const route = determineSectionRoute(profile.documentType, section.resolvedRole);
    return {
      sectionId: section.sectionId,
      sectionRole: section.resolvedRole,
      usage: route.usage,
      strategy: route.strategy,
      strategyReason: route.reason,
      roleConfidence: section.roleConfidence,
      roleReasonCodes: section.roleReasonCodes
    };
  });

  return {
    documentId: profile.documentId,
    documentType: profile.documentType,
    sourceLanguage: profile.sourceLanguage,
    sectionDecisions,
    hasTargets: sectionDecisions.some(decision => decision.usage === 'target'),
    allExcluded: sectionDecisions.every(decision => decision.usage === 'skip')
  };
}

function routeBookFurniture(
  section: DocumentResearchProfile['sectionProfiles'][number],
  reachedBookBody: boolean,
  reachedBookBackMatter: boolean
): ExtractionStrategyDecision | null {
  const entersBackMatter = reachedBookBackMatter || isBookBackMatterHeading(section.heading);
  if (entersBackMatter || isBookFrontMatterHeading(section.heading)) {
    return {
      sectionId: section.sectionId,
      sectionRole: section.resolvedRole,
      usage: 'skip',
      strategy: 'skip',
      strategyReason: entersBackMatter
        ? 'Book back matter is excluded from rule evidence.'
        : 'Book front matter/table of contents is excluded from rule evidence.',
      roleConfidence: section.roleConfidence,
      roleReasonCodes: section.roleReasonCodes
    };
  }

  const entersBookBody = reachedBookBody || isMajorChapterHeading(section.heading);
  if (entersBookBody) return null;
  return {
    sectionId: section.sectionId,
    sectionRole: section.resolvedRole,
    usage: 'context',
    strategy: 'skip',
    strategyReason: 'Material before the first numbered chapter is context only.',
    roleConfidence: section.roleConfidence,
    roleReasonCodes: section.roleReasonCodes
  };
}

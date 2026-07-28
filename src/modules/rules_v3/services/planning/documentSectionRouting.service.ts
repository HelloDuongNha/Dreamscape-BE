import type {
  DocumentResearchType,
  ExtractionStrategy,
  SectionRole,
  SectionUsage
} from './documentResearchProfile.types';

interface SectionRoute {
  usage: SectionUsage;
  strategy: ExtractionStrategy;
  reason: string;
}

export function determineSectionRoute(
  documentType: DocumentResearchType,
  sectionRole: SectionRole
): SectionRoute {
  if (['references', 'metadata', 'supplementary'].includes(sectionRole)) {
    return skip(`Section role '${sectionRole}' always routes to skip.`);
  }
  if (sectionRole === 'abstract') {
    return context(`Section role '${sectionRole}' is context-only.`);
  }
  if (documentType === 'non_research' || documentType === 'unknown') {
    return skip(`Document type '${documentType}' cannot produce candidates.`);
  }
  if (sectionRole === 'unknown') {
    return skip("Section role 'unknown' is skipped.");
  }

  switch (documentType) {
    case 'quantitative_empirical':
      return routeQuantitative(sectionRole);
    case 'qualitative_empirical':
      return routeQualitative(sectionRole);
    case 'systematic_review':
    case 'meta_analysis':
      return routeSystematicReview(documentType, sectionRole);
    case 'narrative_review':
      return routeNarrativeReview(sectionRole);
    case 'theoretical_or_conceptual':
      return routeTheoretical(sectionRole);
    case 'book_or_monograph':
      return routeBook(sectionRole);
    case 'case_report':
      return routeCaseReport(sectionRole);
    case 'mixed':
      return routeMixed(sectionRole);
    default:
      return skip(`Unhandled document type '${documentType}'.`);
  }
}

function routeQuantitative(role: SectionRole): SectionRoute {
  if (['introduction', 'methods', 'limitations'].includes(role)) {
    return context(`Empirical study section role '${role}' is context.`);
  }
  if (['results', 'discussion', 'conclusion'].includes(role)) {
    return target('quantitative_results', 'Quantitative results/discussion section in empirical study.');
  }
  if (role === 'qualitative_findings') {
    return target('qualitative_themes', 'Qualitative findings in quantitative study.');
  }
  if (role === 'body') {
    return context('Orphan body section in empirical study provides context only.');
  }
  return skip(`Section role '${role}' is skipped in quantitative.`);
}

function routeQualitative(role: SectionRole): SectionRoute {
  if (['introduction', 'methods', 'limitations'].includes(role)) {
    return context(`Empirical study section role '${role}' is context.`);
  }
  if (['results', 'discussion', 'conclusion', 'qualitative_findings'].includes(role)) {
    return target('qualitative_themes', 'Qualitative findings/results/discussion section in qualitative study.');
  }
  if (role === 'body') {
    return context('Orphan body section in empirical study provides context only.');
  }
  return skip(`Section role '${role}' is skipped.`);
}

function routeSystematicReview(type: DocumentResearchType, role: SectionRole): SectionRoute {
  if (['introduction', 'methods'].includes(role)) {
    return context(`Review study section role '${role}' is context.`);
  }
  if (['results', 'discussion', 'conclusion', 'qualitative_findings', 'limitations'].includes(role)) {
    return target('review_synthesis', `${type}: synthesis sections targeted for review_synthesis strategy.`);
  }
  return skip(`Section role '${role}' is skipped.`);
}

function routeNarrativeReview(role: SectionRole): SectionRoute {
  if (['methods', 'limitations'].includes(role)) {
    return context(`Narrative review section role '${role}' is context.`);
  }
  if (['introduction', 'body', 'results', 'discussion', 'conclusion', 'qualitative_findings'].includes(role)) {
    return target('review_synthesis', 'Narrative review target section.');
  }
  return skip(`Section role '${role}' is skipped.`);
}

function routeTheoretical(role: SectionRole): SectionRoute {
  if (['methods', 'limitations'].includes(role)) {
    return context(`Theoretical/conceptual section role '${role}' is context.`);
  }
  if (['introduction', 'body', 'results', 'discussion', 'conclusion', 'qualitative_findings'].includes(role)) {
    return target('theoretical_framework', 'Theoretical/conceptual framework target section.');
  }
  return skip(`Section role '${role}' is skipped.`);
}

function routeBook(role: SectionRole): SectionRoute {
  if (['introduction', 'limitations'].includes(role)) {
    return context(`Book section role '${role}' provides context.`);
  }
  if (['body', 'results', 'discussion', 'conclusion', 'qualitative_findings'].includes(role)) {
    return target('book_argument', 'Evidence-bearing book/monograph chapter.');
  }
  return skip(`Section role '${role}' is skipped in a book/monograph.`);
}

function routeCaseReport(role: SectionRole): SectionRoute {
  if (['introduction', 'methods'].includes(role)) {
    return context(`Case report section role '${role}' is context.`);
  }
  if (['results', 'discussion', 'conclusion', 'qualitative_findings', 'limitations'].includes(role)) {
    return target('case_scoped', 'Case report target section.');
  }
  return skip(`Section role '${role}' is skipped.`);
}

function routeMixed(role: SectionRole): SectionRoute {
  if (['introduction', 'methods', 'limitations'].includes(role)) {
    return context(`Mixed methods section role '${role}' is context.`);
  }
  if (role === 'results') {
    return target('quantitative_results', 'Mixed methods: quantitative results target section.');
  }
  if (role === 'qualitative_findings') {
    return target('qualitative_themes', 'Mixed methods: qualitative findings target section.');
  }
  if (['discussion', 'conclusion', 'body'].includes(role)) {
    return target('mixed_section_routing', 'Mixed methods: discussion/conclusion/body target section.');
  }
  return skip(`Section role '${role}' is skipped.`);
}

function target(strategy: ExtractionStrategy, reason: string): SectionRoute {
  return { usage: 'target', strategy, reason };
}

function context(reason: string): SectionRoute {
  return { usage: 'context', strategy: 'skip', reason };
}

function skip(reason: string): SectionRoute {
  return { usage: 'skip', strategy: 'skip', reason };
}

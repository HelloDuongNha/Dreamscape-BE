import { logger } from '../../../../../infrastructure/logger';
import {
  canExplainPsychology,
  canGenerateContextQuestion,
} from '../../../../rules_v3/services/retrieval/ruleV3DreamApplication.service';
import { retrieveApprovedRuleV3 } from '../../../../rules_v3/services/retrieval/ruleV3Retrieval.service';
import { deduplicateAcademicSources } from '../grounding/dreamAnalysisGrounding.service';

interface DreamRuleEvidenceResult {
  matchedRules: any[];
  explanatoryRules: any[];
  questionRules: any[];
  usableRules: any[];
  validEvidenceLinks: any[];
  evidenceLinksAudit: any[];
  validSourcesMap: Map<string, any[]>;
  validEvidenceMap: Map<string, Array<{
    evidenceId: string;
    sourceId: string;
    chunkId: string;
    quote: string;
  }>>;
  promptEvidenceSection: string;
}

export async function retrieveDreamRuleEvidence(
  dreamNarrative: string,
): Promise<DreamRuleEvidenceResult> {
  let matchedRules: any[] = [];
  let validEvidenceLinks: any[] = [];
  try {
    const result = await retrieveApprovedRuleV3(dreamNarrative, 10);
    matchedRules = result.rules;
    validEvidenceLinks = result.evidenceLinks;
  } catch (error) {
    logger.warn('Rule V3 retrieval failed; continuing without academic rule claims.', {
      error: String(error),
    });
  }

  const explanatoryRules = matchedRules.filter(canExplainPsychology);
  const questionRules = matchedRules.filter(canGenerateContextQuestion);
  const usableRules = matchedRules;
  const linksByRule = new Map<string, any[]>();
  for (const link of validEvidenceLinks) {
    const ruleId = String(link.ruleId?._id || link.ruleId);
    linksByRule.set(ruleId, [...(linksByRule.get(ruleId) || []), link]);
  }

  const evidenceLinksAudit: any[] = [];
  const validSourcesMap = new Map<string, any[]>();
  const validEvidenceMap = new Map<string, Array<{
    evidenceId: string;
    sourceId: string;
    chunkId: string;
    quote: string;
  }>>();
  let promptEvidenceText = '';
  let totalEvidenceChars = 0;

  for (const rule of usableRules) {
    const databaseRuleId = String(rule._id);
    const publicRuleId = String(rule.ruleId || '');
    const ruleLinks = [
      ...(linksByRule.get(databaseRuleId) || []),
      ...(publicRuleId ? (linksByRule.get(publicRuleId) || []) : []),
    ].filter((link, index, links) =>
      links.findIndex(candidate => evidenceLinkKey(candidate) === evidenceLinkKey(link)) === index,
    ).slice(0, 2);
    if (ruleLinks.length === 0) continue;

    const ruleSources = ruleLinks.map(link => {
      const source = link.chunkId.sourceId;
      const chunk = link.chunkId;
      const snippet = link.quote || chunk.text || '';
      evidenceLinksAudit.push({
        ruleId: rule._id,
        evidenceRole: 'primary_support',
        sourceId: source._id,
        sourceTitle: source.title,
        sourceYear: source.year,
        doi: source.doi,
        chunkIds: [chunk._id],
        chunkPreview: snippet.substring(0, 400) + (snippet.length > 400 ? '...' : ''),
      });
      return {
        sourceId: source._id.toString(),
        title: source.title,
        authors: Array.isArray(source.authors) ? source.authors : [source.authors],
        year: source.year,
        journal: source.journal || source.publisher,
        doi: source.doi,
        chunkIds: [chunk._id.toString()],
      };
    });
    const sources = deduplicateAcademicSources(ruleSources);
    const ruleId = String(rule.ruleId || rule._id);
    const evidenceItems = ruleLinks.map(link => ({
      evidenceId: String(link._id),
      sourceId: String(link.chunkId.sourceId._id),
      chunkId: String(link.chunkId._id),
      quote: String(link.quote || '').trim(),
    })).filter(item => item.quote);
    validEvidenceMap.set(ruleId, evidenceItems);
    validSourcesMap.set(databaseRuleId, sources);
    if (publicRuleId) validSourcesMap.set(publicRuleId, sources);

    const ruleText = ruleLinks
      .map(link => String(link.quote || link.chunkId.text || ''))
      .filter(Boolean)
      .join('\n');
    const remainingChars = 5000 - totalEvidenceChars;
    if (!ruleText.trim() || remainingChars <= 0) continue;

    const truncatedRuleText = ruleText.substring(0, remainingChars);
    totalEvidenceChars += truncatedRuleText.length;
    const authors = sources.map(source => {
      const names = source.authors || [];
      if (names.length === 0) return 'N/A';
      if (names.length <= 2) return names.join(', ');
      return `${names[0]} et al.`;
    }).join('; ');
    promptEvidenceText += `
RuleId: ${ruleId}
RuleCode: ${rule.ruleCode}
RuleStatement: ${rule.ruleStatement}
Source: ${authors} (${sources.map(source => source.year || 'N/A').join('; ')}), "${sources.map(source => source.title).join('; ')}", DOI: ${sources.map(source => source.doi || 'N/A').join('; ')}
Evidence Summary: ${ruleLinks.map(link => link.evidenceSummary).join('; ')}
Evidence Quote:
${truncatedRuleText.split('\n').map(line => `- "${line}"`).join('\n')}
`;
  }

  return {
    matchedRules,
    explanatoryRules,
    questionRules,
    usableRules,
    validEvidenceLinks,
    evidenceLinksAudit,
    validSourcesMap,
    validEvidenceMap,
    promptEvidenceSection: promptEvidenceText.trim()
      ? `\n[Component D Academic Evidence]\nFor each matching rule below: Use the rule definition and the provided academic evidence together. Do not introduce claims beyond the rule and evidence.\n${promptEvidenceText.trim()}\n`
      : '',
  };
}

function evidenceLinkKey(link: any): string {
  return [
    String(link?.ruleId?._id || link?.ruleId || ''),
    String(link?.chunkId?._id || link?.chunkId || ''),
    String(link?.chunkId?.sourceId?._id || link?.chunkId?.sourceId || ''),
  ].join(':');
}

export type DatabaseDomain = 'core' | 'knowledge' | 'operations';

export const DATABASE_DOMAIN_COLLECTIONS: Record<DatabaseDomain, readonly string[]> = {
  core: [
    'comments',
    'conversations',
    'dreams',
    'dreamsymbolobservations',
    'messages',
    'notifications',
    'oracleevidencegaps',
    'oraclemodelcredentials',
    'oraclethreads',
    'oracleturns',
    'otps',
    'user_achievements',
    'user_contribution_stats',
    'user_dream_profiles',
    'users',
  ],
  knowledge: [
    'academic_chunks',
    'academic_documents',
    'academic_sections',
    'academic_sources',
    'knowledge_rule_evidences_v3',
    'knowledge_rules_v3',
    'rule_validation_feedback',
    'source_contributions',
  ],
  operations: [
    'academic_rule_extraction_runs',
    'academic_rule_extraction_runs_v3',
    'oraclerunevents',
    'oracleruns',
    'reader_replacement_backups',
    'reader_replacement_runs',
    'rule_v3_replacement_backup_items',
    'rule_v3_replacement_journals',
  ],
};

/**
 * These collections belong to superseded schemas. They stay in the immutable
 * legacy database and in every safety backup. Migration refuses to continue if
 * one becomes non-empty so no historical data is silently abandoned.
 */
export const LEGACY_COLLECTIONS = [
  'academic_fulltext_sections',
  'academic_fulltexts',
  'knowledge_rule_candidates',
  'knowledge_rule_evidences',
  'knowledge_rule_sources',
  'knowledge_rules',
  'pending_knowledge_rules',
  'sourcecontributions',
  'verified_knowledge_rules',
] as const;

export const RETIRED_COLLECTIONS = [
  'dreamsymbols',
  'oraclerulefeedbacks',
] as const;

export function domainForCollection(collectionName: string): DatabaseDomain | null {
  for (const [domain, collections] of Object.entries(DATABASE_DOMAIN_COLLECTIONS)) {
    if (collections.includes(collectionName)) return domain as DatabaseDomain;
  }
  return null;
}

export function classifiedCollections(): Set<string> {
  return new Set([
    ...Object.values(DATABASE_DOMAIN_COLLECTIONS).flat(),
    ...LEGACY_COLLECTIONS,
    ...RETIRED_COLLECTIONS,
  ]);
}

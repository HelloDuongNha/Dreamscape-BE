import { retrieveSimilarDreams } from '../../../dream/services/analysis/retrieval/similarDreamRetrieval.service';
import { retrieveApprovedRuleV3 } from '../../../rules_v3/services/retrieval/ruleV3Retrieval.service';
import { logger } from '../../../../infrastructure/logger';

export type OracleAcademicRecords = Awaited<ReturnType<typeof retrieveApprovedRuleV3>>;
export type OraclePersonalDreamRecords = Awaited<ReturnType<typeof retrieveSimilarDreams>>;

export async function retrieveOracleGroundingRecords(
  userId: string,
  dreamText: string,
): Promise<{
  academic: OracleAcademicRecords;
  personal: OraclePersonalDreamRecords;
}> {
  const [academic, personal] = await Promise.all([
    retrieveApprovedRuleV3(dreamText, 10).catch((error) => {
      logger.warn('Oracle academic retrieval failed; continuing without academic citations.', {
        userId,
        error: String(error),
      });
      return { rules: [], evidenceLinks: [] };
    }),
    retrieveSimilarDreams(userId, dreamText, 5).catch((error) => {
      logger.warn('Oracle similar-dream retrieval failed; continuing without personal-history citations.', {
        userId,
        error: String(error),
      });
      return { queryEmbedding: [], matches: [] };
    }),
  ]);
  return { academic, personal };
}

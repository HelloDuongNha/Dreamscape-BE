import type { OracleCitation } from '../oracle.types';
import { buildAcademicCitations } from './oracleAcademicGrounding.service';
import { buildOracleGroundingPrompt } from './oracleGroundingPrompt.service';
import { retrieveOracleGroundingRecords } from './oracleGroundingRetrieval.service';
import { buildPersonalDreamCitations } from './oraclePersonalGrounding.service';
import { selectGroundedVerificationQuestions } from './oracleVerificationSelection.service';

export interface OracleGrounding {
  citations: OracleCitation[];
  promptContext: string;
  personalContext?: {
    citationIndex: number;
    title: string;
    similarity: number;
    exact: boolean;
    duplicateCount: number;
  };
  verificationQuestions: Array<{
    ruleIds: string[];
    verificationKey: string;
    question: string;
    localizedQuestion?: { vi: string; en: string };
    citationIndex: number;
  }>;
}

export async function buildOracleGrounding(
  userId: string,
  dreamText: string,
): Promise<OracleGrounding> {
  const records = await retrieveOracleGroundingRecords(userId, dreamText);
  const academic = await buildAcademicCitations(userId, records.academic);
  const personal = buildPersonalDreamCitations(
    records.personal,
    academic.citations.length + 1,
  );
  const citations = [...academic.citations, ...personal.citations];
  return {
    citations,
    promptContext: buildOracleGroundingPrompt(citations),
    personalContext: personal.personalContext,
    verificationQuestions: selectGroundedVerificationQuestions(
      academic.verificationQuestions,
      citations,
    ),
  };
}

import type { Types } from 'mongoose';
import AcademicSource from '../../../academic/models/AcademicSource';
import OracleTurn from '../../models/OracleTurn';
import { OracleContractError } from '../oracle.types';
import { buildOracleCitationLinks } from './oracleCitationLinkBuild.service';
import { refreshOracleCitationLinks } from './oracleCitationLinkRefresh.service';
import { presentOracleCitation } from './oracleCitationPresentation.service';

export async function getOracleCitationDetailsRecord(input: {
  userId: Types.ObjectId;
  turnId: Types.ObjectId;
  citationIndex: number;
  expectedSourceId: string;
}) {
  const turn = await OracleTurn.findOne({
    _id: input.turnId,
    userId: input.userId,
    role: 'assistant',
    status: 'completed',
  });
  if (!turn) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');
  const citation = (
    input.expectedSourceId
      ? turn.citations.find((item) => item.sourceId === input.expectedSourceId)
      : null
  ) || turn.citations.find((item) => item.index === input.citationIndex);
  if (!citation) throw new OracleContractError('oracle_not_found', 'Oracle citation was not found.');
  if (citation.sourceType !== 'academic_source') {
    return presentOracleCitation(citation, turn.contentBlocks);
  }
  const source = await AcademicSource.findOne({
    $or: [{ _id: citation.sourceId }, { sourceContributionId: citation.sourceId }],
  }).select('_id sourceContributionId title year').lean();
  if (!source) {
    throw new OracleContractError(
      'oracle_not_found',
      'The academic citation no longer points to an approved source.',
    );
  }
  const canonicalSourceId = String(source._id);
  citation.sourceId = canonicalSourceId;
  citation.title = source.title || citation.title;
  if (source.year) citation.year = source.year;
  const sourceContributionId = source.sourceContributionId
    ? String(source.sourceContributionId)
    : undefined;
  if (citation.ruleLinks?.length) {
    await refreshOracleCitationLinks({
      userId: input.userId,
      citation,
      canonicalSourceId,
      sourceContributionId,
    });
  } else {
    citation.ruleLinks = await buildOracleCitationLinks({
      userId: input.userId,
      citation,
      canonicalSourceId,
      sourceContributionId,
    });
  }
  turn.markModified('citations');
  await turn.save();
  return presentOracleCitation(citation, turn.contentBlocks);
}

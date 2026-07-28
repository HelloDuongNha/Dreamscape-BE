import {
  parseClientRequestId,
  parseOracleContent,
  parseOracleObjectId,
} from './oracleRequest.dto';

export function parseSubmitOracleTurnBody(body: Record<string, unknown> | undefined) {
  return {
    clientRequestId: parseClientRequestId(body?.clientRequestId),
    content: parseOracleContent(body?.content),
    requestedParentId: body?.parentTurnId
      ? parseOracleObjectId(body.parentTurnId)
      : null,
  };
}

export function parseBranchOracleTurnBody(body: Record<string, unknown> | undefined) {
  return {
    clientRequestId: parseClientRequestId(body?.clientRequestId),
    content: parseOracleContent(body?.content),
  };
}

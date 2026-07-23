import { Types } from 'mongoose';

export type OracleMode = 'chat' | 'dream_analysis' | 'creative_continuation';
export type OracleTurnRole = 'user' | 'assistant';
export type OracleTurnStatus = 'queued' | 'streaming' | 'completed' | 'failed' | 'cancelled';
export type OracleRunStatus = 'initializing' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface OracleTextBlock {
  type: 'text';
  text: string;
}

export interface OracleCitation {
  index: number;
  sourceType: 'academic_source' | 'own_dream' | 'public_dream';
  sourceId: string;
  title: string;
  excerpt: string;
  detail?: string;
}

export type OracleContentBlock = OracleTextBlock;

export interface OracleAccessScope {
  requesterUserId: string;
  ownDreamAccess: 'all';
  otherDreamAccess: 'public_only';
  ruleAccess: 'verified_only';
  academicAccess: 'authorized_only';
}

export interface CreateOracleTurnInput {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  clientRequestId: string;
  content: string;
  parentTurnId?: Types.ObjectId;
  branchRootTurnId?: Types.ObjectId;
  supersedesTurnId?: Types.ObjectId;
}

export interface OracleTurnRunResult {
  userTurnId: Types.ObjectId;
  assistantTurnId: Types.ObjectId;
  runId: Types.ObjectId;
  status: OracleRunStatus;
  replayed: boolean;
}

export class OracleContractError extends Error {
  constructor(
    public readonly code:
      | 'oracle_invalid_request'
      | 'oracle_not_found'
      | 'oracle_idempotency_conflict'
      | 'oracle_persistence_failed',
    message: string,
  ) {
    super(message);
    this.name = 'OracleContractError';
  }
}

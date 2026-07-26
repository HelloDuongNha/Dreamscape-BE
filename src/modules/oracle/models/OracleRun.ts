import mongoose, { Document, Schema, Types } from 'mongoose';
import type { OracleRunStatus } from '../services/oracle/oracle.types';

export interface IOracleRun extends Document {
  threadId: Types.ObjectId;
  userId: Types.ObjectId;
  clientRequestId: string;
  requestHash: string;
  userTurnId: Types.ObjectId;
  assistantTurnId: Types.ObjectId;
  status: OracleRunStatus;
  lastEventSequence: number;
  errorCode?: string;
  mode?: string;
  modelName?: string;
  inputChars?: number;
  contextChars?: number;
  retrievalChars?: number;
  citationCount?: number;
  outputChars?: number;
  promptTokens?: number;
  expectedMinMs?: number;
  expectedMaxMs?: number;
  durationMs?: number;
  stage?: 'thinking' | 'preparing' | 'completed';
  stageStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const OracleRunSchema = new Schema<IOracleRun>(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'OracleThread', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientRequestId: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true, minlength: 64, maxlength: 64 },
    userTurnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn', required: true },
    assistantTurnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn', required: true },
    status: {
      type: String,
      enum: ['initializing', 'queued', 'running', 'completed', 'cancelled', 'failed'],
      default: 'initializing',
      required: true,
    },
    lastEventSequence: { type: Number, default: 0, min: 0 },
    errorCode: { type: String, maxlength: 80 },
    mode: { type: String, enum: ['chat', 'dream_analysis', 'creative_continuation'] },
    modelName: { type: String, maxlength: 160 },
    inputChars: { type: Number, min: 0 },
    contextChars: { type: Number, min: 0 },
    retrievalChars: { type: Number, min: 0 },
    citationCount: { type: Number, min: 0 },
    outputChars: { type: Number, min: 0 },
    promptTokens: { type: Number, min: 0 },
    expectedMinMs: { type: Number, min: 1000 },
    expectedMaxMs: { type: Number, min: 1000 },
    durationMs: { type: Number, min: 0 },
    stage: { type: String, enum: ['thinking', 'preparing', 'completed'] },
    stageStartedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

OracleRunSchema.index({ userId: 1, clientRequestId: 1 }, { unique: true });
OracleRunSchema.index({ userId: 1, threadId: 1, createdAt: -1 });

export default mongoose.model<IOracleRun>('OracleRun', OracleRunSchema);

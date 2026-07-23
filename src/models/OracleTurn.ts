import mongoose, { Document, Schema, Types } from 'mongoose';
import type {
  OracleContentBlock,
  OracleCitation,
  OracleTurnRole,
  OracleTurnStatus,
} from '../services/oracle/oracle.types';

export interface IOracleTurn extends Document {
  threadId: Types.ObjectId;
  userId: Types.ObjectId;
  sequence: number;
  role: OracleTurnRole;
  status: OracleTurnStatus;
  parentTurnId?: Types.ObjectId;
  branchRootTurnId?: Types.ObjectId;
  supersedesTurnId?: Types.ObjectId;
  contentBlocks: OracleContentBlock[];
  citations: OracleCitation[];
  suggestedPrompts: string[];
  contextUsage?: {
    usedTokens: number;
    maxTokens: number;
    percent: number;
    provider?: string;
    modelName?: string;
  };
  runTiming?: {
    startedAt: Date;
    thoughtCompletedAt: Date;
    completedAt: Date;
    expectedMinMs?: number;
    expectedMaxMs?: number;
  };
  clientRequestId?: string;
  runId?: Types.ObjectId;
  finalizedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OracleContentBlockSchema = new Schema(
  {
    type: { type: String, enum: ['text'], required: true },
    text: { type: String, required: true, maxlength: 20000 },
  },
  { _id: false },
);

const OracleCitationSchema = new Schema(
  {
    index: { type: Number, required: true, min: 1 },
    sourceType: {
      type: String,
      enum: ['academic_source', 'own_dream', 'public_dream'],
      required: true,
    },
    sourceId: { type: String, required: true, maxlength: 100 },
    title: { type: String, required: true, maxlength: 500 },
    excerpt: { type: String, required: true, maxlength: 1200 },
    detail: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const OracleTurnSchema = new Schema<IOracleTurn>(
  {
    threadId: { type: Schema.Types.ObjectId, ref: 'OracleThread', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sequence: { type: Number, required: true, min: 1 },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    status: {
      type: String,
      enum: ['queued', 'streaming', 'completed', 'failed', 'cancelled'],
      required: true,
    },
    parentTurnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn' },
    branchRootTurnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn' },
    supersedesTurnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn' },
    contentBlocks: { type: [OracleContentBlockSchema], default: [] },
    citations: { type: [OracleCitationSchema], default: [] },
    suggestedPrompts: {
      type: [{ type: String, maxlength: 240 }],
      default: [],
      validate: [(value: string[]) => value.length <= 6, 'Too many suggested prompts.'],
    },
    contextUsage: {
      usedTokens: { type: Number, min: 0 },
      maxTokens: { type: Number, min: 1 },
      percent: { type: Number, min: 0, max: 100 },
      provider: { type: String, maxlength: 40 },
      modelName: { type: String, maxlength: 120 },
    },
    runTiming: {
      startedAt: Date,
      thoughtCompletedAt: Date,
      completedAt: Date,
      expectedMinMs: { type: Number, min: 1000 },
      expectedMaxMs: { type: Number, min: 1000 },
    },
    clientRequestId: { type: String, maxlength: 128 },
    runId: { type: Schema.Types.ObjectId, ref: 'OracleRun' },
    finalizedAt: Date,
  },
  { timestamps: true },
);

OracleTurnSchema.index({ threadId: 1, sequence: 1 }, { unique: true });
OracleTurnSchema.index({ userId: 1, threadId: 1, createdAt: -1 });

export default mongoose.model<IOracleTurn>('OracleTurn', OracleTurnSchema);

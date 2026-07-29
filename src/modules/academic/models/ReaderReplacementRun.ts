import { Document, Schema, Types } from 'mongoose';
import { modelForDomain } from '../../../infrastructure/database/domainModels';

export type ReaderReplacementTargetType = 'contribution' | 'approved_source';
export type ReaderReplacementStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface IReaderReplacementRun extends Document {
  targetType: ReaderReplacementTargetType;
  targetId: Types.ObjectId;
  kind: 'pdf' | 'structured';
  status: ReaderReplacementStatus;
  cancelRequested: boolean;
  readerWritten: boolean;
  sourceSnapshot: Record<string, unknown>;
  newAssetIds: string[];
  oldAssetIds: string[];
  committedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReaderReplacementRunSchema = new Schema<IReaderReplacementRun>(
  {
    targetType: { type: String, enum: ['contribution', 'approved_source'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, enum: ['pdf', 'structured'], required: true },
    status: { type: String, enum: ['running', 'completed', 'cancelled', 'failed'], required: true, default: 'running', index: true },
    cancelRequested: { type: Boolean, required: true, default: false },
    readerWritten: { type: Boolean, required: true, default: false },
    sourceSnapshot: { type: Schema.Types.Mixed, required: true, default: {} },
    newAssetIds: { type: [String], required: true, default: [] },
    oldAssetIds: { type: [String], required: true, default: [] },
    committedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true, collection: 'reader_replacement_runs' },
);

ReaderReplacementRunSchema.index({ targetType: 1, targetId: 1, status: 1, createdAt: -1 });
ReaderReplacementRunSchema.index(
  { finishedAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 14, partialFilterExpression: { finishedAt: { $type: 'date' } } },
);

export default modelForDomain<IReaderReplacementRun>(
  'operations',
  'ReaderReplacementRun',
  ReaderReplacementRunSchema,
);

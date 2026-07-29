import { Document, Schema, Types } from 'mongoose';
import { modelForDomain } from '../../../infrastructure/database/domainModels';

export interface IReaderReplacementBackup extends Document {
  runId: Types.ObjectId;
  entityType: 'document' | 'section' | 'chunk' | 'rule' | 'rule_evidence';
  entityId: Types.ObjectId;
  payload: Record<string, unknown>;
}

const ReaderReplacementBackupSchema = new Schema<IReaderReplacementBackup>(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'ReaderReplacementRun', required: true, index: true },
    entityType: { type: String, enum: ['document', 'section', 'chunk', 'rule', 'rule_evidence'], required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'reader_replacement_backups' },
);

ReaderReplacementBackupSchema.index({ runId: 1, entityType: 1, entityId: 1 }, { unique: true });
ReaderReplacementBackupSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

export default modelForDomain<IReaderReplacementBackup>(
  'operations',
  'ReaderReplacementBackup',
  ReaderReplacementBackupSchema,
);

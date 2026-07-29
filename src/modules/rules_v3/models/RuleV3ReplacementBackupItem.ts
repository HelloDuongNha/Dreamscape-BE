import { Document, Schema, Types } from 'mongoose';
import { modelForDomain } from '../../../infrastructure/database/domainModels';

export type RuleV3ReplacementBackupEntityType = 'source_rule' | 'touched_rule' | 'evidence';

export interface IRuleV3ReplacementBackupItem extends Document {
  journalId: Types.ObjectId;
  entityType: RuleV3ReplacementBackupEntityType;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  cleanupAfter?: Date;
}

const RuleV3ReplacementBackupItemSchema = new Schema<IRuleV3ReplacementBackupItem>(
  {
    journalId: {
      type: Schema.Types.ObjectId,
      ref: 'RuleV3ReplacementJournal',
      required: true,
      index: true,
    },
    entityType: {
      type: String,
      enum: ['source_rule', 'touched_rule', 'evidence'],
      required: true,
    },
    entityId: { type: String, required: true, trim: true },
    payload: { type: Schema.Types.Mixed, required: true },
    cleanupAfter: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'rule_v3_replacement_backup_items',
  },
);

RuleV3ReplacementBackupItemSchema.index(
  { journalId: 1, entityType: 1, entityId: 1 },
  { unique: true },
);
RuleV3ReplacementBackupItemSchema.index({ cleanupAfter: 1 }, { expireAfterSeconds: 0 });

export default modelForDomain<IRuleV3ReplacementBackupItem>(
  'operations',
  'RuleV3ReplacementBackupItem',
  RuleV3ReplacementBackupItemSchema,
);

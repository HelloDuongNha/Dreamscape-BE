import mongoose, { Document, Schema, Types } from 'mongoose';

export type RuleV3ReplacementJournalState =
  | 'preparing'
  | 'prepared'
  | 'applying'
  | 'rolling_back'
  | 'rolled_back'
  | 'committed';

export interface IRuleV3ReplacementJournal extends Document {
  runId: Types.ObjectId;
  attemptId: string;
  sourceId: Types.ObjectId;
  sourceAliases: Types.ObjectId[];
  sourceLockKey?: string;
  replaceExisting: boolean;
  state: RuleV3ReplacementJournalState;
  newRuleIds: Types.ObjectId[];
  expectedRuleBackupCount: number;
  expectedEvidenceBackupCount: number;
  startedAt: Date;
  finishedAt?: Date;
  cleanupAfter?: Date;
}

const RuleV3ReplacementJournalSchema = new Schema<IRuleV3ReplacementJournal>(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'AcademicRuleExtractionRunV3', required: true, index: true },
    attemptId: { type: String, required: true, trim: true, unique: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceAliases: { type: [Schema.Types.ObjectId], required: true, default: [] },
    sourceLockKey: { type: String, required: false, trim: true },
    replaceExisting: { type: Boolean, required: true, default: false },
    state: {
      type: String,
      enum: ['preparing', 'prepared', 'applying', 'rolling_back', 'rolled_back', 'committed'],
      required: true,
      default: 'preparing',
      index: true,
    },
    newRuleIds: { type: [Schema.Types.ObjectId], required: true, default: [] },
    expectedRuleBackupCount: { type: Number, required: true, min: 0, default: 0 },
    expectedEvidenceBackupCount: { type: Number, required: true, min: 0, default: 0 },
    startedAt: { type: Date, required: true, default: Date.now },
    finishedAt: { type: Date },
    cleanupAfter: { type: Date },
  },
  {
    timestamps: true,
    collection: 'rule_v3_replacement_journals',
  },
);

RuleV3ReplacementJournalSchema.index({ sourceAliases: 1, state: 1 });
RuleV3ReplacementJournalSchema.index({ sourceLockKey: 1 }, { unique: true, sparse: true });
RuleV3ReplacementJournalSchema.index({ cleanupAfter: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRuleV3ReplacementJournal>(
  'RuleV3ReplacementJournal',
  RuleV3ReplacementJournalSchema,
);

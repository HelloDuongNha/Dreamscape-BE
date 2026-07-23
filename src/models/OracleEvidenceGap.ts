import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IOracleEvidenceGap extends Document {
  userId: Types.ObjectId;
  threadId: Types.ObjectId;
  turnId: Types.ObjectId;
  occurrenceTurnIds: Types.ObjectId[];
  claim: string;
  normalizedClaim: string;
  relatedClaims: string[];
  occurrenceCount: number;
  status: 'unresolved' | 'candidate_found' | 'resolved';
  candidateRuleIds: Types.ObjectId[];
  resolvedRuleIds: Types.ObjectId[];
  resolutionCitationIndex?: number;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OracleEvidenceGapSchema = new Schema<IOracleEvidenceGap>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'OracleThread', required: true },
    turnId: { type: Schema.Types.ObjectId, ref: 'OracleTurn', required: true },
    occurrenceTurnIds: [{ type: Schema.Types.ObjectId, ref: 'OracleTurn' }],
    claim: { type: String, required: true, maxlength: 1200 },
    normalizedClaim: { type: String, required: true, maxlength: 1200 },
    relatedClaims: [{ type: String, maxlength: 1200 }],
    occurrenceCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['unresolved', 'candidate_found', 'resolved'],
      default: 'unresolved',
    },
    candidateRuleIds: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRuleV3' }],
    resolvedRuleIds: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRuleV3' }],
    resolutionCitationIndex: { type: Number, min: 1 },
    resolvedAt: Date,
  },
  { timestamps: true },
);

OracleEvidenceGapSchema.index({ userId: 1, normalizedClaim: 1 });
OracleEvidenceGapSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model<IOracleEvidenceGap>('OracleEvidenceGap', OracleEvidenceGapSchema);

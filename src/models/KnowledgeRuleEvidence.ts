import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IKnowledgeRuleEvidence extends Document {
  _id: mongoose.Types.ObjectId;
  ruleId: mongoose.Types.ObjectId;
  chunkId: mongoose.Types.ObjectId;
  quote: string;
  evidenceSummary: string;
  confidence: number;
  extractionRunId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const KnowledgeRuleEvidenceSchema = new Schema<IKnowledgeRuleEvidence>(
  {
    ruleId: {
      type: Schema.Types.ObjectId,
      ref: 'VerifiedKnowledgeRule',
      required: true,
      index: true
    },
    chunkId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicChunk',
      required: true,
      index: true
    },
    quote: {
      type: String,
      required: true
    },
    evidenceSummary: {
      type: String,
      required: true
    },
    confidence: {
      type: Number,
      required: true,
      default: 1.0
    },
    extractionRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicRuleExtractionRun',
      required: true,
      index: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only: no updatedAt
    collection: 'knowledge_rule_evidences'
  }
);

// Bidirectional unique indices to prevent duplicate evidence chunk + quote mappings
KnowledgeRuleEvidenceSchema.index({ chunkId: 1, quote: 1 }, { unique: true });

export default mongoose.model<IKnowledgeRuleEvidence>('KnowledgeRuleEvidence', KnowledgeRuleEvidenceSchema);

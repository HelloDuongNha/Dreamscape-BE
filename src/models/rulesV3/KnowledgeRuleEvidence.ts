import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IKnowledgeRuleEvidenceV3 extends Document {
  ruleId: Types.ObjectId;
  sourceId: Types.ObjectId;
  chunkId: Types.ObjectId;
  extractionRunId: Types.ObjectId;
  chunkContentHash: string;
  startOffset: number;
  endOffset: number;
  exactQuote: string;
  quoteHash: string;
  stance: 'supports' | 'refutes' | 'limits';
  exactness: 'canonical_exact'; // Slicing only produces canonical_exact. Future callers can assign source_exact or extraction_derived.
  verificationScore: number; // 0 to 1
  researchType?: 'quantitative_empirical' | 'qualitative_empirical' | 'systematic_review' | 'meta_analysis' | 'narrative_review' | 'theoretical_or_conceptual' | 'book_or_monograph' | 'case_report' | 'mixed' | 'non_research' | 'unknown';
  researchTypeConfidence?: 'high' | 'medium' | 'low';
  sourceQuality?: 'peer_reviewed' | 'preprint' | 'informal';
  createdAt: Date;
}

const KnowledgeRuleEvidenceV3Schema = new Schema<IKnowledgeRuleEvidenceV3>(
  {
    ruleId: {
      type: Schema.Types.ObjectId,
      ref: 'KnowledgeRuleV3',
      required: true
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true
    },
    chunkId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicChunk',
      required: true,
      index: true
    },
    extractionRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicRuleExtractionRunV3',
      required: true,
      index: true
    },
    chunkContentHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/
    },
    startOffset: {
      type: Number,
      required: true,
      min: 0
    },
    endOffset: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function(this: any, val: number) {
          return val > this.startOffset;
        },
        message: 'endOffset phải lớn hơn startOffset.'
      }
    },
    exactQuote: {
      type: String,
      required: true,
      minlength: 10,
      maxlength: 1000
      // Note: trim: true is intentionally omitted to avoid altering the sliced string bytes.
    },
    quoteHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/
    },
    stance: {
      type: String,
      enum: ['supports', 'refutes', 'limits'],
      required: true
    },
    exactness: {
      type: String,
      enum: ['canonical_exact'],
      required: true,
      default: 'canonical_exact'
    },
    verificationScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 1.0
    },
    researchType: {
      type: String,
      enum: ['quantitative_empirical', 'qualitative_empirical', 'systematic_review', 'meta_analysis', 'narrative_review', 'theoretical_or_conceptual', 'book_or_monograph', 'case_report', 'mixed', 'non_research', 'unknown'],
      required: false
    },
    researchTypeConfidence: {
      type: String,
      enum: ['high', 'medium', 'low'],
      required: false
    },
    sourceQuality: {
      type: String,
      enum: ['peer_reviewed', 'preprint', 'informal'],
      required: false
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only: no updatedAt
    collection: 'knowledge_rule_evidences_v3'
  }
);

// Required indexes:
// 1. ruleId + stance (compound)
KnowledgeRuleEvidenceV3Schema.index({ ruleId: 1, stance: 1 });
// 2. sourceId + ruleId (compound)
KnowledgeRuleEvidenceV3Schema.index({ sourceId: 1, ruleId: 1 });
// 3. Unique compound index preventing duplicate Rule/Span/Stance linkages:
KnowledgeRuleEvidenceV3Schema.index(
  { ruleId: 1, chunkId: 1, chunkContentHash: 1, startOffset: 1, endOffset: 1, stance: 1 },
  { unique: true }
);

export default mongoose.model<IKnowledgeRuleEvidenceV3>('KnowledgeRuleEvidenceV3', KnowledgeRuleEvidenceV3Schema);

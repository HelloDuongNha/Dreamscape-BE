import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IKnowledgeRuleCandidate extends Document {
  academicSourceId: Types.ObjectId;
  academicFullTextId?: Types.ObjectId;
  evidenceChunkIds: Types.ObjectId[];
  proposedRuleId: string;
  candidateKey: string;
  label: string;
  group: 'sleep_context' | 'dream_psychology' | 'personality_knowledge' | 'cultural_limitation';
  category: string;
  factor: string;
  inputSource: string;
  inputRequired: Record<string, any>;
  scientificBasis: string;
  aiInstruction: string;
  limitations: string;
  claimStrength:
    | 'association_not_causation'
    | 'possible_contributing_factor'
    | 'interpretive_framework'
    | 'hypothesis_not_diagnosis'
    | 'epistemic_boundary_rule';
  confidenceCap: number;
  evidenceRole: 'primary_support' | 'secondary_support' | 'background' | 'limitation' | 'contradiction';
  evidenceSummary: string;
  status: 'pending' | 'approved' | 'rejected' | 'needs_edit';
  reviewerNote?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  legitimacyScore?: number;
  legitimacyReason?: string;
  evidenceType?: 'theoretical_framework' | 'empirical_study' | 'literature_review' | 'opinion_or_hypothesis' | 'mixed' | 'unknown';
  conflictStatus?: 'none' | 'possible_conflict' | 'conflicts_with_existing_rule' | 'supports_existing_rule' | 'duplicate_or_overlap' | 'unknown';
  conflictNotes?: string;
  paperDomain?: 'dream_sleep_psychology' | 'computer_vision' | 'medicine' | 'general_science' | 'unknown';
  oracleEligible?: boolean;
  evidenceCredibilityScore?: number;
  oracleUsefulnessScore?: number;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeRuleCandidateSchema = new Schema<IKnowledgeRuleCandidate>(
  {
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true,
    },
    candidateKey: {
      type: String,
      required: true,
      index: true,
    },
    academicFullTextId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicFullText',
    },
    evidenceChunkIds: {
      type: [Schema.Types.ObjectId],
      ref: 'AcademicChunk',
      required: true,
    },
    proposedRuleId: {
      type: String,
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    group: {
      type: String,
      required: true,
      enum: ['sleep_context', 'dream_psychology', 'personality_knowledge', 'cultural_limitation'],
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    factor: {
      type: String,
      required: true,
      trim: true,
    },
    inputSource: {
      type: String,
      required: true,
      trim: true,
    },
    inputRequired: {
      type: Schema.Types.Mixed,
      required: true,
    },
    scientificBasis: {
      type: String,
      required: true,
      trim: true,
    },
    aiInstruction: {
      type: String,
      required: true,
      trim: true,
    },
    limitations: {
      type: String,
      required: true,
      trim: true,
    },
    claimStrength: {
      type: String,
      required: true,
      enum: [
        'association_not_causation',
        'possible_contributing_factor',
        'interpretive_framework',
        'hypothesis_not_diagnosis',
        'epistemic_boundary_rule',
      ],
    },
    confidenceCap: {
      type: Number,
      required: true,
      min: 0,
      max: 0.65,
    },
    evidenceRole: {
      type: String,
      required: true,
      enum: ['primary_support', 'secondary_support', 'background', 'limitation', 'contradiction'],
      default: 'primary_support',
    },
    evidenceSummary: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'approved', 'rejected', 'needs_edit'],
      default: 'pending',
      index: true,
    },
    reviewerNote: {
      type: String,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    legitimacyScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    legitimacyReason: {
      type: String,
      trim: true,
    },
    evidenceType: {
      type: String,
      enum: ['theoretical_framework', 'empirical_study', 'literature_review', 'opinion_or_hypothesis', 'mixed', 'unknown'],
    },
    conflictStatus: {
      type: String,
      enum: ['none', 'possible_conflict', 'conflicts_with_existing_rule', 'supports_existing_rule', 'duplicate_or_overlap', 'unknown'],
    },
    conflictNotes: {
      type: String,
      trim: true,
    },
    paperDomain: {
      type: String,
      enum: ['dream_sleep_psychology', 'computer_vision', 'medicine', 'general_science', 'unknown'],
      default: 'unknown',
    },
    oracleEligible: {
      type: Boolean,
      default: true,
    },
    evidenceCredibilityScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    oracleUsefulnessScore: {
      type: Number,
      min: 0,
      max: 100,
    },
  },
  {
    timestamps: true,
    collection: 'knowledge_rule_candidates',
  }
);

// Indexes
KnowledgeRuleCandidateSchema.index({ createdAt: 1 });
KnowledgeRuleCandidateSchema.index({ academicSourceId: 1, status: 1 });

export default mongoose.model<IKnowledgeRuleCandidate>('KnowledgeRuleCandidate', KnowledgeRuleCandidateSchema);

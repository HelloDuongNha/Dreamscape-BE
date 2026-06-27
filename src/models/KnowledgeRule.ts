import mongoose, { Schema } from 'mongoose';

export interface IKnowledgeRule {
  _id: string;
  group: 'sleep_context' | 'dream_psychology' | 'personality_knowledge' | 'cultural_limitation';
  category: string;
  factor: string;
  label: string;
  inputSource: string;
  inputRequired: {
    field: string;
    value?: any;
    operator?: string;
    contains?: any;
    [key: string]: any;
  };
  scientificBasis: string;
  source: {
    author: string;
    year: number | null;
    title: string;
    type: string;
    url: string | null;
    doi: string | null;
    verificationStatus: string;
    sourceQuality: string;
  };
  evidenceLevel: string;
  claimStrength:
    | 'association_not_causation'
    | 'possible_contributing_factor'
    | 'interpretive_framework'
    | 'hypothesis_not_diagnosis'
    | 'epistemic_boundary_rule';
  aiInstruction: string;
  confidenceCap: number;
  limitations: string;
  evidenceSummary?: string;
  reliabilityLevel: 'scientific_established' | 'scientific_limited' | 'cultural_symbolic';
  isActive: boolean;
  oracleEligible?: boolean;
  origin: 'seed' | 'source_generated' | 'manual';
  ruleVersion: number;
  sourceEvidenceStatus: 'unlinked' | 'partially_linked' | 'fully_grounded';
  deactivatedAt?: Date;
  deactivatedBy?: any;
  deactivationReason?: string;
  scoring?: {
    enabled: boolean;
    scoreImpact: number;
    scoreType: string;
    reason: string;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const KnowledgeRuleSchema = new Schema<IKnowledgeRule>(
  {
    _id: { type: String, required: true },
    group: {
      type: String,
      required: true,
      enum: ['sleep_context', 'dream_psychology', 'personality_knowledge', 'cultural_limitation'],
    },
    category: { type: String, required: true },
    factor: { type: String, required: true },
    label: { type: String, required: true },
    inputSource: { type: String, required: true },
    inputRequired: {
      type: Schema.Types.Mixed,
      required: true,
    },
    scientificBasis: { type: String, required: true },
    source: {
      author: { type: String, required: true },
      year: { type: Number, default: null },
      title: { type: String, required: true },
      type: { type: String, required: true },
      url: { type: String, default: null },
      doi: { type: String, default: null },
      verificationStatus: { type: String, required: true },
      sourceQuality: { type: String, required: true },
    },
    evidenceLevel: { type: String, required: true },
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
    aiInstruction: { type: String, required: true },
    confidenceCap: { type: Number, required: true, min: 0.0, max: 1.0 },
    limitations: { type: String, required: true },
    evidenceSummary: { type: String, trim: true },
    reliabilityLevel: {
      type: String,
      required: true,
      enum: ['scientific_established', 'scientific_limited', 'cultural_symbolic'],
    },
    isActive: { type: Boolean, required: true },
    oracleEligible: { type: Boolean, default: true },
    deactivatedAt: { type: Date },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deactivationReason: { type: String },
    origin: {
      type: String,
      enum: ['seed', 'source_generated', 'manual'],
      default: 'manual',
      required: true,
    },
    ruleVersion: {
      type: Number,
      default: 1,
      required: true,
    },
    sourceEvidenceStatus: {
      type: String,
      enum: ['unlinked', 'partially_linked', 'fully_grounded'],
      default: 'unlinked',
      required: true,
    },
    scoring: {
      enabled: { type: Boolean, default: false },
      scoreImpact: { type: Number, default: 0 },
      scoreType: { type: String, default: 'interpretive_framework' },
      reason: { type: String, default: '' }
    }
  },
  {
    timestamps: true,
    collection: 'knowledge_rules',
  }
);

// Optimize search queries with compound indexes
KnowledgeRuleSchema.index({ group: 1, isActive: 1 });
KnowledgeRuleSchema.index({ category: 1, factor: 1, isActive: 1 });

export default mongoose.model<IKnowledgeRule>('KnowledgeRule', KnowledgeRuleSchema);

import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

export interface IKnowledgeRuleV3 extends Document {
  ruleCode: string;
  status: 'pending' | 'verified' | 'rejected' | 'retired';
  sourceLanguage: string; // lowercase, trim, regex `^[a-z]{2,3}$`
  statement: string;
  claimType:
    | 'association'
    | 'prediction'
    | 'intervention_effect'
    | 'moderation'
    | 'mediation'
    | 'qualitative_theme'
    | 'theoretical_proposition'
    | 'review_synthesis'
    | 'null_finding';
  effectPolarity: 'positive' | 'negative' | 'mixed' | 'neutral' | 'unknown';
  evidenceInterpretation: 'causal' | 'associational' | 'predictive' | 'descriptive' | 'interpretive' | 'not_applicable';
  subject: string;
  outcome: string;
  conditions: string[];
  limitations: string[];
  dreamFeatureTags: string[];
  classifications: string[];
  dedupKey: string; // 64 lowercase hex characters
  evidenceScore: number;
  certaintyTier: 'weak' | 'limited' | 'moderate' | 'strong' | 'mixed';
  supportingSourceCount: number;
  contradictingSourceCount: number;
  embedding?: number[];
  embeddingModel?: string;
  version: number;
  isComposite: boolean;
  compositeComponents: Array<{
    sourceRuleId: Types.ObjectId;
    ruleCode: string;
    statement: string;
    claimType: IKnowledgeRuleV3['claimType'];
    effectPolarity: IKnowledgeRuleV3['effectPolarity'];
    evidenceInterpretation: IKnowledgeRuleV3['evidenceInterpretation'];
    subject: string;
    outcome: string;
    conditions: string[];
    limitations: string[];
    dreamFeatureTags: string[];
  }>;
  mergedFromRuleIds: Types.ObjectId[];
  mergedIntoRuleId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CompositeRuleComponentSchema = new Schema({
  sourceRuleId: { type: Schema.Types.ObjectId, ref: 'KnowledgeRuleV3', required: true },
  ruleCode: { type: String, required: true, trim: true },
  statement: { type: String, required: true, trim: true, maxlength: 1000 },
  claimType: { type: String, required: true },
  effectPolarity: { type: String, required: true },
  evidenceInterpretation: { type: String, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 200 },
  outcome: { type: String, required: true, trim: true, maxlength: 200 },
  conditions: { type: [String], default: [] },
  limitations: { type: [String], default: [] },
  dreamFeatureTags: { type: [String], default: [] },
}, { _id: false });

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function generateRuleCodeV3(): string {
  let result = '';
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    const index = randomBytes[i] % alphabet.length;
    result += alphabet[index];
  }
  return `KR3_${result}`;
}

const arrayItemLengthValidator = {
  validator: (arr: string[]) => arr.every(item => item.length <= 100),
  message: 'Mỗi phần tử trong mảng không được vượt quá 100 ký tự.'
};

const arrayLengthValidator = {
  validator: (arr: string[]) => arr.length <= 20,
  message: 'Mảng không được chứa quá 20 phần tử.'
};

const KnowledgeRuleV3Schema = new Schema<IKnowledgeRuleV3>(
  {
    ruleCode: {
      type: String,
      unique: true,
      required: true,
      index: true,
      immutable: true,
      default: generateRuleCodeV3
    },
    status: {
      type: String,
      enum: ['pending', 'verified', 'rejected', 'retired'],
      required: true,
      default: 'pending',
      index: true
    },
    sourceLanguage: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[a-z]{2,3}$/
    },
    statement: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000
    },
    claimType: {
      type: String,
      enum: [
        'association',
        'prediction',
        'intervention_effect',
        'moderation',
        'mediation',
        'qualitative_theme',
        'theoretical_proposition',
        'review_synthesis',
        'null_finding'
      ],
      required: true
    },
    effectPolarity: {
      type: String,
      enum: ['positive', 'negative', 'mixed', 'neutral', 'unknown'],
      required: true
    },
    evidenceInterpretation: {
      type: String,
      enum: ['causal', 'associational', 'predictive', 'descriptive', 'interpretive', 'not_applicable'],
      required: true,
      validate: {
        validator: function(this: any, val: string) {
          // Invariant 1: association or correlation must never be elevated to causal
          // Note: This is only a minimum schema safeguard. The future extraction verifier
          // must also validate causality against study design and source evidence.
          // Do not introduce an over-restrictive compatibility matrix in this patch.
          if (val === 'causal' && this.claimType === 'association') {
            return false;
          }
          return true;
        },
        message: 'Một tuyên bố liên kết (association) không bao giờ được nâng cấp thành diễn giải nhân quả (causal).'
      }
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    outcome: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200
    },
    conditions: {
      type: [String],
      required: true,
      default: [],
      validate: [arrayItemLengthValidator, arrayLengthValidator]
    },
    limitations: {
      type: [String],
      required: true,
      default: [],
      validate: [arrayItemLengthValidator, arrayLengthValidator]
    },
    dreamFeatureTags: {
      type: [String],
      required: true,
      default: [],
      validate: [arrayItemLengthValidator, arrayLengthValidator]
    },
    classifications: {
      type: [String],
      required: true,
      default: [],
      validate: [arrayItemLengthValidator, arrayLengthValidator]
    },
    dedupKey: {
      type: String,
      required: true,
      trim: true,
      match: /^[a-f0-9]{64}$/,
      minlength: 64,
      maxlength: 64
    },
    evidenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 0
      /*
       * Comment: qualitative and theoretical claims may receive a non-zero evidence score
       * since evidenceScore represents the strength/credibility of the complete evidence
       * supporting a rule rather than a quantitative effect size.
       * They must not invent quantitative effect sizes. Effect-size storage is outside
       * this schema and is not being added in this patch.
       */
    },
    certaintyTier: {
      type: String,
      enum: ['weak', 'limited', 'moderate', 'strong', 'mixed'],
      required: true
    },
    supportingSourceCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    contradictingSourceCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    embedding: {
      type: [Number],
      required: false,
      validate: {
        validator: function(this: any, val: number[]) {
          // Prevent embedding from being persisted for pending or rejected rules
          if ((this.status === 'pending' || this.status === 'rejected') && val && val.length > 0) {
            return false;
          }
          const expectedDimension = Number.parseInt(process.env.RULE_V3_EMBEDDING_DIMENSION || '768', 10);
          return !val || val.length === 0 || (val.length === expectedDimension && val.every(Number.isFinite));
        },
        message: 'Embedding Rule V3 không hợp lệ về trạng thái, số chiều hoặc giá trị số.'
      }
    },
    embeddingModel: {
      type: String,
      required: false,
      trim: true
    },
    version: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: 'Version phải là số nguyên >= 1.'
      },
      default: 1
    },
    isComposite: {
      type: Boolean,
      required: true,
      default: false,
    },
    compositeComponents: {
      type: [CompositeRuleComponentSchema],
      required: true,
      default: [],
      validate: {
        validator: (items: unknown[]) => items.length <= 12,
        message: 'Một quy luật tổng hợp chỉ được chứa tối đa 12 mệnh đề nguyên tử.',
      },
    },
    mergedFromRuleIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRuleV3' }],
      required: true,
      default: [],
    },
    mergedIntoRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'KnowledgeRuleV3',
      required: false,
    }
  },
  {
    timestamps: true,
    collection: 'knowledge_rules_v3'
  }
);

// Pre-validate hook to clean up arrays: trim items and filter out empty strings
KnowledgeRuleV3Schema.pre('validate', function(this: any) {
  const cleanArray = (arr: string[] | undefined) => {
    if (!arr) return [];
    return arr
      .map(item => (item || '').trim())
      .filter(item => item.length > 0);
  };
  this.conditions = cleanArray(this.conditions);
  this.limitations = cleanArray(this.limitations);
  this.dreamFeatureTags = cleanArray(this.dreamFeatureTags);
  this.classifications = cleanArray(this.classifications);

  // Invariant 3: null findings are valid candidates and must not be silently discarded.
  // This hook is intentionally synchronous. Current Mongoose does not pass a `next`
  // callback to synchronous document middleware.
});

// Indexes justified by real query paths:
// 1. classifications + status (compound)
KnowledgeRuleV3Schema.index({ classifications: 1, status: 1 });
// 2. dreamFeatureTags + status (compound)
KnowledgeRuleV3Schema.index({ dreamFeatureTags: 1, status: 1 });
// 3. sourceLanguage + dedupKey (compound unique for concurrency safety)
KnowledgeRuleV3Schema.index({ sourceLanguage: 1, dedupKey: 1 }, { unique: true });

export default mongoose.model<IKnowledgeRuleV3>('KnowledgeRuleV3', KnowledgeRuleV3Schema);

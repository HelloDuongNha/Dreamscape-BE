import mongoose, { Schema, Document } from 'mongoose';
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

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
          return true;
        },
        message: 'Không được lưu embedding cho quy luật ở trạng thái pending hoặc rejected.'
      }
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
    }
  },
  {
    timestamps: true,
    collection: 'knowledge_rules_v3'
  }
);

// Pre-validate hook to clean up arrays: trim items and filter out empty strings
KnowledgeRuleV3Schema.pre('validate', function(this: any, next: any) {
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
  // We document here that null_finding is explicitly processed and allowed by validators.
  
  next();
});

// Indexes justified by real query paths:
// 1. classifications + status (compound)
KnowledgeRuleV3Schema.index({ classifications: 1, status: 1 });
// 2. dreamFeatureTags + status (compound)
KnowledgeRuleV3Schema.index({ dreamFeatureTags: 1, status: 1 });
// 3. sourceLanguage + dedupKey (compound unique for concurrency safety)
KnowledgeRuleV3Schema.index({ sourceLanguage: 1, dedupKey: 1 }, { unique: true });

export default mongoose.model<IKnowledgeRuleV3>('KnowledgeRuleV3', KnowledgeRuleV3Schema);

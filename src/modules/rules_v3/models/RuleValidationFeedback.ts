import { Document, Schema, Types } from 'mongoose';
import { modelForDomain } from '../../../infrastructure/database/domainModels';

export interface IRuleValidationImpact {
  ruleId: string;
  relation: 'direct' | 'shared_quote';
  weight: 2 | 1;
}

export interface IRuleValidationFeedback extends Document {
  userId: Types.ObjectId;
  verificationKey: string;
  origin: 'oracle' | 'dream_analysis';
  originId: Types.ObjectId;
  questionText: string;
  answer: 'yes' | 'no' | 'unsure';
  effect: 'supports' | 'weakens' | 'unresolved';
  directRuleIds: string[];
  evidenceQuoteHashes: string[];
  impacts: IRuleValidationImpact[];
  createdAt: Date;
  updatedAt: Date;
}

const RuleValidationFeedbackSchema = new Schema<IRuleValidationFeedback>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    verificationKey: { type: String, required: true, maxlength: 300 },
    origin: { type: String, enum: ['oracle', 'dream_analysis'], required: true },
    originId: { type: Schema.Types.ObjectId, required: true },
    questionText: { type: String, required: true, maxlength: 1200 },
    answer: { type: String, enum: ['yes', 'no', 'unsure'], required: true },
    effect: { type: String, enum: ['supports', 'weakens', 'unresolved'], required: true },
    directRuleIds: { type: [String], required: true, default: [] },
    evidenceQuoteHashes: { type: [String], required: true, default: [] },
    impacts: {
      type: [{
        ruleId: { type: String, required: true },
        relation: { type: String, enum: ['direct', 'shared_quote'], required: true },
        weight: { type: Number, enum: [1, 2], required: true },
      }],
      required: true,
      default: [],
    },
  },
  { timestamps: true, collection: 'rule_validation_feedback' },
);

// The same prepared question has one current answer per person across Oracle
// and dream analysis. Re-answering replaces its prior score effect.
RuleValidationFeedbackSchema.index(
  { userId: 1, verificationKey: 1 },
  { unique: true },
);
RuleValidationFeedbackSchema.index({ 'impacts.ruleId': 1 });

export default modelForDomain<IRuleValidationFeedback>(
  'knowledge',
  'RuleValidationFeedback',
  RuleValidationFeedbackSchema,
);

import mongoose, { Schema, Document } from 'mongoose';
import { RuleClassification } from './VerifiedKnowledgeRule';

export interface IPendingKnowledgeRule extends Document {
  _id: mongoose.Types.ObjectId;
  ruleStatement: string;
  classifications: RuleClassification[];
  scientificBasis: string;
  evidenceChunkIds: mongoose.Types.ObjectId[];
  status: 'pending' | 'rejected';
  mergeRuleId?: mongoose.Types.ObjectId; // If set, this candidate proposes to merge as evidence into an existing rule
  createdAt: Date;
  updatedAt: Date;
}

const PendingKnowledgeRuleSchema = new Schema<IPendingKnowledgeRule>(
  {
    ruleStatement: {
      type: String,
      required: true
    },
    classifications: {
      type: [String],
      enum: Object.values(RuleClassification),
      required: true,
      default: []
    },
    scientificBasis: {
      type: String,
      required: true
    },
    evidenceChunkIds: {
      type: [Schema.Types.ObjectId],
      ref: 'AcademicChunk',
      required: true,
      default: []
    },
    status: {
      type: String,
      enum: ['pending', 'rejected'],
      required: true,
      default: 'pending'
    },
    mergeRuleId: {
      type: Schema.Types.ObjectId,
      ref: 'VerifiedKnowledgeRule',
      required: false
    }
  },
  {
    timestamps: true,
    collection: 'pending_knowledge_rules'
  }
);

PendingKnowledgeRuleSchema.index({ status: 1 });

export default mongoose.model<IPendingKnowledgeRule>('PendingKnowledgeRule', PendingKnowledgeRuleSchema);

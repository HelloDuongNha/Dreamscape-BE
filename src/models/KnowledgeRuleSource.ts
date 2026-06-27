import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IKnowledgeRuleSource extends Document {
  ruleId: string;
  academicSourceId: Types.ObjectId;
  academicFullTextId?: Types.ObjectId;
  academicChunkIds: Types.ObjectId[];
  evidenceRole: 'primary_support' | 'secondary_support' | 'background' | 'contradiction' | 'limitation';
  relevanceNote?: string;
  selectedQuotePreview?: string;
  status: 'active' | 'inactive';
  linkedBy: Types.ObjectId;
  linkedAt: Date;
  updatedBy?: Types.ObjectId;
  updatedAt?: Date;
  createdAt: Date;
}

const KnowledgeRuleSourceSchema = new Schema<IKnowledgeRuleSource>(
  {
    ruleId: {
      type: String,
      required: true,
      index: true,
    },
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true,
    },
    academicFullTextId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicFullText',
      index: true,
    },
    academicChunkIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'AcademicChunk' }],
      required: true,
    },
    evidenceRole: {
      type: String,
      enum: ['primary_support', 'secondary_support', 'background', 'contradiction', 'limitation'],
      required: true,
    },
    relevanceNote: {
      type: String,
    },
    selectedQuotePreview: {
      type: String,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      index: true,
    },
    linkedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    linkedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'knowledge_rule_sources',
  }
);

export default mongoose.model<IKnowledgeRuleSource>('KnowledgeRuleSource', KnowledgeRuleSourceSchema);

import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IEditHistoryEntry {
  version?: number;
  content: string;
  additions?: IDreamAddition[];
  ai_status?: 'pending' | 'sensing' | 'completed' | 'failed' | 'cancelled' | 'disabled';
  ai_result?: Record<string, unknown> | null;
  mood_tag?: string;
  retrievedContext?: Record<string, any> | null;
  analysisMetadata?: Record<string, any> | null;
  realLifeHypothesesFeedback?: IDream['realLifeHypothesesFeedback'];
  editedAt: Date;
}

export interface IDreamAddition {
  sequence: number;
  content: string;
  addedAt: Date;
  analysisState?: 'pending' | 'analyzed' | 'unanalyzed';
  analysisRunId?: string;
  analyzedAt?: Date;
}

export interface IDream extends Document {
  userId: Types.ObjectId;
  content: string;
  contentHash?: string;
  analysisEmbedding?: number[];
  mood_tag: string;
  is_public: boolean;
  privacy: 'public' | 'private';
  ai_analysis_enabled: boolean;
  likes: string[];
  likes_count: number;
  comments_count: number;
  created_at: Date;
  ai_status: 'pending' | 'sensing' | 'completed' | 'failed' | 'cancelled' | 'disabled';
  ai_result: Record<string, unknown> | null;
  edit_history: IEditHistoryEntry[];
  additions: IDreamAddition[];
  sleepContext?: Record<string, any>;
  retrievedContext?: Record<string, any> | null;
  analysisMetadata?: Record<string, any> | null;
  continuationMetadata?: Record<string, any> | null;
  analysisRun?: {
    runId: string;
    trigger: 'initial' | 'retry' | 'dream_addition' | 'addition_retry' | 'content_edit' | 'addition_edit' | 'ai_enable';
    startedAt: Date;
    previousStatus?: IDream['ai_status'] | null;
    targetAdditionSequences?: number[];
  } | null;
  analysisRollback?: {
    runId: string;
    previousStatus?: IDream['ai_status'] | null;
    hadPreviousResult: boolean;
    previousAnalysisMetadata?: Record<string, any> | null;
  } | null;
  realLifeHypothesesFeedback?: Array<{
    hypothesisIndex: number;
    ruleId?: string;
    verificationKey?: string;
    answer: 'yes' | 'no' | 'unsure';
    effect: 'supports' | 'weakens' | 'unresolved';
    questionText: string;
    userId: Types.ObjectId;
    updatedAt: Date;
  }> | null;
}

const DreamAdditionSchema = new Schema<IDreamAddition>(
  {
    sequence: { type: Number, required: true, min: 1 },
    content: { type: String, required: true, trim: true },
    addedAt: { type: Date, default: Date.now },
    analysisState: {
      type: String,
      enum: ['pending', 'analyzed', 'unanalyzed'],
      default: 'analyzed',
    },
    analysisRunId: { type: String, required: false },
    analyzedAt: { type: Date, required: false },
  },
  { _id: false }
);

const EditHistorySchema = new Schema<IEditHistoryEntry>(
  {
    version: { type: Number, required: false, min: 1 },
    content: { type: String, required: true },
    additions: { type: [DreamAdditionSchema], required: false, default: undefined },
    ai_status: {
      type: String,
      enum: ['pending', 'sensing', 'completed', 'failed', 'cancelled', 'disabled'],
      required: false,
    },
    ai_result: { type: Schema.Types.Mixed, required: false },
    mood_tag: { type: String, required: false },
    retrievedContext: { type: Schema.Types.Mixed, required: false },
    analysisMetadata: { type: Schema.Types.Mixed, required: false },
    realLifeHypothesesFeedback: { type: Schema.Types.Mixed, required: false },
    editedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DreamSchema = new Schema<IDream>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    contentHash: {
      type: String,
      required: false,
      select: false,
      match: /^[a-f0-9]{64}$/,
    },
    analysisEmbedding: {
      type: [Number],
      required: false,
      select: false,
      default: undefined,
    },
    mood_tag: {
      type: String,
      trim: true,
      default: '',
    },
    is_public: {
      type: Boolean,
      default: true,
    },
    privacy: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    ai_analysis_enabled: {
      type: Boolean,
      default: true,
    },
    likes: {
      type: [String],
      default: [],
    },
    likes_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    comments_count: {
      type: Number,
      default: 0,
      min: 0,
    },
    created_at: {
      type: Date,
      default: () => new Date(),
    },
    ai_status: {
      type: String,
      enum: ['pending', 'sensing', 'completed', 'failed', 'cancelled', 'disabled'],
      default: 'pending',
    },
    ai_result: {
      type: Schema.Types.Mixed,
      default: null,
    },
    edit_history: {
      type: [EditHistorySchema],
      default: [],
    },
    additions: {
      type: [DreamAdditionSchema],
      default: [],
    },
    sleepContext: {
      type: Schema.Types.Mixed,
      default: {},
    },
    retrievedContext: {
      type: Schema.Types.Mixed,
      default: null,
    },
    analysisMetadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    continuationMetadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    analysisRun: {
      type: Schema.Types.Mixed,
      default: null,
    },
    analysisRollback: {
      type: Schema.Types.Mixed,
      default: null,
      select: false,
    },
    realLifeHypothesesFeedback: {
      type: [
        {
          hypothesisIndex: { type: Number, required: true },
          ruleId: { type: String, required: false },
          verificationKey: { type: String, required: false },
          answer: { type: String, enum: ['yes', 'no', 'unsure'], required: true },
          effect: { type: String, enum: ['supports', 'weakens', 'unresolved'], required: true, default: 'unresolved' },
          questionText: { type: String, required: true },
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: 'updated_at' },
  }
);

// Timeline Index
DreamSchema.index({ userId: 1, created_at: -1 });
DreamSchema.index({ userId: 1, contentHash: 1, created_at: -1 });
DreamSchema.index({ 'realLifeHypothesesFeedback.ruleId': 1 });
DreamSchema.index({ 'realLifeHypothesesFeedback.verificationKey': 1 });
DreamSchema.index({ userId: 1, 'ai_result.symbolic_notes.symbol': 1, created_at: -1 });

// Global Feed Index
DreamSchema.index({ created_at: -1 });

export default mongoose.model<IDream>('Dream', DreamSchema);

import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IEditHistoryEntry {
  content: string;
  editedAt: Date;
}

export interface IDream extends Document {
  userId: Types.ObjectId;
  content: string;
  mood_tag: string;
  is_public: boolean;
  privacy: 'public' | 'private';
  likes: string[];
  likes_count: number;
  comments_count: number;
  created_at: Date;
  ai_status: 'pending' | 'sensing' | 'completed' | 'failed';
  ai_result: Record<string, unknown> | null;
  edit_history: IEditHistoryEntry[];
  sleepContext?: Record<string, any>;
  retrievedContext?: Record<string, any> | null;
  analysisMetadata?: Record<string, any> | null;
  realLifeHypothesesFeedback?: Array<{
    hypothesisIndex: number;
    answer: 'yes' | 'no' | 'unsure';
    questionText: string;
    userId: Types.ObjectId;
    updatedAt: Date;
  }> | null;
  ruleFeedback?: Array<{
    ruleId: string;
    confirmed: boolean;
    feedbackAt: Date;
  }> | null;
}

const EditHistorySchema = new Schema<IEditHistoryEntry>(
  {
    content: { type: String, required: true },
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
      enum: ['pending', 'sensing', 'completed', 'failed'],
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
    realLifeHypothesesFeedback: {
      type: [
        {
          hypothesisIndex: { type: Number, required: true },
          answer: { type: String, enum: ['yes', 'no', 'unsure'], required: true },
          questionText: { type: String, required: true },
          userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    ruleFeedback: {
      type: [
        {
          ruleId: { type: String, required: true },
          confirmed: { type: Boolean, required: true },
          feedbackAt: { type: Date, default: Date.now },
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

// Global Feed Index
DreamSchema.index({ created_at: -1 });

export default mongoose.model<IDream>('Dream', DreamSchema);

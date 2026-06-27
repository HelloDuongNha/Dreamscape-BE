import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * A single edit history entry — stores the content before the edit.
 */
export interface IEditHistoryEntry {
  content:  string;
  editedAt: Date;
}

/**
 * Represents the shape of a Dream document in MongoDB.
 * Aligns with PROJECT_SPEC.md § 6.2 — Dreams Collection.
 */
export interface IDream extends Document {
  userId:        Types.ObjectId;       // foreign key → User._id
  content:       string;               // the dream text body
  mood_tag:      string;               // e.g. "Lucid" | "Nightmare" | "Calm"
  is_public:     boolean;              // public = appears in global feed
  privacy:       'public' | 'private'; // granular privacy flag
  likes:         string[];             // array of userId strings who liked this post
  likes_count:   number;
  comments_count: number;
  created_at:    Date;                 // explicit field (used as cursor for pagination)
  ai_status:     'pending' | 'sensing' | 'completed' | 'failed';
  ai_result:     Record<string, unknown> | null; // placeholder for Phase 2 Oracle data
  edit_history:  IEditHistoryEntry[];  // previous content versions before each edit
  
  // Auditable RAG analysis fields
  dreamText?:       string;
  sleepContext?:    Record<string, any>;
  aiAnalysis?:      Record<string, any> | null;
  visibility?:      'public' | 'private';
  retrievedContext?: Record<string, any> | null;
  analysisMetadata?: Record<string, any> | null;
  realLifeHypothesesFeedback?: Array<{
    hypothesisIndex: number;
    answer: 'yes' | 'no' | 'unsure';
    questionText: string;
    userId: Types.ObjectId;
    updatedAt: Date;
  }> | null;
}

// ─── Sub-Schema ───────────────────────────────────────────────────────────────

const EditHistorySchema = new Schema<IEditHistoryEntry>(
  {
    content:  { type: String, required: true },
    editedAt: { type: Date, default: Date.now },
  },
  { _id: false }  // no _id needed per sub-document
);

// ─── Schema ───────────────────────────────────────────────────────────────────

const DreamSchema = new Schema<IDream>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    content: {
      type: String,
      required: [true, 'Dream content is required'],
      trim: true,
      minlength: [1, 'Content cannot be empty'],
      maxlength: [2000, 'Content must not exceed 2000 characters'],
    },
    mood_tag: {
      type: String,
      trim: true,
      default: '',
      maxlength: [50, 'Mood tag must not exceed 50 characters'],
    },
    is_public: {
      type: Boolean,
      default: true,
    },
    // Granular privacy field — drives feed visibility
    privacy: {
      type:    String,
      enum:    ['public', 'private'],
      default: 'public',
    },
    // Array of userId strings who liked this post.
    // Enables O(1) membership check and drives likes_count.
    likes: {
      type:    [String],
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
    // Explicit created_at — not delegated to Mongoose timestamps — because it
    // is used as the pagination cursor and must be queryable as a Date field.
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
    // Stores previous content versions pushed before each edit operation.
    // Allows displaying an "Edited" label when edit_history.length > 0.
    edit_history: {
      type:    [EditHistorySchema],
      default: [],
    },
    // Auditable RAG analysis fields
    dreamText: {
      type: String,
      default: '',
    },
    sleepContext: {
      type: Schema.Types.Mixed,
      default: {},
    },
    visibility: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
    },
    aiAnalysis: {
      type: Schema.Types.Mixed,
      default: null,
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
      type: [{
        hypothesisIndex: { type: Number, required: true },
        answer: { type: String, enum: ['yes', 'no', 'unsure'], required: true },
        questionText: { type: String, required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        updatedAt: { type: Date, default: Date.now }
      }],
      default: []
    },
  },
  {
    // updatedAt only — created_at is managed explicitly above.
    timestamps: { createdAt: false, updatedAt: 'updated_at' },
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Compound index — covers personal timeline queries:
//   db.dreams.find({ userId, is_public }).sort({ created_at: -1 })
// The leading userId field also satisfies single-field lookups on userId.
DreamSchema.index({ userId: 1, created_at: -1 });

// Standalone index — covers global feed queries:
//   db.dreams.find({ is_public: true, created_at: { $lt: cursor } }).sort({ created_at: -1 })
DreamSchema.index({ created_at: -1 });

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IDream>('Dream', DreamSchema);

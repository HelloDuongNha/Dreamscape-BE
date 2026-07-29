import mongoose, { Document, Schema, Types } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

/**
 * Represents a Comment on a Dream post.
 * Aligns with PROJECT_SPEC.md § 6.5 — Comments Collection.
 */
export interface IComment extends Document {
  dreamId: Types.ObjectId;
  userId: Types.ObjectId;
  content: string;
  edit_history: Array<{
    content: string;
    editedAt: Date;
  }>;
  updated_at?: Date;
  is_deleted: boolean;
  deleted_at?: Date;
  deleted_by?: Types.ObjectId;
  deleted_by_role?: 'author' | 'dream_owner';
  created_at: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const CommentSchema = new Schema<IComment>(
  {
    dreamId: {
      type:     Schema.Types.ObjectId,
      ref:      'Dream',
      required: [true, 'dreamId is required'],
      index:    true,
    },
    userId: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: [true, 'userId is required'],
    },
    content: {
      type:      String,
      required:  [true, 'Comment content is required'],
      trim:      true,
      minlength: [1, 'Comment cannot be empty'],
      maxlength: [500, 'Comment must not exceed 500 characters'],
    },
    edit_history: {
      type: [{
        content: {
          type: String,
          required: true,
          maxlength: 500,
        },
        editedAt: {
          type: Date,
          required: true,
        },
        _id: false,
      }],
      default: [],
    },
    updated_at: {
      type: Date,
      required: false,
    },
    is_deleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deleted_at: {
      type: Date,
      required: false,
    },
    deleted_by: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    deleted_by_role: {
      type: String,
      enum: ['author', 'dream_owner'],
      required: false,
    },
    created_at: {
      type:    Date,
      default: () => new Date(),
    },
  },
  {
    // updatedAt only — created_at is explicit
    timestamps: { createdAt: false, updatedAt: false },
  },
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Covers: db.comments.find({ dreamId }).sort({ created_at: 1 })
CommentSchema.index({ dreamId: 1, created_at: 1 });
CommentSchema.index({ dreamId: 1, is_deleted: 1, created_at: 1 });

// ─── Model Export ─────────────────────────────────────────────────────────────

export default mongoose.model<IComment>('Comment', CommentSchema);

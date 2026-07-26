import mongoose, { Document, Schema, Types } from 'mongoose';
import type { OracleMode } from '../services/oracle/oracle.types';

export interface IOracleThread extends Document {
  userId: Types.ObjectId;
  title: string;
  mode: OracleMode;
  attachedDreamIds: Types.ObjectId[];
  pinned: boolean;
  archived: boolean;
  deletedAt?: Date;
  lastTurnAt: Date;
  nextTurnSequence: number;
  createdAt: Date;
  updatedAt: Date;
}

const OracleThreadSchema = new Schema<IOracleThread>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, trim: true, maxlength: 120, default: 'New conversation' },
    mode: {
      type: String,
      enum: ['chat', 'dream_analysis', 'creative_continuation'],
      default: 'chat',
      required: true,
    },
    attachedDreamIds: [{ type: Schema.Types.ObjectId, ref: 'Dream' }],
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    deletedAt: { type: Date, default: undefined },
    lastTurnAt: { type: Date, default: Date.now },
    nextTurnSequence: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

OracleThreadSchema.index({ userId: 1, deletedAt: 1, pinned: -1, lastTurnAt: -1, _id: -1 });

export default mongoose.model<IOracleThread>('OracleThread', OracleThreadSchema);

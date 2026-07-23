import mongoose, { Document, Schema, Types } from 'mongoose';

export type OracleRunEventType =
  | 'token'
  | 'tool_start'
  | 'tool_progress'
  | 'tool_complete'
  | 'citation'
  | 'cancelled'
  | 'done'
  | 'error';

export interface IOracleRunEvent extends Document {
  runId: Types.ObjectId;
  threadId: Types.ObjectId;
  userId: Types.ObjectId;
  sequence: number;
  eventType: OracleRunEventType;
  payload: Record<string, unknown>;
  expiresAt?: Date;
  createdAt: Date;
}

const OracleRunEventSchema = new Schema<IOracleRunEvent>(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'OracleRun', required: true },
    threadId: { type: Schema.Types.ObjectId, ref: 'OracleThread', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sequence: { type: Number, required: true, min: 1 },
    eventType: {
      type: String,
      enum: ['token', 'tool_start', 'tool_progress', 'tool_complete', 'citation', 'cancelled', 'done', 'error'],
      required: true,
    },
    payload: { type: Schema.Types.Mixed, default: {} },
    expiresAt: Date,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

OracleRunEventSchema.index({ runId: 1, sequence: 1 }, { unique: true });
OracleRunEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OracleRunEventSchema.index({ userId: 1, runId: 1, sequence: 1 });

export default mongoose.model<IOracleRunEvent>('OracleRunEvent', OracleRunEventSchema);

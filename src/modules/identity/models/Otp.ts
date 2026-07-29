import mongoose, { Document, Schema } from 'mongoose';

export type OtpPurpose = 'register' | 'update_email' | 'forgot_password';

export interface IOtp extends Document {
  email: string;
  purpose: OtpPurpose;
  codeHash: string;
  codeVersion: number;
  subjectUserId?: mongoose.Types.ObjectId | null;
  sessionId?: string | null;
  requestFingerprint?: string | null;
  payload?: Record<string, unknown> | null;
  attemptCount: number;
  maxAttempts: number;
  resendAvailableAt: Date;
  sendCount: number;
  expiresAt: Date;
  verifiedAt?: Date | null;
  consumedAt?: Date | null;
  resetGrantHash?: string | null;
  resetGrantExpiresAt?: Date | null;
  resetGrantConsumedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const OtpSchema = new Schema<IOtp>(
  {
    email: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: ['register', 'update_email', 'forgot_password'],
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      select: false,
    },
    codeVersion: {
      type: Number,
      required: true,
      default: 1,
    },
    subjectUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      default: null,
    },
    requestFingerprint: {
      type: String,
      default: null,
      index: true,
      select: false,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
      min: 1,
      max: 10,
    },
    resendAvailableAt: {
      type: Date,
      required: true,
    },
    sendCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    resetGrantHash: {
      type: String,
      default: null,
      select: false,
    },
    resetGrantExpiresAt: {
      type: Date,
      default: null,
    },
    resetGrantConsumedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

OtpSchema.index({ email: 1, purpose: 1, createdAt: -1 });
OtpSchema.index({ subjectUserId: 1, sessionId: 1, purpose: 1, createdAt: -1 });

export default mongoose.model<IOtp>('Otp', OtpSchema);

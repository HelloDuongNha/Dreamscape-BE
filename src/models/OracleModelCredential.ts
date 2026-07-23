import mongoose, { Document, Schema, Types } from 'mongoose';

export type OracleCredentialProvider = 'openai_compatible' | 'ollama';
export type OracleCredentialStatus = 'unchecked' | 'active' | 'failed';

export interface IOracleModelCredential extends Document {
  userId: Types.ObjectId;
  provider: OracleCredentialProvider;
  label: string;
  baseUrl: string;
  modelName: string;
  keyHint?: string;
  encryptedKey?: string;
  encryptionIv?: string;
  encryptionTag?: string;
  active: boolean;
  privateContextAcknowledged: boolean;
  status: OracleCredentialStatus;
  lastCheckedAt?: Date;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OracleModelCredentialSchema = new Schema<IOracleModelCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, enum: ['openai_compatible', 'ollama'], required: true },
    label: { type: String, trim: true, maxlength: 80, required: true },
    baseUrl: { type: String, maxlength: 500, required: true },
    modelName: { type: String, trim: true, maxlength: 160, required: true },
    keyHint: { type: String, maxlength: 32 },
    encryptedKey: { type: String, select: false },
    encryptionIv: { type: String, select: false },
    encryptionTag: { type: String, select: false },
    active: { type: Boolean, default: false },
    privateContextAcknowledged: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ['unchecked', 'active', 'failed'],
      default: 'unchecked',
    },
    lastCheckedAt: Date,
    lastErrorCode: { type: String, maxlength: 80 },
  },
  { timestamps: true },
);

OracleModelCredentialSchema.index({ userId: 1, updatedAt: -1 });
OracleModelCredentialSchema.index(
  { userId: 1, active: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

export default mongoose.model<IOracleModelCredential>(
  'OracleModelCredential',
  OracleModelCredentialSchema,
);

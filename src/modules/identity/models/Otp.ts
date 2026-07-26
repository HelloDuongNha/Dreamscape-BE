import mongoose, { Document, Schema } from 'mongoose';

export interface IOtp extends Document {
  email:     string;
  otpCode:   string;
  purpose:   'register' | 'update_email' | 'forgot_password';
  payload?:  Record<string, any> | null;
  createdAt: Date;
}

const OtpSchema = new Schema<IOtp>({
  email: {
    type:     String,
    required: true,
    index:    true,
  },
  otpCode: {
    type:     String,
    required: true,
  },
  purpose: {
    type:     String,
    required: true,
    enum:     ['register', 'update_email', 'forgot_password'],
  },
  payload: {
    type:     Schema.Types.Mixed,
    default:  null,
  },
  createdAt: {
    type:     Date,
    default:  Date.now,
    expires:  300, // automatic self-deletion after 5 minutes (300 seconds)
  },
});

export default mongoose.model<IOtp>('Otp', OtpSchema);

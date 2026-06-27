import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUserDreamProfile extends Document {
  userId: Types.ObjectId;
  basicProfile?: any;
  culturalProfile?: any;
  scoringProfile?: any;
  measuredPsychologicalProfile?: any;
  learnedPersonalPattern?: any;
  preferences?: any;
  createdAt: Date;
  updatedAt: Date;
}

const UserDreamProfileSchema = new Schema<IUserDreamProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    basicProfile: {
      type: Schema.Types.Mixed,
    },
    culturalProfile: {
      type: Schema.Types.Mixed,
    },
    scoringProfile: {
      type: Schema.Types.Mixed,
    },
    measuredPsychologicalProfile: {
      type: Schema.Types.Mixed,
    },
    learnedPersonalPattern: {
      type: Schema.Types.Mixed,
    },
    preferences: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    collection: 'user_dream_profiles',
  }
);

export default mongoose.model<IUserDreamProfile>('UserDreamProfile', UserDreamProfileSchema);

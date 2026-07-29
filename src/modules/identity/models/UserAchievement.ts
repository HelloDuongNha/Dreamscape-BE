import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUserAchievement extends Document {
  userId: Types.ObjectId;
  achievementKey: string;
  achievementName: string;
  level: number;
  unlockedAt: Date;
  source: 'source_contribution';
  createdAt: Date;
  updatedAt: Date;
}

const UserAchievementSchema = new Schema<IUserAchievement>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    achievementKey: {
      type: String,
      required: true,
      index: true
    },
    achievementName: {
      type: String,
      required: true
    },
    level: {
      type: Number,
      required: true
    },
    unlockedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      enum: ['source_contribution'],
      default: 'source_contribution',
      required: true
    }
  },
  {
    timestamps: true,
    collection: 'user_achievements'
  }
);

// Compound unique index to prevent duplicate achievements per user
UserAchievementSchema.index({ userId: 1, achievementKey: 1 }, { unique: true });

export default mongoose.model<IUserAchievement>('UserAchievement', UserAchievementSchema);

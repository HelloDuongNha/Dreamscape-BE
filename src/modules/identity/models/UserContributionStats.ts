import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IUserContributionStats extends Document {
  userId: Types.ObjectId;
  submittedSourceCount: number;
  approvedSourceCount: number;
  rejectedSourceCount: number;
  pendingSourceCount: number;
  contributionPoints: number;
  contributionLevel: number;
  lastContributionAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserContributionStatsSchema = new Schema<IUserContributionStats>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    submittedSourceCount: {
      type: Number,
      default: 0
    },
    approvedSourceCount: {
      type: Number,
      default: 0
    },
    rejectedSourceCount: {
      type: Number,
      default: 0
    },
    pendingSourceCount: {
      type: Number,
      default: 0
    },
    contributionPoints: {
      type: Number,
      default: 0
    },
    contributionLevel: {
      type: Number,
      default: 0
    },
    lastContributionAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    collection: 'user_contribution_stats'
  }
);

export default mongoose.model<IUserContributionStats>('UserContributionStats', UserContributionStatsSchema);

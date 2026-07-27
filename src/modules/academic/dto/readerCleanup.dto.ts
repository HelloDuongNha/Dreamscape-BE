import type { ClientSession, Types } from 'mongoose';
import type { ReaderReplacementTargetType } from '../models/ReaderReplacementRun';

export interface ReaderOwner {
  targetType: ReaderReplacementTargetType;
  targetId: Types.ObjectId;
}

export interface ReaderCleanupPlan {
  owner: ReaderOwner;
  imageAssetIds: string[];
  replacementAssetIds: string[];
}

export interface ReaderCleanupCounts {
  documents: number;
  sections: number;
  chunks: number;
  ruleEvidence: number;
  rulesRemoved: number;
  rulesRescored: number;
  ruleRuns: number;
}

export interface ReaderCleanupOptions {
  session?: ClientSession;
}

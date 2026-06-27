import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

export enum RuleClassification {
  DreamRecall = 'DreamRecall',
  DreamFrequency = 'DreamFrequency',
  DreamIntensity = 'DreamIntensity',
  LucidDreaming = 'LucidDreaming',
  Nightmares = 'Nightmares',
  BadDreams = 'BadDreams',
  EmotionalIncorporation = 'EmotionalIncorporation',
  StressIncorporation = 'StressIncorporation',
  TraumaReplay = 'TraumaReplay',
  WakingIncorporation = 'WakingIncorporation',
  ExternalStimulus = 'ExternalStimulus',
  ChronotypeRelation = 'ChronotypeRelation',
  SleepPosture = 'SleepPosture',
  SleepEnvironment = 'SleepEnvironment',
  SleepQuality = 'SleepQuality',
  SleepStageRelation = 'SleepStageRelation',
  PersonalityCorrelations = 'PersonalityCorrelations',
  GenderDifferences = 'GenderDifferences',
  AgeCorrelations = 'AgeCorrelations',
  CulturalSymbols = 'CulturalSymbols',
  SleepDisorders = 'SleepDisorders',
  CognitiveFunctions = 'CognitiveFunctions',
  Other = 'Other'
}

export interface IVerifiedKnowledgeRule extends Document {
  _id: mongoose.Types.ObjectId;
  ruleCode: string;
  ruleStatement: string;
  classifications: RuleClassification[];
  scientificBasis: string;
  evidenceIds: mongoose.Types.ObjectId[]; // List of references to groundings in knowledge_rule_evidences
  embedding?: number[];
  usageStatistics: {
    timesRetrieved: number;
    timesApplied: number;
    positiveFeedback: number;
    negativeFeedback: number;
    confirmationRate: number;
    lastUsedAt?: Date;
    lastConfirmedAt?: Date;
  };
  lastEvidenceUpdatedAt: Date;
  version: number;
  createdBy: mongoose.Types.ObjectId;
  createdFromExtractionRunId: mongoose.Types.ObjectId;
  lastModifiedBy?: mongoose.Types.ObjectId;
  lastModifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function generateRuleCode(): string {
  let result = '';
  const randomBytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    const index = randomBytes[i] % alphabet.length;
    result += alphabet[index];
  }
  return `KR_${result}`;
}

const VerifiedKnowledgeRuleSchema = new Schema<IVerifiedKnowledgeRule>(
  {
    ruleCode: {
      type: String,
      unique: true,
      required: true,
      index: true,
      immutable: true,
      default: generateRuleCode
    },
    ruleStatement: {
      type: String,
      required: true
    },
    classifications: {
      type: [String],
      enum: Object.values(RuleClassification),
      required: true,
      default: []
    },
    scientificBasis: {
      type: String,
      required: true
    },
    evidenceIds: {
      type: [Schema.Types.ObjectId],
      ref: 'KnowledgeRuleEvidence',
      required: true,
      default: []
    },
    embedding: {
      type: [Number],
      required: false
    },
    usageStatistics: {
      timesRetrieved: { type: Number, default: 0 },
      timesApplied: { type: Number, default: 0 },
      positiveFeedback: { type: Number, default: 0 },
      negativeFeedback: { type: Number, default: 0 },
      confirmationRate: { type: Number, default: 0 },
      lastUsedAt: { type: Date },
      lastConfirmedAt: { type: Date }
    },
    lastEvidenceUpdatedAt: {
      type: Date,
      default: Date.now
    },
    version: {
      type: Number,
      required: true,
      default: 1
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdFromExtractionRunId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicRuleExtractionRun',
      required: true
    },
    lastModifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },
    lastModifiedAt: {
      type: Date
    }
  },
  {
    timestamps: true,
    collection: 'verified_knowledge_rules'
  }
);

// Semantic and Code search indexes
VerifiedKnowledgeRuleSchema.index({ classifications: 1 });

export default mongoose.model<IVerifiedKnowledgeRule>('VerifiedKnowledgeRule', VerifiedKnowledgeRuleSchema);

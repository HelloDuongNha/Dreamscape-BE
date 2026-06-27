import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IAcademicRuleExtractionRun extends Document {
  academicSourceId: Types.ObjectId;
  sourceContentHash: string;
  status: 'pending' | 'success' | 'failed';
  generationModel: string;
  promptVersion: string;
  domainRelevanceStatus: 'relevant' | 'irrelevant';
  domainRelevanceReason?: string;
  reasonCode?: string;
  totalSectionsRead: number;
  eligibleChunkCount: number;
  sectionGroupCount: number;
  rawCandidateCount: number;
  consolidatedCandidateCount: number;
  savedCandidateCount: number;
  updatedCandidateCount: number;
  reusedCandidateCount: number;
  skippedDuplicateCount: number;
  discardedNoEvidenceCount: number;
  discardedWeakEvidenceCount: number;
  discardedIrrelevantCount: number;
  exceedsCandidateCap: boolean;
  paperDomain?: 'dream_sleep_psychology' | 'computer_vision' | 'medicine' | 'general_science' | 'unknown';
  oracleEligibleCount?: number;
  nonOracleEligibleCount?: number;
  totalSectionGroups?: number;
  processedSectionGroups?: number;
  currentStage?: 'initializing' | 'domain_check' | 'extracting_candidates' | 'saving_candidates' | 'completed' | 'failed';
  sanitizedError?: string;
  validationErrors: string[];
  generationWarnings: string[];
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicRuleExtractionRunSchema = new Schema<IAcademicRuleExtractionRun>(
  {
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true,
    },
    sourceContentHash: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
    },
    generationModel: {
      type: String,
      required: true,
      trim: true,
    },
    promptVersion: {
      type: String,
      required: true,
      trim: true,
    },
    domainRelevanceStatus: {
      type: String,
      required: true,
      enum: ['relevant', 'irrelevant'],
    },
    domainRelevanceReason: {
      type: String,
      trim: true,
    },
    reasonCode: {
      type: String,
      trim: true,
    },
    totalSectionsRead: {
      type: Number,
      required: true,
      default: 0,
    },
    eligibleChunkCount: {
      type: Number,
      required: true,
      default: 0,
    },
    sectionGroupCount: {
      type: Number,
      required: true,
      default: 0,
    },
    rawCandidateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    consolidatedCandidateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    savedCandidateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    updatedCandidateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    reusedCandidateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    skippedDuplicateCount: {
      type: Number,
      required: true,
      default: 0,
    },
    discardedNoEvidenceCount: {
      type: Number,
      required: true,
      default: 0,
    },
    discardedWeakEvidenceCount: {
      type: Number,
      required: true,
      default: 0,
    },
    discardedIrrelevantCount: {
      type: Number,
      required: true,
      default: 0,
    },
    exceedsCandidateCap: {
      type: Boolean,
      required: true,
      default: false,
    },
    paperDomain: {
      type: String,
      enum: ['dream_sleep_psychology', 'computer_vision', 'medicine', 'general_science', 'unknown'],
      default: 'unknown',
    },
    oracleEligibleCount: {
      type: Number,
      default: 0,
    },
    nonOracleEligibleCount: {
      type: Number,
      default: 0,
    },
    totalSectionGroups: {
      type: Number,
      default: 0,
    },
    processedSectionGroups: {
      type: Number,
      default: 0,
    },
    currentStage: {
      type: String,
      enum: ['initializing', 'domain_check', 'extracting_candidates', 'saving_candidates', 'completed', 'failed'],
      default: 'initializing',
    },
    sanitizedError: {
      type: String,
      trim: true,
    },
    validationErrors: {
      type: [String],
      default: [],
    },
    generationWarnings: {
      type: [String],
      default: [],
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    finishedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'academic_rule_extraction_runs',
  }
);

// Indexes for logging analytics
AcademicRuleExtractionRunSchema.index({ createdAt: 1 });
AcademicRuleExtractionRunSchema.index({ academicSourceId: 1, status: 1 });

export default mongoose.model<IAcademicRuleExtractionRun>('AcademicRuleExtractionRun', AcademicRuleExtractionRunSchema);

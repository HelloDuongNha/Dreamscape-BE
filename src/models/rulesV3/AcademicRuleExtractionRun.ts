import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAcademicRuleExtractionRunV3 extends Document {
  academicSourceId: Types.ObjectId;
  sourceContentHash: string;
  extractionEngineVersion: string;
  generationModel: string;
  promptVersion: string;
  scoringFormulaVersion: string;
  status: 'pending' | 'success' | 'failed';
  currentStage: string;
  totalBatches: number;
  processedBatches: number;
  rawCandidateCount: number;
  verifiedCandidateCount: number;
  savedCandidateCount: number;
  mergedCandidateCount: number;
  rejectedCandidateCount: number;
  targetChunkCount: number;
  evidenceChunkCount: number;
  resultRuleIds: Types.ObjectId[];
  attemptHistory: Array<{
    status: 'success' | 'failed';
    startedAt: Date;
    finishedAt?: Date;
    durationMs?: number;
    generationModel: string;
    targetChunkCount?: number;
    evidenceChunkCount?: number;
    totalBatches: number;
    processedBatches: number;
    rawCandidateCount: number;
    verifiedCandidateCount: number;
    savedCandidateCount: number;
    mergedCandidateCount: number;
    rejectedCandidateCount: number;
    sanitizedErrorCode?: string;
    rejectionDiagnostics: Array<{
      batchId: string;
      reasonCode: string;
      safeMessage: string;
      proposedStatement?: string;
    }>;
  }>;
  rejectionDiagnostics: Array<{
    batchId: string;
    reasonCode: string;
    safeMessage: string;
    proposedStatement?: string;
  }>;
  sanitizedErrorCode?: string;
  startedAt: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AcademicRuleExtractionRunV3Schema = new Schema<IAcademicRuleExtractionRunV3>(
  {
    academicSourceId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicSource',
      required: true,
      index: true
    },
    sourceContentHash: {
      type: String,
      required: true
    },
    extractionEngineVersion: {
      type: String,
      required: true
    },
    generationModel: {
      type: String,
      required: true,
      trim: true
    },
    promptVersion: {
      type: String,
      required: true,
      trim: true
    },
    scoringFormulaVersion: {
      type: String,
      required: true,
      trim: true
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      required: true,
      default: 'pending',
      index: true
    },
    currentStage: {
      type: String,
      required: true,
      default: 'initializing'
    },
    totalBatches: {
      type: Number,
      required: true,
      default: 0
    },
    processedBatches: {
      type: Number,
      required: true,
      default: 0
    },
    rawCandidateCount: {
      type: Number,
      required: true,
      default: 0
    },
    verifiedCandidateCount: {
      type: Number,
      required: true,
      default: 0
    },
    savedCandidateCount: {
      type: Number,
      required: true,
      default: 0
    },
    mergedCandidateCount: {
      type: Number,
      required: true,
      default: 0
    },
    rejectedCandidateCount: {
      type: Number,
      required: true,
      default: 0
    },
    targetChunkCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    evidenceChunkCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    resultRuleIds: {
      type: [Schema.Types.ObjectId],
      ref: 'KnowledgeRuleV3',
      required: true,
      default: []
    },
    attemptHistory: {
      type: [{
        _id: false,
        status: { type: String, enum: ['success', 'failed'], required: true },
        startedAt: { type: Date, required: true },
        finishedAt: { type: Date, required: false },
        durationMs: { type: Number, required: false, min: 0 },
        generationModel: { type: String, required: true },
        targetChunkCount: { type: Number, required: false, min: 0 },
        evidenceChunkCount: { type: Number, required: false, min: 0 },
        totalBatches: { type: Number, required: true, min: 0 },
        processedBatches: { type: Number, required: true, min: 0 },
        rawCandidateCount: { type: Number, required: true, min: 0 },
        verifiedCandidateCount: { type: Number, required: true, min: 0 },
        savedCandidateCount: { type: Number, required: true, min: 0 },
        mergedCandidateCount: { type: Number, required: true, min: 0 },
        rejectedCandidateCount: { type: Number, required: true, min: 0 },
        sanitizedErrorCode: { type: String, required: false },
        rejectionDiagnostics: {
          type: [{
            _id: false,
            batchId: { type: String, required: true },
            reasonCode: { type: String, required: true },
            safeMessage: { type: String, required: true },
            proposedStatement: { type: String, required: false, maxlength: 300 }
          }],
          required: true,
          default: []
        }
      }],
      required: true,
      default: [],
      validate: {
        validator: (items: unknown[]) => items.length <= 10,
        message: 'Chỉ lưu tối đa 10 lần phân tích Rule V3 gần nhất trong mỗi fingerprint.'
      }
    },
    rejectionDiagnostics: {
      type: [{
        _id: false,
        batchId: { type: String, required: true },
        reasonCode: { type: String, required: true },
        safeMessage: { type: String, required: true },
        proposedStatement: { type: String, required: false, maxlength: 300 }
      }],
      required: true,
      default: [],
      validate: {
        validator: (items: unknown[]) => items.length <= 50,
        message: 'Chỉ lưu tối đa 50 chẩn đoán candidate bị loại cho mỗi lần chạy.'
      }
    },
    sanitizedErrorCode: {
      type: String,
      required: false,
      trim: true
    },
    startedAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    finishedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true,
    collection: 'academic_rule_extraction_runs_v3'
  }
);

// Idempotency compound unique index including generationModel:
AcademicRuleExtractionRunV3Schema.index(
  {
    academicSourceId: 1,
    sourceContentHash: 1,
    extractionEngineVersion: 1,
    generationModel: 1,
    promptVersion: 1,
    scoringFormulaVersion: 1
  },
  { unique: true }
);

export default mongoose.model<IAcademicRuleExtractionRunV3>('AcademicRuleExtractionRunV3', AcademicRuleExtractionRunV3Schema);

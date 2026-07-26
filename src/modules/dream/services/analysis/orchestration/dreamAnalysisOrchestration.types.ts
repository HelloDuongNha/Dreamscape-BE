import mongoose from 'mongoose';
import { ILLMOutput } from '../../../../../infrastructure/llm.service';
import { SimilarDreamMatch } from '../retrieval/similarDreamRetrieval.service';
import { ObservedSymbolPattern } from '../retrieval/symbolObservation.service';

export interface AppliedDreamRule {
  ruleId: string;
  group: string;
  factor: string;
  confidenceCap: number;
  claimStrength: string;
  applicationRole?: 'psychological_mechanism' | 'contextual_probe' | 'descriptive_pattern';
  applicationTier?: 'supported' | 'exploratory';
  evidenceScore?: number;
  supportingSourceCount?: number;
}

export interface UsedDreamSymbol {
  symbol: string;
  category: string;
  symbolValence: number;
  rawSimilarityScore: number | null;
  adjustedScore: number;
  retrievalMethods: string[];
  lowConfidence: boolean;
  fallbackReason: string | null;
  interpretation?: string;
  boostReasons: string[];
  suppressedBoostReasons: string[];
  canonicalSymbol: string;
  matchedVariants: string[];
  matchedTextVariant?: string;
}

export interface DreamAnalysisResult {
  aiAnalysis: ILLMOutput;
  analysisEmbedding: number[];
  retrievedContext: {
    componentA: {
      rawText: string;
      dreamNarrative: string;
      wakingReactionText: string;
      sleepContextText: string;
      sleepContext: Record<string, any>;
      segmentationReasons: string[];
      usedSymbols: UsedDreamSymbol[];
      retrievalConfig: {
        topK: number;
        minSimilarityScore: number;
        embeddingModel: string;
        retrievalStrategy: string;
        vectorBackend: string;
      };
    };
    componentB: {
      usedProfileFields: {
        culturalProfileUsed: boolean;
        measuredPsychologicalProfileUsed: boolean;
        learnedPersonalPatternUsed: boolean;
        reason?: string;
      };
    };
    componentC: {
      similarDreams: SimilarDreamMatch[];
      personalSymbolPatterns: Array<{ symbol: string; occurrences: number; recentMeaning: string }>;
      observedSymbolPatterns: ObservedSymbolPattern[];
    };
    componentD: {
      appliedRules: AppliedDreamRule[];
      evidenceLinks?: {
        ruleId: string;
        evidenceRole: string;
        sourceId: mongoose.Types.ObjectId;
        sourceTitle: string;
        sourceYear: number | null;
        doi: string | null;
        chunkIds: mongoose.Types.ObjectId[];
        chunkPreview: string;
      }[];
    };
  };
  strategyUsed: 'hybrid_rerank';
}

export type DreamAnalysisStage =
  | 'preparing'
  | 'retrieving_context'
  | 'retrieving_rules'
  | 'generating_analysis'
  | 'finalizing';

export interface DreamAnalysisProgress {
  stage: DreamAnalysisStage;
  progress: number;
  message: string;
  miniStep?: string;
  resultSummary?: string;
}

export type DreamAnalysisReporter = (
  stage: DreamAnalysisStage,
  progress: number,
  message: string,
  miniStep?: string,
  resultSummary?: string,
) => Promise<void>;

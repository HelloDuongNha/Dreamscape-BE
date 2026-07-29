export interface RetrievedSymbol {
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
  metadataFromVariant?: string;
}

export type SymbolVectorBackend =
  | 'mongodb_vector_search'
  | 'in_memory_cosine_fallback'
  | 'not_used';

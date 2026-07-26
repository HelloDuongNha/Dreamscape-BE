import DreamSymbol from '../../../models/DreamSymbol';
import type { SymbolVectorBackend } from './symbolRetrieval.types';

function cosineSimilarity(first: number[], second: number[]): number {
  let dotProduct = 0;
  let firstNorm = 0;
  let secondNorm = 0;
  for (let index = 0; index < first.length; index++) {
    dotProduct += first[index] * second[index];
    firstNorm += first[index] * first[index];
    secondNorm += second[index] * second[index];
  }
  if (firstNorm === 0 || secondNorm === 0) return 0;
  return dotProduct / (Math.sqrt(firstNorm) * Math.sqrt(secondNorm));
}

export async function getSymbolVectorScores(
  queryVector: number[] | null,
): Promise<{ scores: Map<string, number>; backend: SymbolVectorBackend }> {
  const scores = new Map<string, number>();
  if (!queryVector) {
    return { scores, backend: 'in_memory_cosine_fallback' };
  }

  try {
    const results = await DreamSymbol.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector,
          numCandidates: 100,
          limit: 100,
        },
      },
      {
        $project: {
          symbol: 1,
          similarityScore: { $meta: 'vectorSearchScore' },
        },
      },
    ]);
    if (Array.isArray(results) && results.length > 0) {
      for (const result of results) {
        scores.set(result.symbol.toLowerCase(), result.similarityScore);
      }
      return { scores, backend: 'mongodb_vector_search' };
    }
  } catch {
    // MongoDB Vector Search is optional; local cosine scoring is the contract.
  }

  const symbols = await DreamSymbol.find().lean() as any[];
  for (const symbol of symbols) {
    if (Array.isArray(symbol.embedding) && symbol.embedding.length === 768) {
      scores.set(
        symbol.symbol.toLowerCase(),
        cosineSimilarity(queryVector, symbol.embedding),
      );
    }
  }
  return { scores, backend: 'in_memory_cosine_fallback' };
}

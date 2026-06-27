import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const isOffline = process.argv.includes('--offline') || !process.argv.includes('--online');
const modeLabel = isOffline ? 'offline_exact_match_only' : 'online_hybrid_vector_test';

// Import LLM service to conditionally patch it
import * as llmService from '../src/services/llm.service';

if (isOffline) {
  process.env.RAG_OFFLINE = 'true';
  (llmService as any).generateEmbedding = async (text: string): Promise<number[] | null> => {
    return null;
  };
}

// Import retrieval service and helpers
import { 
  retrieveSymbolsHybrid,
  isStrictExactMatch,
  isExclusivelyInNoisePhrases,
  isLikelyEnglish,
  canonicalAliasMap
} from '../src/services/symbolRetrieval.service';

const testDreams = [
  {
    id: 1,
    text: "I had a vivid dream where I was falling from a high building and screaming. I woke up sweating. I slept on my back in a very hot room.",
    expected: ['Scream', 'Fall', 'Building', 'Back', 'Up']
  },
  {
    id: 2,
    text: "I dreamed I was eating dinner with my family.",
    expected: ['Eating']
  },
  {
    id: 3,
    text: "Tôi mơ thấy mình đang ăn cơm với gia đình.",
    expected: ['Eating']
  },
  {
    id: 4,
    text: "Tôi mo thay minh dang an com voi gia dinh.",
    expected: ['Eating']
  },
  {
    id: 5,
    text: "A giant snake was chasing me down the street and I was filled with panic and fear.",
    expected: ['Snake', 'Chase', 'Fear', 'Panic']
  },
  {
    id: 6,
    text: "I was trapped in a burning building surrounded by fire and water, screaming for help.",
    expected: ['Trapped', 'Burning', 'Building', 'Fire', 'Water', 'Scream']
  },
  {
    id: 7,
    text: "I had to run to school to take an exam, but I got lost and felt panicking.",
    expected: ['School', 'Exam', 'Panic']
  },
  {
    id: 8,
    text: "I woke up in a dark room and saw a tall figure standing in front of me.",
    expected: ['Tall', 'Room', 'Up']
  },
  {
    id: 9,
    text: "I woke up and realized I had a snake on my back, then I woke up again screaming.",
    expected: ['Snake', 'Back', 'Up', 'Scream']
  },
  {
    id: 10,
    text: "We went to a restaurant and ordered food, but we were waiting forever to eat.",
    expected: ['Waiting', 'Eating', 'Food']
  }
];

async function evaluate() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log(`========================================`);
  console.log(`RAG EVALUATION: ${modeLabel.toUpperCase()}`);
  console.log(`Connecting to database: ${uri}`);
  console.log(`========================================\n`);
  
  try {
    await mongoose.connect(uri);
    
    // Register DreamSymbol model and fetch all symbols to check database existence
    const DreamSymbol = require('../src/models/DreamSymbol').default;
    const allSymbols = await DreamSymbol.find().lean() as any[];

    for (const dream of testDreams) {
      console.log(`----------------------------------------`);
      console.log(`Dream ID: ${dream.id}`);
      console.log(`Text Preview: "${dream.text.substring(0, 80)}${dream.text.length > 80 ? '...' : ''}"`);
      
      const result = await retrieveSymbolsHybrid(dream.text);
      console.log(`Extracted Keywords Count: ${result.extractedKeywords.length}`);
      
      if (!isOffline) {
        console.log(`Embedding Dimension: 768`);
        console.log(`Vector Backend: ${result.vectorBackend}`);
      }
      
      console.log(`Top Symbols:`);
      
      const top5 = result.symbols.slice(0, 5);
      if (top5.length === 0) {
        console.log(`  (None matching)`);
      } else {
        top5.forEach((item, index) => {
          const rawScoreText = item.rawSimilarityScore === null ? 'null' : item.rawSimilarityScore.toFixed(4);
          const suppressed = item.suppressedBoostReasons && item.suppressedBoostReasons.length > 0
            ? ` | Suppressed: ${JSON.stringify(item.suppressedBoostReasons)}`
            : '';
          const boosts = item.boostReasons && item.boostReasons.length > 0
            ? ` | Boosts: ${JSON.stringify(item.boostReasons)}`
            : '';
            
          console.log(`  ${index + 1}. Symbol: "${item.symbol}"`);
          console.log(`     Raw Similarity Score: ${rawScoreText}`);
          console.log(`     Adjusted Score: ${item.adjustedScore.toFixed(4)}`);
          console.log(`     Retrieval Methods: ${JSON.stringify(item.retrievalMethods)}${boosts}${suppressed}`);
        });
      }

      // Compute expected symbols diagnostics
      console.log(`\nmissingExpectedSymbols:`);
      const normalizedDreamText = dream.text.toLowerCase();
      const cleanText = normalizedDreamText
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const tokens = cleanText.split(' ').filter((t) => t.length > 0);
      const tokensSet = new Set(tokens);
      const ngramSet = new Set<string>();
      for (let i = 0; i < tokens.length; i++) {
        if (i < tokens.length - 1) {
          ngramSet.add(`${tokens[i]} ${tokens[i + 1]}`);
        }
        if (i < tokens.length - 2) {
          ngramSet.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
        }
      }

      const isEnglish = isLikelyEnglish(dream.text);
      const noisePhrases = ['woke up', 'wake up', 'slept on my back', 'sleep on my back', 'on my back', 'very hot', 'hot room'];

      for (const exp of dream.expected) {
        const expLower = exp.toLowerCase().trim();
        const expCanonical = canonicalAliasMap[expLower] || exp;
        const expCanonicalLower = expCanonical.toLowerCase().trim();

        const dbSymbol = allSymbols.find(s => {
          const dbSymLower = s.symbol.toLowerCase().trim();
          const dbCanon = (canonicalAliasMap[dbSymLower] || s.symbol).toLowerCase().trim();
          return dbSymLower === expLower || dbSymLower === expCanonicalLower || dbCanon === expCanonicalLower;
        });
        const existsInDatabase = !!dbSymbol;

        let matchedByExact = false;
        let matchedByVector = false;
        let finalRank: number | null = null;
        let reasonIfMissing = "";

        const foundIndex = result.symbols.findIndex(s => {
          const symLower = s.symbol.toLowerCase().trim();
          const canonLower = (s.canonicalSymbol || '').toLowerCase().trim();
          const matchesVariant = s.matchedVariants?.some(v => v.toLowerCase().trim() === expLower);
          return symLower === expLower || symLower === expCanonicalLower || canonLower === expCanonicalLower || matchesVariant;
        });
        if (foundIndex !== -1) {
          finalRank = foundIndex + 1;
          const matchedItem = result.symbols[foundIndex];
          matchedByExact = matchedItem.retrievalMethods.includes('exact_match');
          matchedByVector = matchedItem.retrievalMethods.includes('full_text_vector') || matchedItem.retrievalMethods.includes('phrase_vector');
        } else {
          if (!existsInDatabase) {
            reasonIfMissing = "Not found in database";
            // Search database for related substring matches
            const related = allSymbols
              .filter(s => s.symbol.toLowerCase().trim().includes(expLower) || expLower.includes(s.symbol.toLowerCase().trim()))
              .map(s => s.symbol);
            if (related.length > 0) {
              reasonIfMissing += ` (Related symbols in DB: ${JSON.stringify(related)})`;
            }
          } else {
            // Re-run diagnostic matching logic
            let matchResult = isStrictExactMatch(expLower, tokensSet, ngramSet, isEnglish);
            if (!matchResult.matched && expCanonicalLower !== expLower) {
              matchResult = isStrictExactMatch(expCanonicalLower, tokensSet, ngramSet, isEnglish);
            }
            if (matchResult.matched) {
              matchedByExact = true;
              
              // Check if suppressed
              let noiseCheck = isExclusivelyInNoisePhrases(expLower, normalizedDreamText, noisePhrases);
              if (!noiseCheck.exclusively && expCanonicalLower !== expLower) {
                noiseCheck = isExclusivelyInNoisePhrases(expCanonicalLower, normalizedDreamText, noisePhrases);
              }
              if (noiseCheck.exclusively) {
                reasonIfMissing = `Exact match boost suppressed: matched only in noise phrase "${noiseCheck.matchedNoisePhrase}"`;
              } else if (expLower.length < 3) {
                reasonIfMissing = "Exact match boost suppressed: symbol length is below 3 characters";
              } else {
                reasonIfMissing = "Filtered out: score below minimum threshold or sliced off (outside top 8)";
              }
            } else {
              reasonIfMissing = "No exact match found";
              if (matchResult.reason) {
                reasonIfMissing += ` (${matchResult.reason})`;
              }
            }
          }
        }

        console.log(`  - symbol: "${exp}"`);
        console.log(`    existsInDatabase: ${existsInDatabase}`);
        console.log(`    matchedByExact: ${matchedByExact}`);
        console.log(`    matchedByVector: ${matchedByVector}`);
        console.log(`    finalRank: ${finalRank}`);
        console.log(`    reasonIfMissing: "${reasonIfMissing}"`);
      }
      console.log();
    }
  } catch (err) {
    console.error('Error during RAG evaluation:', err);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

evaluate();

import assert from 'node:assert/strict';
import {
  dreamLexicalOverlap,
  extractDreamSimilarityFeatures,
  scoreDreamSimilarity,
} from './similarDreamRetrieval.service';

const original = 'Tôi quay lại trường cũ, cầm cuốn sổ trắng, bị đuổi và chạy qua cầu tới nhà bà ngoại.';
const paraphrase = 'Trong mơ tôi ở nơi từng đi học, sợ quên điều quan trọng rồi chạy trốn qua một cây cầu để tìm bà.';
const unrelated = 'Tôi bay trên bầu trời xanh và nhìn thấy một lễ hội vui vẻ.';

const originalFeatures = extractDreamSimilarityFeatures(original);
const paraphraseFeatures = extractDreamSimilarityFeatures(paraphrase);
const unrelatedFeatures = extractDreamSimilarityFeatures(unrelated);

assert.ok(originalFeatures.size >= 5);
assert.ok(paraphraseFeatures.size >= 4);
assert.equal(unrelatedFeatures.size, 0);
assert.ok(dreamLexicalOverlap(original, paraphrase) > dreamLexicalOverlap(original, unrelated));
assert.equal(scoreDreamSimilarity({ exact: true, semantic: 0, motifOverlap: 0, lexicalOverlap: 0 }), 1);
assert.ok(scoreDreamSimilarity({ exact: false, semantic: 0.72, motifOverlap: 0.7, lexicalOverlap: 0.25 }) >= 0.65);
assert.ok(scoreDreamSimilarity({ exact: false, semantic: 0.2, motifOverlap: 0, lexicalOverlap: 0 }) < 0.2);

console.log('SIMILAR DREAM RETRIEVAL: 7 PASSED, 0 FAILED');

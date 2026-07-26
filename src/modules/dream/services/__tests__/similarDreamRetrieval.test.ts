import assert from 'node:assert/strict';
import {
  dreamLexicalOverlap,
  scoreDreamSimilarity,
} from '../analysis/retrieval/similarDreamRetrieval.service';

const original = 'Tôi quay lại trường cũ, cầm cuốn sổ trắng rồi chạy qua cầu.';
const related = 'Tôi trở về trường cũ và chạy qua cây cầu với một cuốn sổ.';
const unrelated = 'Tôi bay trên bầu trời và nhìn thấy một lễ hội.';

assert.ok(dreamLexicalOverlap(original, related) > dreamLexicalOverlap(original, unrelated));
assert.equal(scoreDreamSimilarity({ exact: true, semantic: 0, lexicalOverlap: 0 }), 1);
assert.equal(scoreDreamSimilarity({ exact: false, semantic: 0.8, lexicalOverlap: 0.4 }), 0.74);
assert.equal(scoreDreamSimilarity({ exact: false, semantic: -1, lexicalOverlap: 0.25 }), 0.25);

console.log('SIMILAR DREAM RETRIEVAL: 4 PASSED, 0 FAILED');

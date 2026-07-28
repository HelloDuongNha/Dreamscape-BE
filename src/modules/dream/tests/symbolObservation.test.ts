import assert from 'node:assert/strict';
import DreamSymbolObservation from '../models/DreamSymbolObservation';
import { canonicalizeObservedSymbol } from '../services/analysis/retrieval/symbolObservation.service';

assert.equal(canonicalizeObservedSymbol('  Bà Ngoại  '), 'bà ngoại');
assert.equal(canonicalizeObservedSymbol('Cây-cầu'), 'cây cầu');
assert.equal(canonicalizeObservedSymbol('Grandma'), 'grandma');
assert.equal(canonicalizeObservedSymbol('một biểu tượng mới'), 'một biểu tượng mới');

const indexes = DreamSymbolObservation.schema.indexes();
assert.equal(indexes.some((index: [Record<string, number>, Record<string, any>]) =>
  index[0].dreamId === 1 && index[0].symbolKey === 1 && index[1].unique === true), true);
assert.equal(indexes.some((index: [Record<string, number>, Record<string, any>]) =>
  index[0].symbolKey === 1 && index[0].isPublic === 1 && index[0].createdAt === -1), true);

console.log('SYMBOL OBSERVATION: 6 PASSED, 0 FAILED');

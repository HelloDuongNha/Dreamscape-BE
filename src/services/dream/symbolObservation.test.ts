import assert from 'node:assert/strict';
import DreamSymbolObservation from '../../models/DreamSymbolObservation';
import { buildObservedSymbolLookupCandidates, canonicalizeObservedSymbol } from './symbolObservation.service';

assert.equal(canonicalizeObservedSymbol('bà'), 'grandmother');
assert.equal(canonicalizeObservedSymbol('Bà ngoại'), 'grandmother');
assert.equal(canonicalizeObservedSymbol('grandma'), 'grandmother');
assert.equal(canonicalizeObservedSymbol('cuốn sổ'), 'notebook');
assert.equal(canonicalizeObservedSymbol('Cây cầu'), 'bridge');
assert.equal(canonicalizeObservedSymbol('một biểu tượng mới'), 'một biểu tượng mới');
const lookupCandidates = buildObservedSymbolLookupCandidates('Tôi nhìn thấy bà ngoại đứng cạnh một chiếc đồng hồ vỡ.');
assert.equal(lookupCandidates.includes('bà ngoại'), true);
assert.equal(lookupCandidates.includes('chiếc đồng hồ vỡ'), true);

const indexes = DreamSymbolObservation.schema.indexes();
assert.equal(indexes.some((index: [Record<string, number>, Record<string, any>]) =>
  index[0].dreamId === 1 && index[0].symbolKey === 1 && index[1].unique === true), true);
assert.equal(indexes.some((index: [Record<string, number>, Record<string, any>]) =>
  index[0].symbolKey === 1 && index[0].isPublic === 1 && index[0].createdAt === -1), true);

console.log('SYMBOL OBSERVATION: 10 PASSED, 0 FAILED');

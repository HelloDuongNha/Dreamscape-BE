import assert from 'node:assert/strict';
import {
  buildRuleV3EvidenceAnchors,
  verifyRuleV3EvidenceAnchor
} from './ruleV3EvidenceAnchor.service';

const text = 'Lower life satisfaction predicts more threatening events in dreams. The same sentence follows. Lower life satisfaction predicts more threatening events in dreams.';
const anchors = buildRuleV3EvidenceAnchors([{ chunkId: 'chunk-1', text }]);

assert.equal(anchors.length, 3);
assert.equal(new Set(anchors.map(item => item.evidenceId)).size, 3);
for (const anchor of anchors) {
  assert.equal(text.slice(anchor.startOffset, anchor.endOffset), anchor.exactQuote);
  assert.equal(verifyRuleV3EvidenceAnchor(anchor, text), true);
  assert.equal(verifyRuleV3EvidenceAnchor(anchor, `${text} changed`), false);
}

const repeated = anchors.filter(item => item.exactQuote.startsWith('Lower life satisfaction'));
assert.equal(repeated.length, 2);
assert.notEqual(repeated[0].evidenceId, repeated[1].evidenceId);
assert.notEqual(repeated[0].startOffset, repeated[1].startOffset);

const longText = `${'word '.repeat(240)}final.`;
const longAnchors = buildRuleV3EvidenceAnchors([{ chunkId: 'chunk-long', text: longText }]);
assert.ok(longAnchors.length >= 2);
assert.ok(longAnchors.every(item => item.exactQuote.length <= 900));

console.log('RULE V3 EVIDENCE ANCHORS: 16 PASSED, 0 FAILED');

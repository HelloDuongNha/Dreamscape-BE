import assert from 'node:assert/strict';
import { composeDreamNarrative } from '../../controllers/dreamController';

assert.equal(composeDreamNarrative('Nội dung cũ.', []), 'Nội dung cũ.');
assert.equal(
  composeDreamNarrative('Nội dung cũ.', [{ sequence: 1, content: 'Nội dung bổ sung.' }]),
  'Nội dung cũ.\n\nBổ sung:\nNội dung bổ sung.',
);
assert.equal(
  composeDreamNarrative('Nội dung cũ.', [
    { sequence: 2, content: 'Phần hai.' },
    { sequence: 1, content: 'Phần một.' },
  ]),
  'Nội dung cũ.\n\n1. Bổ sung:\nPhần một.\n\n2. Bổ sung:\nPhần hai.',
);

console.log('DREAM NARRATIVE VERSIONING: ALL ASSERTIONS PASSED');

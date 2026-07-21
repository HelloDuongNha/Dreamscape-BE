import assert from 'node:assert/strict';
import { detectFrontMatterAuthors } from './doclingImport.service';
import type { CanonicalBlock } from '../../types/canonical.types';

function block(text: string, blockType: CanonicalBlock['blockType'] = 'paragraph'): CanonicalBlock {
  return { text, blockType, semanticType: blockType === 'heading' ? 'heading' : 'paragraph', html: '', order: 0, sectionHeading: null };
}

assert.deepEqual(
  detectFrontMatterAuthors([
    block('CON NGƯỜI VÀ BIỂU TƯỢNG', 'title'),
    block('CARL GUSTAV JUNG', 'heading'),
    block('chủ biên'),
  ]),
  ['Carl Gustav Jung'],
);

assert.equal(
  detectFrontMatterAuthors([
    block('1. TIẾP CẬN VÔ THỨC', 'heading'),
    block('Biểu tượng trong giấc mơ'),
  ]),
  undefined,
  'chapter headings must not be guessed as authors',
);

console.log('DOCLING METADATA HINTS: 2 PASSED, 0 FAILED');

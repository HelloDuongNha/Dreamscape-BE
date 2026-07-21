import assert from 'node:assert/strict';
import { DoclingReaderPolicyService } from './doclingReaderPolicy.service';
import type { DoclingItem } from '../../types/docling.types';

const items: DoclingItem[] = [
  { id: 'title', type: 'title', text: 'Freud’s Dream Interpretation', pageNumber: 1 },
  { id: 'authors', type: 'paragraph', text: 'Wei Zhang and Benyu Guo*', pageNumber: 1 },
  { id: 'affiliation', type: 'paragraph', text: 'Research Institute of Moral Education, Nanjing Normal University, Nanjing, China', pageNumber: 1 },
  { id: 'abstract', type: 'heading', text: 'ABSTRACT', pageNumber: 1 },
  { id: 'abstract-body', type: 'paragraph', text: 'Dream theory is discussed in this article.', pageNumber: 1 },
  { id: 'references', type: 'heading', text: 'REFERENCES', pageNumber: 8 },
  { id: 'ref-1', type: 'reference', text: 'Freud, S. (1900). The Interpretation of Dreams.', pageNumber: 8 },
  { id: 'conclusion', type: 'heading', text: 'CONCLUSION', pageNumber: 8 },
  { id: 'conclusion-body', type: 'paragraph', text: 'The theory offers a distinct framework.', pageNumber: 8 },
];

const ordered = DoclingReaderPolicyService.orderItemsForReader(items);
const captions = new Map<string, string>();
const evaluate = (id: string) => {
  const item = ordered.find(candidate => candidate.id === id)!;
  return DoclingReaderPolicyService.evaluateItem(item, captions, ordered);
};

assert.equal(evaluate('authors').isExcluded, true, 'author line must be metadata');
assert.equal(evaluate('affiliation').isExcluded, true, 'affiliation must be metadata');
assert.equal(evaluate('abstract-body').isExcluded, false, 'abstract body must remain');
assert.equal(evaluate('conclusion').isExcluded, false, 'conclusion heading must remain');
assert.equal(evaluate('conclusion-body').isExcluded, false, 'conclusion prose must remain');

console.log('DOCLING READER POLICY: 5 PASSED, 0 FAILED');

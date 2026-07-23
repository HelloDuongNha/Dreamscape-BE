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
  { id: 'conflict', type: 'reference', text: 'Conflict of Interest Statement: The author declares no commercial relationships.', pageNumber: 8 },
  { id: 'received', type: 'reference', text: 'Received: 12 February 2013; accepted: 17 June 2013; published online: 16 July 2013.', pageNumber: 8 },
  { id: 'citation', type: 'reference', text: 'Citation: Kahn D (2013) Brain basis of self.', pageNumber: 8 },
  { id: 'submitted', type: 'reference', text: 'This article was submitted to Frontiers in Consciousness Research.', pageNumber: 8 },
  { id: 'conclusion', type: 'heading', text: 'CONCLUSION', pageNumber: 8 },
  { id: 'conclusion-body', type: 'paragraph', text: 'The theory offers a distinct framework.', pageNumber: 8 },
  { id: 'references-2', type: 'heading', text: 'REFERENCES', pageNumber: 9 },
  { id: 'separator', type: 'reference', text: '-', pageNumber: 9 },
  { id: 'ref-2', type: 'reference', text: 'Yates, E. F. (1987). Self-Organizing Systems.', pageNumber: 9 },
  { id: 'body-fragment', type: 'reference', text: 'repertoire of experience results in an expansion of the self beyond that obtainable when awake.', pageNumber: 9 },
  { id: 'limitations', type: 'reference', text: 'LIMITATIONS OF THE MODEL', pageNumber: 9 },
  { id: 'limitations-body', type: 'reference', text: 'One major shortcoming of the hypothesis is the difficulty of proving it.', pageNumber: 9 },
  { id: 'references-3', type: 'heading', text: 'REFERENCES', pageNumber: 10 },
  { id: 'broken-journal', type: 'reference', text: 'Sleep Medicine Reviews, 11', pageNumber: 10 },
  { id: 'orphan-glyph', type: 'reference', text: "'", pageNumber: 10 },
  { id: 'broken-page-start', type: 'reference', text: ', 295', pageNumber: 10 },
  { id: 'broken-title', type: 'reference', text: 'dreams under Covid-19 isolation.', pageNumber: 10 },
  { id: 'next-author', type: 'reference', text: 'V. Loukola et al. (2021). Another study.', pageNumber: 10 },
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
assert.equal(evaluate('conflict').isExcluded, true, 'conflict statement after references must be metadata');
assert.equal(evaluate('received').isExcluded, true, 'article history after references must be metadata');
assert.equal(evaluate('citation').isExcluded, true, 'article citation after references must be metadata');
assert.equal(evaluate('submitted').isExcluded, true, 'submission boilerplate after references must be metadata');
assert.equal(ordered.some(item => item.id === 'separator'), false, 'decorative reference separator must be excluded');
assert.equal(ordered.find(item => item.id === 'ref-2')?.type, 'reference', 'separator must not close the references section');
assert.equal(ordered.find(item => item.id === 'limitations')?.type, 'heading', 'unlabelled limitations heading must close references');
assert.equal(ordered.find(item => item.id === 'limitations-body')?.type, 'paragraph', 'body after limitations must be recovered');
assert.equal(evaluate('limitations').isExcluded, false, 'limitations heading must remain readable');
assert.equal(evaluate('limitations-body').isExcluded, false, 'limitations prose must remain readable');
assert.equal(ordered.find(item => item.id === 'body-fragment')?.type, 'paragraph', 'lowercase body prose must not become a citation');
assert.equal(ordered.some(item => item.id === 'orphan-glyph'), false, 'isolated extraction glyph must not become a reader line');
assert.equal(
  ordered.find(item => item.id === 'broken-journal')?.text,
  'Sleep Medicine Reviews, 11, 295 dreams under Covid-19 isolation.',
  'punctuation and lowercase reference fragments must rejoin the preceding citation',
);
assert.equal(ordered.find(item => item.id === 'next-author')?.text, 'V. Loukola et al. (2021). Another study.', 'next author entry must remain separate');

console.log('DOCLING READER POLICY: 19 PASSED, 0 FAILED');

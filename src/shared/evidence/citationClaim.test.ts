import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvidenceClaimId,
  invalidateEvidenceClaims,
  renderEvidenceClaimMarker,
  resolveEvidenceClaim,
  type EvidenceClaimBinding,
} from './citationClaim';

const unresolvedClaim: EvidenceClaimBinding = {
  claimId: createEvidenceClaimId(
    'core_analysis',
    'Dream content may combine past memories with anticipated future events.',
  ),
  claimText: 'Dream content may combine past memories with anticipated future events.',
  contentPath: 'core_analysis',
  status: 'unresolved',
};

test('an unresolved claim receives a marker beside that exact claim', () => {
  const text = [
    'This is a personal reflection without academic scope.',
    unresolvedClaim.claimText,
    'A separate sentence remains unchanged.',
  ].join(' ');

  assert.equal(
    renderEvidenceClaimMarker(text, unresolvedClaim),
    'This is a personal reflection without academic scope. '
      + 'Dream content may combine past memories with anticipated future events [?]. '
      + 'A separate sentence remains unchanged.',
  );
});

test('a resolved claim reuses one citation number for the same source', () => {
  const resolved = resolveEvidenceClaim(unresolvedClaim, {
    source: { sourceId: 'source-new', doi: 'https://doi.org/10.1000/dreams' },
    ruleId: 'rule-2',
    evidenceId: 'evidence-2',
    verificationKey: 'rule-2:evidence-2:dream',
  }, [{
    index: 4,
    source: { sourceId: 'source-old', doi: '10.1000/dreams' },
  }]);

  assert.equal(resolved.citationIndex, 4);
  assert.equal(
    renderEvidenceClaimMarker(`${unresolvedClaim.claimText} [?]`, resolved),
    'Dream content may combine past memories with anticipated future events [4].',
  );
});

test('a newly supplemented source receives the highest next citation number', () => {
  const resolved = resolveEvidenceClaim(unresolvedClaim, {
    source: { sourceId: 'source-3' },
    ruleId: 'rule-3',
    evidenceId: 'evidence-3',
    verificationKey: 'rule-3:evidence-3:dream',
  }, [
    { index: 1, source: { sourceId: 'source-1' } },
    { index: 4, source: { sourceId: 'source-2' } },
  ]);

  assert.equal(resolved.citationIndex, 5);
});

test('source deletion reopens its claim and clears stale question identity', () => {
  const resolved = resolveEvidenceClaim(unresolvedClaim, {
    source: { sourceId: 'approved-source', doi: '10.1000/dreams' },
    ruleId: 'rule-4',
    evidenceId: 'evidence-4',
    verificationKey: 'rule-4:evidence-4:dream',
  }, []);
  const [invalidated] = invalidateEvidenceClaims(
    [resolved],
    [{ sourceId: 'replacement-id', doi: 'https://doi.org/10.1000/dreams' }],
  );

  assert.deepEqual(invalidated, {
    claimId: unresolvedClaim.claimId,
    claimText: unresolvedClaim.claimText,
    contentPath: unresolvedClaim.contentPath,
    status: 'unresolved',
  });
  assert.equal(
    renderEvidenceClaimMarker(`${unresolvedClaim.claimText} [1].`, invalidated),
    'Dream content may combine past memories with anticipated future events [?].',
  );
});

test('deleting one source never changes claims backed by another source', () => {
  const first = {
    ...unresolvedClaim,
    status: 'resolved' as const,
    source: { sourceId: 'source-1' },
    citationIndex: 1,
  };
  const second = {
    ...unresolvedClaim,
    claimId: 'second-claim',
    claimText: 'A second supported claim.',
    source: { sourceId: 'source-2' },
    status: 'resolved' as const,
    citationIndex: 2,
  };

  const result = invalidateEvidenceClaims([first, second], [{ sourceId: 'source-1' }]);

  assert.equal(result[0].status, 'unresolved');
  assert.deepEqual(result[1], second);
});

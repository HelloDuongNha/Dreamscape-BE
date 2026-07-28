import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectDreamEvidenceClaims,
} from '../../services/evidence/oracleEvidenceCapture.service';
import type { EvidenceClaimBinding } from '../../../../shared/evidence/citationClaim';

test('Dream Evidence Needed reads every unresolved claim from the persisted ledger', () => {
  const bindings: EvidenceClaimBinding[] = Array.from({ length: 6 }, (_, index) => ({
    claimId: `claim-${index}`,
    claimText: `Dream content may combine waking memory fragment ${index} with an anticipated future event.`,
    contentPath: 'core_analysis',
    status: 'unresolved',
  }));

  const claims = collectDreamEvidenceClaims(bindings, 'Fallback claim [?].');

  assert.equal(claims.length, 6);
  assert.match(claims[5], /future event/u);
});

test('resolved Dream claims are not recreated as Evidence Needed', () => {
  const bindings: EvidenceClaimBinding[] = [{
    claimId: 'resolved',
    claimText: 'Dream content may recombine past memories with anticipated future events.',
    contentPath: 'core_analysis',
    status: 'resolved',
    source: { sourceId: 'source-1' },
    citationIndex: 1,
    ruleId: 'rule-1',
    evidenceId: 'evidence-1',
    verificationKey: 'verification-1',
  }];

  assert.deepEqual(collectDreamEvidenceClaims(bindings, 'No unresolved marker.'), []);
});

test('the persisted Dream ledger takes precedence over matching legacy markers', () => {
  const bindings: EvidenceClaimBinding[] = [{
    claimId: 'unresolved',
    claimText: 'Dream content may recombine past memories with anticipated future events.',
    contentPath: 'core_analysis',
    status: 'unresolved',
  }];

  const claims = collectDreamEvidenceClaims(
    bindings,
    'Dream content may recombine past memories with anticipated future events [?].',
  );

  assert.deepEqual(claims, [
    'Dream content may recombine past memories with anticipated future events.',
  ]);
});

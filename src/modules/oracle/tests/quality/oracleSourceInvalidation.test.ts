import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvidenceClaimId,
  type EvidenceClaimBinding,
} from '../../../../shared/evidence/citationClaim';
import {
  invalidateDreamAnalysis,
  invalidateDreamRecordCitationState,
  type OracleSourceInvalidationPlan,
} from '../../services/lifecycle/oracleSourceInvalidation.service';
import {
  filterDreamFeedbackAfterSourceInvalidation,
} from '../../services/lifecycle/oracleDreamFeedbackInvalidation.service';
import {
  selectRulesLosingAllSupport,
} from '../../services/lifecycle/oracleSourceInvalidationPlan.service';
import {
  collectDreamEvidenceClaims,
} from '../../services/evidence/oracleEvidenceCapture.service';

test('source deletion reopens only its Dream claims and removes its question', () => {
  const firstClaim = 'Dream content may recombine past memories with anticipated future events.';
  const secondClaim = 'Future-oriented dreams may become more common later in the sleep period.';
  const bindings: EvidenceClaimBinding[] = [
    {
      claimId: createEvidenceClaimId('core_analysis', firstClaim),
      claimText: firstClaim,
      contentPath: 'core_analysis',
      status: 'resolved',
      source: { sourceId: 'source-1', doi: '10.1000/one' },
      ruleId: 'rule-1',
      evidenceId: 'evidence-1',
      citationIndex: 1,
      verificationKey: 'rule-1:evidence-1:dream',
    },
    {
      claimId: createEvidenceClaimId('core_analysis', secondClaim),
      claimText: secondClaim,
      contentPath: 'core_analysis',
      status: 'resolved',
      source: { sourceId: 'source-2', doi: '10.1000/two' },
      ruleId: 'rule-2',
      evidenceId: 'evidence-2',
      citationIndex: 2,
      verificationKey: 'rule-2:evidence-2:dream',
    },
  ];
  const analysis: any = {
    core_analysis: `${firstClaim.slice(0, -1)} [1]. ${secondClaim.slice(0, -1)} [2].`,
    summary: '',
    interpretive_threads: [],
    claim_bindings: bindings,
    citations: [
      { index: 1, sourceId: 'source-1', doi: '10.1000/one' },
      { index: 2, sourceId: 'source-2', doi: '10.1000/two' },
    ],
    scientific_context_notes: [
      {
        ruleId: 'rule-1',
        sources: [{ sourceId: 'source-1', doi: '10.1000/one' }],
        evidenceQuotes: [{ sourceId: 'source-1', quote: firstClaim }],
      },
      {
        ruleId: 'rule-2',
        sources: [{ sourceId: 'source-2', doi: '10.1000/two' }],
        evidenceQuotes: [{ sourceId: 'source-2', quote: secondClaim }],
      },
    ],
    real_life_hypotheses: [
      {
        ruleId: 'rule-1',
        verificationKey: 'rule-1:evidence-1:dream',
        validationSourceId: 'source-1',
        sources: [{ sourceId: 'source-1' }],
        userFeedback: 'yes',
      },
      {
        ruleId: 'rule-2',
        verificationKey: 'rule-2:evidence-2:dream',
        validationSourceId: 'source-2',
        sources: [{ sourceId: 'source-2' }],
        userFeedback: 'no',
      },
    ],
  };

  invalidateDreamAnalysis(
    analysis,
    [1],
    new Set(['rule-1']),
    invalidationPlan('source-1', '10.1000/one'),
  );

  assert.equal(
    analysis.core_analysis,
    `${firstClaim.slice(0, -1)} [?]. ${secondClaim.slice(0, -1)} [2].`,
  );
  assert.deepEqual(analysis.citations.map((item: any) => item.index), [2]);
  assert.deepEqual(analysis.real_life_hypotheses.map((item: any) => item.ruleId), ['rule-2']);
  assert.equal(analysis.claim_bindings[0].status, 'unresolved');
  assert.equal(analysis.claim_bindings[0].verificationKey, undefined);
  assert.equal(analysis.claim_bindings[1].citationIndex, 2);
  const reopenedClaims = collectDreamEvidenceClaims(
    analysis.claim_bindings,
    analysis.core_analysis,
  );
  assert.equal(reopenedClaims.length, 1);
  assert.match(reopenedClaims[0], /past memories|future concerns/iu);
});

test('legacy Dream text is reopened in place without appending a fabricated claim', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events';
  const analysis: any = {
    core_analysis: `${claim} [1]. A personal reflection.`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
  };

  invalidateDreamAnalysis(
    analysis,
    [1],
    new Set(),
    invalidationPlan('source-1', '10.1000/one'),
  );

  assert.equal(
    analysis.core_analysis,
    `${claim} [?]. A personal reflection.`,
  );
  assert.doesNotMatch(analysis.core_analysis, /\n\n/u);
});

test('source deletion also reopens an unbound legacy marker in a partially migrated analysis', () => {
  const boundClaim = 'Dream content may recombine past memories with anticipated future events.';
  const legacyClaim = 'Future-oriented dreams may become more common later in sleep.';
  const analysis: any = {
    core_analysis: `${boundClaim.slice(0, -1)} [1].`,
    summary: `${legacyClaim.slice(0, -1)} [1].`,
    interpretive_threads: [],
    claim_bindings: [{
      claimId: createEvidenceClaimId('core_analysis', boundClaim),
      claimText: boundClaim,
      contentPath: 'core_analysis',
      status: 'resolved',
      source: { sourceId: 'source-1' },
      ruleId: 'rule-1',
      evidenceId: 'evidence-1',
      citationIndex: 1,
      verificationKey: 'question-1',
    }],
    citations: [{ index: 1, sourceId: 'source-1' }],
    scientific_context_notes: [],
    real_life_hypotheses: [],
  };

  invalidateDreamAnalysis(
    analysis,
    [1],
    new Set(['rule-1']),
    invalidationPlan('source-1', '10.1000/one'),
  );

  assert.equal(analysis.core_analysis, `${boundClaim.slice(0, -1)} [?].`);
  assert.equal(analysis.summary, `${legacyClaim.slice(0, -1)} [?].`);
});

test('source deletion also reopens citations inside stored Dream versions', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const historicalAnalysis: any = {
    core_analysis: `${claim.slice(0, -1)} [1].`,
    summary: '',
    interpretive_threads: [],
    claim_bindings: [{
      claimId: createEvidenceClaimId('core_analysis', claim),
      claimText: claim,
      contentPath: 'core_analysis',
      status: 'resolved',
      source: { sourceId: 'source-1' },
      ruleId: 'rule-1',
      evidenceId: 'evidence-1',
      citationIndex: 1,
      verificationKey: 'historical-question',
    }],
    citations: [{ index: 1, sourceId: 'source-1' }],
    scientific_context_notes: [{
      ruleId: 'rule-1',
      sources: [{ sourceId: 'source-1' }],
      evidenceQuotes: [{ sourceId: 'source-1', quote: claim }],
    }],
    real_life_hypotheses: [{
      ruleId: 'rule-1',
      validationSourceId: 'source-1',
      verificationKey: 'historical-question',
      sources: [{ sourceId: 'source-1' }],
      userFeedback: 'yes',
    }],
  };
  const dream: any = {
    ai_result: null,
    edit_history: [{
      ai_result: historicalAnalysis,
      realLifeHypothesesFeedback: [{
        ruleId: 'rule-1',
        verificationKey: 'historical-question',
        answer: 'yes',
      }],
      retrievedContext: {
        componentD: {
          appliedRules: [{ ruleId: 'rule-1' }],
          evidenceLinks: [{ ruleId: 'rule-1', sourceId: 'source-1' }],
        },
      },
    }],
    markModified() {},
  };

  const result = invalidateDreamRecordCitationState(
    dream,
    {
      ...invalidationPlan('source-1', '10.1000/one'),
      ruleIds: ['rule-1'],
    },
  );

  assert.equal(result.changed, true);
  assert.equal(historicalAnalysis.core_analysis, `${claim.slice(0, -1)} [?].`);
  assert.deepEqual(historicalAnalysis.citations, []);
  assert.deepEqual(historicalAnalysis.real_life_hypotheses, []);
  assert.deepEqual(dream.edit_history[0].realLifeHypothesesFeedback, []);
  assert.deepEqual(
    dream.edit_history[0].retrievedContext.componentD,
    { appliedRules: [], evidenceLinks: [] },
  );
  assert.deepEqual([...result.invalidVerificationKeys], ['historical-question']);
});

test('deleting one source preserves the same rule when another source still supports it', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const analysis: any = {
    core_analysis: `${claim.slice(0, -1)} [1].`,
    summary: '',
    interpretive_threads: [],
    claim_bindings: [{
      claimId: createEvidenceClaimId('core_analysis', claim),
      claimText: claim,
      contentPath: 'core_analysis',
      status: 'resolved',
      source: { sourceId: 'source-2' },
      ruleId: 'rule-1',
      evidenceId: 'evidence-2',
      citationIndex: 1,
      verificationKey: 'kept-question',
    }],
    citations: [{ index: 1, sourceId: 'source-2' }],
    scientific_context_notes: [{
      ruleId: 'rule-1',
      sources: [{ sourceId: 'source-1' }, { sourceId: 'source-2' }],
      evidenceQuotes: [
        { sourceId: 'source-1', quote: 'First quote.' },
        { sourceId: 'source-2', quote: 'Second quote.' },
      ],
    }],
    real_life_hypotheses: [{
      ruleId: 'rule-1',
      validationSourceId: 'source-2',
      verificationKey: 'kept-question',
      sources: [{ sourceId: 'source-2' }],
      userFeedback: 'yes',
    }],
  };
  const dream: any = {
    ai_result: analysis,
    edit_history: [],
    retrievedContext: {
      componentD: {
        appliedRules: [{ ruleId: 'rule-1' }],
        evidenceLinks: [
          { ruleId: 'rule-1', sourceId: 'source-1' },
          { ruleId: 'rule-1', sourceId: 'source-2' },
        ],
      },
    },
    markModified() {},
  };

  invalidateDreamRecordCitationState(
    dream,
    {
      ...invalidationPlan('source-1', '10.1000/one'),
      ruleIds: ['rule-1'],
    },
  );

  assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [1].`);
  assert.deepEqual(analysis.scientific_context_notes[0].sources, [{ sourceId: 'source-2' }]);
  assert.equal(analysis.real_life_hypotheses[0].verificationKey, 'kept-question');
  assert.deepEqual(dream.retrievedContext.componentD.appliedRules, [{ ruleId: 'rule-1' }]);
  assert.deepEqual(
    dream.retrievedContext.componentD.evidenceLinks,
    [{ ruleId: 'rule-1', sourceId: 'source-2' }],
  );
});

test('source deletion preserves feedback belonging to another source for the same rule', () => {
  const feedback = filterDreamFeedbackAfterSourceInvalidation(
    [
      { ruleId: 'rule-1', verificationKey: 'removed-question', answer: 'yes' },
      { ruleId: 'rule-1', verificationKey: 'kept-question', answer: 'no' },
      { ruleId: 'rule-1', answer: 'yes' },
    ],
    new Set(['removed-question']),
    {
      ...invalidationPlan('source-1', '10.1000/one'),
      ruleIds: ['rule-1'],
    },
  );

  assert.deepEqual(feedback, [
    { ruleId: 'rule-1', verificationKey: 'kept-question', answer: 'no' },
  ]);
});

test('a rule stays resolved while another academic source still supports it', () => {
  assert.deepEqual(
    selectRulesLosingAllSupport(
      ['rule-1', 'rule-2'],
      [{ ruleId: 'rule-1' }],
    ),
    ['rule-2'],
  );
});

function invalidationPlan(sourceId: string, doi: string): OracleSourceInvalidationPlan {
  return {
    sourceIds: [sourceId],
    sourceDois: [doi],
    turnIds: [],
    dreamIds: [],
    ruleIds: [],
    quoteHashes: [],
    feedbackRuleIds: [],
  };
}

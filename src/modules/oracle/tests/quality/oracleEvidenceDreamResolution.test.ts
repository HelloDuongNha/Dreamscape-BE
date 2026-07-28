import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEvidenceClaimId,
  type EvidenceClaimBinding,
} from '../../../../shared/evidence/citationClaim';
import {
  resolveDreamAnalysisCitation,
  resolveDreamRecordCitationState,
} from '../../services/evidence/oracleEvidenceDreamResolution.service';
import {
  invalidateDreamAnalysis,
  invalidateDreamRecordCitationState,
  type OracleSourceInvalidationPlan,
} from '../../services/lifecycle/oracleSourceInvalidation.service';
import {
  enrichScientificNotesForResponse,
} from '../../../dream/services/analysis/grounding/dreamAnalysisGrounding.service';

function unresolvedBinding(claimText: string): EvidenceClaimBinding {
  return {
    claimId: createEvidenceClaimId('core_analysis', claimText),
    claimText,
    contentPath: 'core_analysis',
    status: 'unresolved',
  };
}

function support(sourceId: string, evidenceId: string, quote: string) {
  return {
    source: {
      _id: sourceId,
      title: `Source ${sourceId}`,
      year: 2022,
      doi: `10.1000/${sourceId}`,
    },
    evidence: {
      _id: evidenceId,
      chunkId: `${evidenceId}-chunk`,
      exactQuote: quote,
    },
  } as any;
}

test('resolving a Dream claim adds its citation and one source question', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const analysis: any = {
    core_analysis: `${claim.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    claim_bindings: [unresolvedBinding(claim)],
    citations: [],
  };

  const changed = resolveDreamAnalysisCitation(
    analysis,
    [claim],
    { _id: 'rule-1', statement: claim } as any,
    support('source-1', 'evidence-1', claim),
  );

  assert.equal(changed, true);
  assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [1].`);
  assert.equal(analysis.citations.length, 1);
  assert.equal(analysis.real_life_hypotheses.length, 1);
  assert.equal(analysis.real_life_hypotheses[0].validationSourceId, 'source-1');
  assert.equal(analysis.real_life_hypotheses[0].userFeedback, null);
});

test('one source keeps one citation and one question across multiple claims', () => {
  const first = 'Dream content may recombine past memories with anticipated future events.';
  const second = 'Future-oriented dreams may become more common later in the sleep period.';
  const analysis: any = {
    core_analysis: `${first.slice(0, -1)} [?]. ${second.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    claim_bindings: [unresolvedBinding(first), unresolvedBinding(second)],
    citations: [],
  };

  resolveDreamAnalysisCitation(
    analysis,
    [first],
    { _id: 'rule-1', statement: first } as any,
    support('source-1', 'evidence-1', first),
  );
  resolveDreamAnalysisCitation(
    analysis,
    [second],
    { _id: 'rule-2', statement: second } as any,
    support('source-1', 'evidence-2', second),
  );

  assert.equal(analysis.citations.length, 1);
  assert.equal(analysis.real_life_hypotheses.length, 1);
  assert.deepEqual(
    analysis.claim_bindings.map((binding: EvidenceClaimBinding) => binding.citationIndex),
    [1, 1],
  );
});

test('a second source appends a new citation and a second question', () => {
  const first = 'Dream content may recombine past memories with anticipated future events.';
  const second = 'Future-oriented dreams may become more common later in the sleep period.';
  const analysis: any = {
    core_analysis: `${first.slice(0, -1)} [?]. ${second.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    claim_bindings: [unresolvedBinding(first), unresolvedBinding(second)],
    citations: [],
  };

  resolveDreamAnalysisCitation(
    analysis,
    [first],
    { _id: 'rule-1', statement: first } as any,
    support('source-1', 'evidence-1', first),
  );
  resolveDreamAnalysisCitation(
    analysis,
    [second],
    { _id: 'rule-2', statement: second } as any,
    support('source-2', 'evidence-2', second),
  );

  assert.deepEqual(analysis.citations.map((citation: any) => citation.index), [1, 2]);
  assert.equal(analysis.real_life_hypotheses.length, 2);
  assert.deepEqual(
    analysis.real_life_hypotheses.map((item: any) => item.validationSourceId),
    ['source-1', 'source-2'],
  );
});

test('a deleted source reopens its claim and a replacement source starts with fresh feedback', () => {
  const first = 'Dream content may recombine past memories with anticipated future events.';
  const second = 'Future-oriented dreams may become more common later in the sleep period.';
  const analysis: any = {
    core_analysis: `${first.slice(0, -1)} [?]. ${second.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    claim_bindings: [unresolvedBinding(first), unresolvedBinding(second)],
    citations: [],
  };

  resolveDreamAnalysisCitation(
    analysis,
    [first],
    { _id: 'rule-1', statement: first } as any,
    support('source-1', 'evidence-1', first),
  );
  resolveDreamAnalysisCitation(
    analysis,
    [second],
    { _id: 'rule-2', statement: second } as any,
    support('source-2', 'evidence-2', second),
  );
  analysis.real_life_hypotheses[0].userFeedback = 'yes';
  analysis.real_life_hypotheses[1].userFeedback = 'no';

  invalidateDreamAnalysis(
    analysis,
    [1],
    new Set(['rule-1']),
    invalidationPlan('source-1', '10.1000/source-1'),
  );
  resolveDreamAnalysisCitation(
    analysis,
    [first],
    { _id: 'rule-3', statement: first } as any,
    support('source-3', 'evidence-3', first),
  );

  assert.equal(
    analysis.core_analysis,
    `${first.slice(0, -1)} [3]. ${second.slice(0, -1)} [2].`,
  );
  assert.deepEqual(analysis.citations.map((item: any) => item.index), [2, 3]);
  assert.deepEqual(
    analysis.real_life_hypotheses.map((item: any) => ({
      sourceId: item.validationSourceId,
      feedback: item.userFeedback,
    })),
    [
      { sourceId: 'source-2', feedback: 'no' },
      { sourceId: 'source-3', feedback: null },
    ],
  );
});

test('a replacement source resolves the current Dream and every stored version', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const current = unresolvedAnalysis(claim);
  const historical = unresolvedAnalysis(claim);
  const legacyMirror = unresolvedAnalysis(claim);
  const modified = new Set<string>();
  const dream: any = {
    ai_result: current,
    aiAnalysis: legacyMirror,
    edit_history: [{ ai_result: historical }],
    markModified(path: string) {
      modified.add(path);
    },
  };

  const changed = resolveDreamRecordCitationState(
    dream,
    [claim],
    { _id: 'rule-1', statement: claim } as any,
    support('source-1', 'evidence-1', claim),
  );

  assert.equal(changed, true);
  for (const analysis of [current, historical, legacyMirror]) {
    assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [1].`);
    assert.equal(analysis.citations.length, 1);
    assert.equal(analysis.real_life_hypotheses.length, 1);
    assert.equal(analysis.real_life_hypotheses[0].userFeedback, null);
  }
  assert.deepEqual(
    [...modified].sort(),
    ['aiAnalysis', 'ai_result', 'edit_history', 'retrievedContext'],
  );
});

test('a rematched Dream question survives the public response projection', () => {
  const claim = 'Future-oriented dreams may become more common later in the sleep period.';
  const analysis = unresolvedAnalysis(claim);
  const dream: any = {
    ai_result: analysis,
    retrievedContext: {
      componentA: {},
      componentC: {},
      componentD: { appliedRules: [], evidenceLinks: [] },
    },
    edit_history: [],
    markModified() {},
  };
  const rule = {
    _id: 'rule-1',
    ruleCode: 'KR3_TEST',
    statement: claim,
    subject: 'Future-oriented dreams',
    outcome: 'Future events may appear more often later in sleep',
    conditions: ['anticipated future events'],
    evidenceScore: 42,
    supportingSourceCount: 1,
  } as any;

  assert.equal(
    resolveDreamRecordCitationState(
      dream,
      [claim],
      rule,
      support('source-1', 'evidence-1', claim),
    ),
    true,
  );

  const rendered = enrichScientificNotesForResponse(
    dream.ai_result,
    dream.retrievedContext,
    'Gần sáng, tôi mơ về một sự kiện ngày mai.',
  );

  assert.equal(rendered.real_life_hypotheses.length, 1);
  assert.equal(rendered.real_life_hypotheses[0].validationSourceId, 'source-1');
  assert.equal(rendered.real_life_hypotheses[0].userFeedback, null);
  assert.equal(rendered.citations[0].sourceId, 'source-1');
  assert.match(rendered.core_analysis, /\[1\]/u);
});

test('Dream citations complete one unresolved, resolved, deleted and rematched lifecycle', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const current = unresolvedAnalysis(claim);
  const historical = unresolvedAnalysis(claim);
  const dream: any = {
    ai_result: current,
    edit_history: [{ ai_result: historical }],
    retrievedContext: { componentD: { appliedRules: [], evidenceLinks: [] } },
    markModified() {},
  };

  assert.equal(current.core_analysis, `${claim.slice(0, -1)} [?].`);
  assert.equal(current.real_life_hypotheses.length, 0);

  resolveDreamRecordCitationState(
    dream,
    [claim],
    {
      _id: 'rule-1',
      statement: claim,
      conditions: ['anticipated future events'],
    } as any,
    support('source-1', 'evidence-1', claim),
  );
  current.real_life_hypotheses[0].userFeedback = 'yes';
  historical.real_life_hypotheses[0].userFeedback = 'yes';
  assert.equal(dream.retrievedContext.componentD.appliedRules.length, 1);
  assert.equal(dream.retrievedContext.componentD.evidenceLinks.length, 1);

  const invalidated = invalidateDreamRecordCitationState(
    dream,
    {
      ...invalidationPlan('source-1', '10.1000/source-1'),
      ruleIds: ['rule-1'],
    },
  );

  assert.equal(invalidated.changed, true);
  assert.equal(invalidated.invalidVerificationKeys.size, 1);
  assert.match(
    [...invalidated.invalidVerificationKeys][0],
    /^rule-1:evidence-1:dream-citation-v\d+$/u,
  );
  for (const analysis of [current, historical]) {
    assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [?].`);
    assert.deepEqual(analysis.citations, []);
    assert.deepEqual(analysis.real_life_hypotheses, []);
    assert.equal(analysis.claim_bindings[0].status, 'unresolved');
  }
  assert.deepEqual(
    dream.retrievedContext.componentD,
    { appliedRules: [], evidenceLinks: [] },
  );

  resolveDreamRecordCitationState(
    dream,
    [claim],
    {
      _id: 'rule-2',
      statement: claim,
      conditions: ['anticipated future events'],
    } as any,
    support('source-2', 'evidence-2', claim),
  );
  for (const analysis of [current, historical]) {
    assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [1].`);
    assert.equal(analysis.real_life_hypotheses.length, 1);
    assert.equal(analysis.real_life_hypotheses[0].validationSourceId, 'source-2');
    assert.equal(analysis.real_life_hypotheses[0].userFeedback, null);
  }
  const rendered = enrichScientificNotesForResponse(
    current,
    dream.retrievedContext,
    'Tôi mơ về một sự kiện tương lai đang chờ đợi.',
  );
  assert.equal(rendered.real_life_hypotheses.length, 1);
  assert.equal(rendered.real_life_hypotheses[0].userFeedback, null);
  assert.match(rendered.core_analysis, /\[1\]/u);
});

test('legacy Dream prose without a ledger can be resolved without duplicating data', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const analysis: any = {
    core_analysis: `${claim.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    citations: [],
  };
  const rule = { _id: 'rule-1', statement: claim } as any;
  const evidence = support('source-1', 'evidence-1', claim);

  assert.equal(resolveDreamAnalysisCitation(analysis, [claim], rule, evidence), true);
  assert.equal(resolveDreamAnalysisCitation(analysis, [claim], rule, evidence), false);
  assert.equal(analysis.core_analysis, `${claim.slice(0, -1)} [1].`);
  assert.equal(analysis.claim_bindings.length, 1);
  assert.equal(analysis.citations.length, 1);
  assert.equal(analysis.real_life_hypotheses.length, 1);
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

function unresolvedAnalysis(claim: string): any {
  return {
    core_analysis: `${claim.slice(0, -1)} [?].`,
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
    real_life_hypotheses: [],
    claim_bindings: [unresolvedBinding(claim)],
    citations: [],
  };
}

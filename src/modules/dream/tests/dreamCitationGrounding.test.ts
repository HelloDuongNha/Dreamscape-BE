import assert from 'node:assert/strict';
import test from 'node:test';
import type { ILLMOutput } from '../../../infrastructure/llm.service';
import {
  groundDreamCitationClaims,
} from '../services/analysis/grounding/dreamCitationGrounding.service';
import {
  deduplicateDreamQuestionsBySource,
} from '../services/analysis/grounding/dreamResponseQuestion.service';

function analysisWithCore(coreAnalysis: string): ILLMOutput {
  return {
    title: 'A grounded dream',
    emotional_tone: 'thoughtful',
    summary: 'A factual summary.',
    scientific_context_notes: [],
    symbolic_notes: [],
    cultural_symbolic_notes: [],
    real_life_hypotheses: [],
    interpretive_threads: [],
    practical_reflections: [],
    confidence: 0.5,
    core_analysis: coreAnalysis,
    disclaimer: '',
  };
}

test('initial Dream analysis marks unsupported research claims as Evidence Needed', () => {
  const analysis = analysisWithCore(
    'Dream content may recombine past memories with anticipated future events. '
      + 'The locked suitcase felt personally important.',
  );
  analysis.evidence_claims = [{
    contentPath: 'core_analysis',
    claimText: 'Dream content may recombine past memories with anticipated future events.',
  }];

  groundDreamCitationClaims(analysis, {
    citableRules: [],
    validSourcesMap: new Map(),
    validEvidenceMap: new Map(),
  });

  assert.match(analysis.core_analysis, /future events \[\?\]\./u);
  assert.equal(analysis.claim_bindings?.length, 1);
  assert.equal(analysis.claim_bindings?.[0].status, 'unresolved');
  assert.deepEqual(analysis.citations, []);
  assert.deepEqual(analysis.real_life_hypotheses, []);
});

test('case-specific interpretation is not promoted to Evidence Needed without an explicit claim', () => {
  const analysis = analysisWithCore(
    'Giấc mơ phản ánh sự giằng co giữa chuyến tàu ngày mai và lớp học cũ.',
  );

  groundDreamCitationClaims(analysis, {
    citableRules: [],
    validSourcesMap: new Map(),
    validEvidenceMap: new Map(),
  });

  assert.doesNotMatch(analysis.core_analysis, /\[\?\]/u);
  assert.deepEqual(analysis.claim_bindings, []);
});

test('a directly supported claim receives a stored citation beside the claim', () => {
  const claim = 'Dream content may recombine past memories with anticipated future events.';
  const analysis = analysisWithCore(claim);
  analysis.evidence_claims = [{
    contentPath: 'core_analysis',
    claimText: claim,
    supportRuleId: 'rule-1',
  }];

  groundDreamCitationClaims(analysis, {
    citableRules: [{
      _id: 'rule-1',
      statement: claim,
      subject: 'dream content',
      outcome: 'recombines past memories with anticipated future events',
    }],
    validSourcesMap: new Map([['rule-1', [{
      sourceId: 'source-1',
      title: 'Constructive episodic simulation in dreams',
      year: 2022,
      doi: '10.1000/dreams',
    }]]]),
    validEvidenceMap: new Map([['rule-1', [{
      sourceId: 'source-1',
      chunkId: 'evidence-1',
      quote: 'Dreams combined past memory fragments with anticipated future events.',
    }]]]),
  });

  assert.equal(
    analysis.core_analysis,
    'Dream content may recombine past memories with anticipated future events [1].',
  );
  assert.equal(analysis.claim_bindings?.[0].status, 'resolved');
  assert.equal(analysis.citations?.[0].sourceId, 'source-1');
  assert.equal(analysis.real_life_hypotheses?.length, 1);
  assert.equal(analysis.real_life_hypotheses?.[0].validationSourceId, 'source-1');
  assert.equal(analysis.real_life_hypotheses?.[0].userFeedback, null);
});

test('two supported claims from one source share one citation number', () => {
  const first = 'Dream content may recombine past memories with anticipated future events.';
  const second = 'Future-oriented dreams may become more common later in the sleep period.';
  const analysis = analysisWithCore(`${first} ${second}`);
  analysis.evidence_claims = [
    { contentPath: 'core_analysis', claimText: first, supportRuleId: 'rule-1' },
    { contentPath: 'core_analysis', claimText: second, supportRuleId: 'rule-2' },
  ];
  const source = {
    sourceId: 'source-1',
    title: 'Constructive episodic simulation in dreams',
    year: 2022,
  };

  groundDreamCitationClaims(analysis, {
    citableRules: [
      { _id: 'rule-1', statement: first },
      { _id: 'rule-2', statement: second },
    ],
    validSourcesMap: new Map([
      ['rule-1', [source]],
      ['rule-2', [source]],
    ]),
    validEvidenceMap: new Map([
      ['rule-1', [{ sourceId: 'source-1', chunkId: 'e-1', quote: first }]],
      ['rule-2', [{ sourceId: 'source-1', chunkId: 'e-2', quote: second }]],
    ]),
  });

  assert.equal(analysis.citations?.length, 1);
  assert.equal(analysis.real_life_hypotheses?.length, 1);
  assert.deepEqual(analysis.claim_bindings?.map((item) => item.citationIndex), [1, 1]);
  assert.match(analysis.core_analysis, /events \[1\]\./u);
  assert.match(analysis.core_analysis, /sleep period \[1\]\./u);
});

test('one academic source produces only one Dream verification question', () => {
  const questions = deduplicateDreamQuestionsBySource([
    {
      ruleId: 'rule-1',
      followUpQuestion: 'Question one?',
      sources: [{ sourceId: 'source-1', doi: '10.1000/dreams' }],
    },
    {
      ruleId: 'rule-2',
      followUpQuestion: 'Question two?',
      sources: [{ sourceId: 'source-1', doi: 'https://doi.org/10.1000/dreams' }],
    },
    {
      ruleId: 'rule-3',
      followUpQuestion: 'Question three?',
      sources: [{ sourceId: 'source-2' }],
    },
  ]);

  assert.deepEqual(questions.map((item) => item.ruleId), ['rule-1', 'rule-3']);
});

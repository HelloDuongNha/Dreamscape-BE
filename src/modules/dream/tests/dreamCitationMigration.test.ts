import assert from 'node:assert/strict';
import test from 'node:test';

import {
  migrateLegacyDreamCitationAnalysis,
  migrateLegacyDreamCitationRecord,
} from '../services/analysis/grounding/dreamCitationMigration.service';
import { collectDreamEvidenceRecord } from '../../../shared/evidence/dreamEvidenceRecord';
import { DREAM_CITATION_CONTRACT_VERSION } from '../../../shared/evidence/citationClaim';

test('migrates a legacy resolved marker only when its source can be recovered', () => {
  const analysis: any = {
    core_analysis: 'Dream content may recombine past memories with anticipated future events [1].',
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [{
      ruleId: 'rule-1',
      ruleStatement: 'Dreams may combine memories and future events.',
      sources: [{ sourceId: 'source-1', title: 'Dream study', year: 2022 }],
      evidenceQuotes: [{ sourceId: 'source-1', chunkId: 'chunk-1', quote: 'Exact quote.' }],
    }],
    real_life_hypotheses: [{
      verificationKey: 'question-1',
      validationSourceId: 'source-1',
      sources: [{ sourceId: 'source-1' }],
    }],
  };

  const result = migrateLegacyDreamCitationAnalysis(analysis);

  assert.equal(result.bindingsCreated, 1);
  assert.equal(result.citationsRecovered, 1);
  assert.equal(analysis.citation_contract_version, DREAM_CITATION_CONTRACT_VERSION);
  assert.equal(analysis.claim_bindings[0].status, 'resolved');
  assert.equal(analysis.claim_bindings[0].verificationKey, 'question-1');
  assert.equal(analysis.citations[0].sourceId, 'source-1');
});

test('reopens an unprovable numeric marker instead of guessing its source', () => {
  const analysis: any = {
    core_analysis: 'Dream content may recombine past memories with anticipated future events [4].',
    summary: '',
    interpretive_threads: [],
    scientific_context_notes: [],
  };

  const result = migrateLegacyDreamCitationAnalysis(analysis);

  assert.equal(result.markersReopened, 1);
  assert.equal(analysis.citation_contract_version, DREAM_CITATION_CONTRACT_VERSION);
  assert.match(analysis.core_analysis, /future events \[\?\]\./u);
  assert.equal(analysis.claim_bindings[0].status, 'unresolved');
  assert.deepEqual(analysis.citations, []);
});

test('migrates current, mirrored and historical Dream analyses independently', () => {
  const legacyMirror: any = {
    core_analysis: 'Dreams may reflect waking concerns [?].',
    summary: '',
    interpretive_threads: [],
  };
  const dream: any = {
    ai_result: {
      core_analysis: 'Dream content may recombine waking memories [?].',
      summary: '',
      interpretive_threads: [],
    },
    aiAnalysis: legacyMirror,
    edit_history: [{
      ai_result: {
        core_analysis: 'Future-oriented dreams may become more common later in sleep [?].',
        summary: '',
        interpretive_threads: [],
      },
    }],
  };

  const result = migrateLegacyDreamCitationRecord(dream);

  assert.equal(result.bindingsCreated, 3);
  assert.equal(dream.ai_result.claim_bindings[0].status, 'unresolved');
  assert.equal(legacyMirror.claim_bindings[0].status, 'unresolved');
  assert.equal(dream.edit_history[0].ai_result.claim_bindings[0].status, 'unresolved');
});

test('versions an existing structured citation ledger without rewriting it', () => {
  const analysis: any = {
    core_analysis: 'A claim [1].',
    claim_bindings: [{ claimId: 'existing', status: 'resolved' }],
  };

  assert.equal(migrateLegacyDreamCitationAnalysis(analysis).changed, true);
  assert.deepEqual(analysis.claim_bindings, [{ claimId: 'existing', status: 'resolved' }]);
  assert.equal(analysis.citation_contract_version, DREAM_CITATION_CONTRACT_VERSION);
});

test('marks a legacy analysis with no academic claims as safely migrated', () => {
  const analysis: any = {
    core_analysis: 'A personal reflection without an academic claim.',
    scientific_context_notes: [],
  };

  assert.equal(migrateLegacyDreamCitationAnalysis(analysis).changed, true);
  assert.deepEqual(analysis.claim_bindings, []);
  assert.equal(analysis.citation_contract_version, DREAM_CITATION_CONTRACT_VERSION);
});

test('does not revisit an analysis already using the current citation contract', () => {
  const analysis: any = {
    citation_contract_version: DREAM_CITATION_CONTRACT_VERSION,
    claim_bindings: [],
  };

  assert.equal(migrateLegacyDreamCitationAnalysis(analysis).changed, false);
});

test('reports sourced legacy prose that cannot be mapped without reanalysis', () => {
  const analysis: any = {
    core_analysis: 'A personal interpretation without an inline citation marker.',
    scientific_context_notes: [{
      sources: [{ sourceId: 'source-1' }],
    }],
  };

  const result = migrateLegacyDreamCitationAnalysis(analysis);

  assert.equal(result.changed, false);
  assert.equal(result.requiresReanalysis, 1);
  assert.equal(analysis.claim_bindings, undefined);
});

test('collects Evidence Needed claims from current, mirrored and historical analyses', () => {
  const current = {
    core_analysis: 'Current research claim [?].',
    claim_bindings: [{ claimText: 'Current research claim.', status: 'unresolved' }],
  };
  const record = collectDreamEvidenceRecord({
    ai_result: current,
    aiAnalysis: current,
    edit_history: [{
      ai_result: {
        core_analysis: 'Historical research claim [?].',
        claim_bindings: [{ claimText: 'Historical research claim.', status: 'unresolved' }],
      },
    }],
  });

  assert.match(record.answer, /Current research claim/u);
  assert.match(record.answer, /Historical research claim/u);
  assert.equal(record.claimBindings.length, 2);
});

import assert from 'assert';
import { createRuleV3ModerationController, RuleV3ControllerDependencies, getProductionAvailabilityConfig } from './ruleV3ModerationController';
import AcademicSource from '../models/AcademicSource';
import SourceContribution from '../models/SourceContribution';
import AcademicDocument from '../models/AcademicDocument';
import AcademicSection from '../models/AcademicSection';
import AcademicChunk from '../models/AcademicChunk';
import { ProviderCandidate } from '../services/rules/ruleV3GenerationProvider.types';

// Mock Express Request and Response
class MockResponse {
  statusCode = 200;
  headers: Record<string, string> = {};
  body: any = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }

  json(data: any) {
    this.body = data;
    return this;
  }
}

// Zero-write verification guard
const writeCalled: string[] = [];
const writeMethods = [
  'save',
  'create',
  'insertMany',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'deleteOne',
  'deleteMany',
  'bulkWrite'
];

for (const model of [AcademicSource, SourceContribution, AcademicDocument, AcademicSection, AcademicChunk]) {
  for (const method of writeMethods) {
    if ((model as any)[method]) {
      (model as any)[method] = () => {
        writeCalled.push(method);
        throw new Error(`Forbidden database write call detected: ${method}`);
      };
    }
  }
  if (model.prototype) {
    for (const method of writeMethods) {
      if (model.prototype[method]) {
        model.prototype[method] = () => {
          writeCalled.push(`prototype.${method}`);
          throw new Error(`Forbidden database write call detected: prototype.${method}`);
        };
      }
    }
  }
}

async function runTests() {
  console.log('=== RULE V3 MODERATION CONTROLLER TEST SUITE ===');

  let defaultDeps: RuleV3ControllerDependencies = {} as any;
  let activeTimers: Array<{ callback: () => void; ms: number; id: any }> = [];
  let nextTimerId = 1;

  const mockDocumentId = 'doc-123';
  const mockRawPlan = {
    document: {
      _id: mockDocumentId,
      parserEngine: 'docling',
      updatedAt: '2026-07-17T10:00:00.000Z'
    },
    sections: [{ _id: 'sec-1', heading: 'Section 1' }],
    chunks: [{ _id: 'chunk-1', sectionId: 'sec-1', text: 'Some text segment matching exact quote.' }],
    profile: {
      documentId: mockDocumentId,
      documentType: 'quantitative_empirical',
      sourceLanguage: 'vi',
      sectionProfiles: [{ sectionId: 'sec-1', heading: 'Section 1' }]
    },
    extractionPlan: {
      documentId: mockDocumentId,
      documentType: 'quantitative_empirical',
      hasTargets: true,
      allExcluded: false
    },
    evidencePlan: {
      sourceLanguage: 'vi',
      batches: [
        {
          batchId: 'batch-1',
          strategy: 'quantitative_results',
          sourceLanguage: 'vi',
          characterCount: 100,
          pageStart: 1,
          pageEnd: 2,
          oversizedSingleChunk: false,
          chunks: [
            {
              chunkId: 'chunk-1',
              sectionId: 'sec-1',
              chunkOrder: 0,
              text: 'Some text segment matching exact quote.',
              sectionRole: 'results'
            }
          ]
        }
      ]
    },
    hierarchicalPlan: {
      documentId: mockDocumentId,
      researchType: 'quantitative_empirical',
      sourceLanguage: 'vi',
      organizationMode: 'article_sections',
      workUnits: [
        {
          workUnitId: 'wu1',
          ordinal: 1,
          label: 'Results',
          strategy: 'quantitative_results',
          sectionIds: ['sec-1'],
          targetChunkIds: ['chunk-1'],
          chunkCount: 1,
          characterCount: 100,
          batchIds: ['batch-1'],
          batchCount: 1
        }
      ]
    }
  };

  function resetDeps() {
    activeTimers = [];
    nextTimerId = 1;
    writeCalled.length = 0;

    const setTimeoutFn = (callback: () => void, ms: number) => {
      const id = nextTimerId++;
      activeTimers.push({ callback, ms, id });
      return id;
    };

    const clearTimeoutFn = (id: any) => {
      activeTimers = activeTimers.filter(t => t.id !== id);
    };

    defaultDeps = {
      planLoader: async (id) => ({ sourceId: id, title: 'Mocked Title' }),
      planLoaderRaw: async (id) => mockRawPlan,
      providerFactory: (name, model) => {
        return {
          name,
          modelName: model || 'test-model',
          generateCandidates: async () => []
        };
      },
      availabilityChecker: async () => ({
        defaultProvider: 'ollama',
        availableProviders: ['ollama'],
        providerStatuses: [
          {
            provider: 'ollama',
            configured: true,
            available: true,
            model: 'qwen2.5:14b',
            reasonCode: null
          },
          {
            provider: 'gemini',
            configured: false,
            available: false,
            model: null,
            reasonCode: 'not_configured'
          }
        ]
      }),
      setTimeoutFn,
      clearTimeoutFn,
      timeoutMs: 5000
    };
  }

  // Test 1: Sets Cache-Control header
  {
    resetDeps();
    const controller = createRuleV3ModerationController(defaultDeps);
    const req: any = { params: { id: '64f7832a84a6c6c2b186b515' } };
    const res = new MockResponse();

    await controller.previewRuleV3Plan(req, res as any);
    assert.strictEqual(res.headers['Cache-Control'], 'no-store');
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Sets Cache-Control: no-store header');
  }

  // Test 2: One concurrent dry run per moderator
  {
    resetDeps();
    let resolveProvider: (val: any) => void = () => {};
    const providerPromise = new Promise(resolve => {
      resolveProvider = resolve;
    });

    defaultDeps.providerFactory = () => ({
      name: 'ollama',
      modelName: 'mock-model',
      generateCandidates: async () => {
        await providerPromise;
        return [];
      }
    });

    const controller = createRuleV3ModerationController(defaultDeps);
    const req1: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res1 = new MockResponse();

    const promise1 = controller.dryRunRuleV3Extraction(req1, res1 as any);

    const req2: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res2 = new MockResponse();
    await controller.dryRunRuleV3Extraction(req2, res2 as any);

    assert.strictEqual(res2.statusCode, 429);
    assert.strictEqual(res2.body.errorCode, 'dry_run_already_active');

    resolveProvider([]);
    await promise1;
    assert.strictEqual(res1.statusCode, 200);

    const req3: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res3 = new MockResponse();
    await controller.dryRunRuleV3Extraction(req3, res3 as any);
    assert.notStrictEqual(res3.statusCode, 429);
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Restricts to one concurrent dry run per moderator and releases lock');
  }

  // Test 3: Different moderators run independently
  {
    resetDeps();
    let resolveProvider: (val: any) => void = () => {};
    const providerPromise = new Promise(resolve => {
      resolveProvider = resolve;
    });

    defaultDeps.providerFactory = () => ({
      name: 'ollama',
      modelName: 'mock-model',
      generateCandidates: async () => {
        await providerPromise;
        return [];
      }
    });

    const controller = createRuleV3ModerationController(defaultDeps);
    const req1: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res1 = new MockResponse();

    const promise1 = controller.dryRunRuleV3Extraction(req1, res1 as any);

    const req2: any = {
      user: { _id: 'moderator2' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res2 = new MockResponse();
    const promise2 = controller.dryRunRuleV3Extraction(req2, res2 as any);

    assert.notStrictEqual(res2.statusCode, 429);

    resolveProvider([]);
    await Promise.all([promise1, promise2]);
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Different moderators run independently without blocking');
  }

  // Test 4: Releases lock after timeout abort
  {
    resetDeps();
    defaultDeps.providerFactory = () => ({
      name: 'ollama',
      modelName: 'mock-model',
      generateCandidates: async (input, signal) => {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) {
            return reject(new Error('provider_timeout'));
          }
          if (signal) {
            signal.addEventListener('abort', () => reject(new Error('provider_timeout')));
          }
          resolve([]);
        });
      }
    });

    const controller = createRuleV3ModerationController(defaultDeps);
    const req: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res = new MockResponse();

    const promise = controller.dryRunRuleV3Extraction(req, res as any);

    assert.strictEqual(activeTimers.length, 1);
    
    activeTimers[0].callback();

    await promise;

    assert.strictEqual(res.statusCode, 504);
    assert.strictEqual(res.body.errorCode, 'provider_timeout');

    // Confirm lock is released
    const req2: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res2 = new MockResponse();
    await controller.dryRunRuleV3Extraction(req2, res2 as any);
    assert.notStrictEqual(res2.statusCode, 429);
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Releases lock after timeout aborts the request');
  }

  // Test 5: Releases lock after provider failure
  {
    resetDeps();
    defaultDeps.providerFactory = () => ({
      name: 'ollama',
      modelName: 'mock-model',
      generateCandidates: async () => {
        throw new Error('provider_schema_invalid');
      }
    });

    const controller = createRuleV3ModerationController(defaultDeps);
    const req: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res = new MockResponse();

    await controller.dryRunRuleV3Extraction(req, res as any);

    assert.strictEqual(res.statusCode, 422);
    assert.strictEqual(res.body.errorCode, 'provider_schema_invalid');

    const req2: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res2 = new MockResponse();
    await controller.dryRunRuleV3Extraction(req2, res2 as any);
    assert.notStrictEqual(res2.statusCode, 429);
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Releases lock after provider failure');
  }

  // Test 6: Releases lock after plan loading failure
  {
    resetDeps();
    defaultDeps.planLoaderRaw = async (id) => {
      throw new Error('plan_unavailable');
    };
    const controller = createRuleV3ModerationController(defaultDeps);
    const req: any = {
      user: { _id: 'moderator1' },
      params: { id: 'invalid-plan-id', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res = new MockResponse();

    await controller.dryRunRuleV3Extraction(req, res as any);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.errorCode, 'plan_unavailable');

    const req2: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res2 = new MockResponse();
    await controller.dryRunRuleV3Extraction(req2, res2 as any);
    assert.notStrictEqual(res2.statusCode, 429);
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Releases lock after plan loading failure');
  }

  // Test 7: Default provider null matching status
  {
    resetDeps();
    process.env.RULE_V3_PROVIDER = 'gemini';
    process.env.RULE_V3_ALLOWED_PREVIEW_PROVIDERS = 'ollama';
    process.env.RULE_V3_OLLAMA_MODEL = 'qwen2.5:14b';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
    process.env.RULE_V3_GEMINI_MODEL = 'gemini-3.5-flash';
    process.env.GEMINI_API_KEY = 'key';

    // Mock global fetch for Ollama tags check
    const origFetch = global.fetch;
    global.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ name: 'qwen2.5:14b' }] })
    })) as any;

    try {
      const config = await getProductionAvailabilityConfig();
      assert.strictEqual(config.defaultProvider, null);
    } finally {
      global.fetch = origFetch;
    }
    console.log('[PASS] Sets defaultProvider to null when default is not available');
  }

  // Test 8: Sanitizes error traceback messages
  {
    resetDeps();
    defaultDeps.providerFactory = () => {
      throw new Error('mongodb://secret-key:pwd@host/db file:///foo/bar/db.ts Secret API key 12345');
    };

    const controller = createRuleV3ModerationController(defaultDeps);
    const req: any = {
      user: { _id: 'moderator1' },
      params: { id: '64f7832a84a6c6c2b186b515', workUnitId: 'wu1' },
      body: { provider: 'ollama' }
    };
    const res = new MockResponse();

    await controller.dryRunRuleV3Extraction(req, res as any);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.errorCode, 'provider_unavailable');
    assert.ok(!res.body.message.includes('mongodb://'));
    assert.ok(!res.body.message.includes('file:///'));
    assert.ok(!res.body.message.includes('Secret'));
    assert.strictEqual(writeCalled.length, 0);
    console.log('[PASS] Sanitizes error traceback messages completely');
  }

  console.log('================================================');
  console.log('RULE V3 MODERATION CONTROLLER: ALL PASSED, 0 FAILED');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

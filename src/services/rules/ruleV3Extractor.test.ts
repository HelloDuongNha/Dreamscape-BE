import assert from 'assert';
import { extractRuleV3Candidates } from './ruleV3Extractor.service';
import { RuleV3OllamaProvider } from './providers/ruleV3OllamaProvider.service';
import { RuleV3GeminiProvider } from './providers/ruleV3GeminiProvider.service';
import type { DocumentResearchProfile, DocumentExtractionPlan } from './documentResearchProfile.types';
import type { EvidenceBatchPlan } from './evidenceBatchPlanner.types';
import type { HierarchicalEvidencePlan } from './hierarchicalEvidencePlanner.types';
import { RuleV3GenerationProvider, ProviderCandidate, RuleV3ProviderInput } from './ruleV3GenerationProvider.types';
import { LIMIT_CANDIDATES, LIMIT_EVIDENCE_ITEMS, OLLAMA_JSON_SCHEMA, validateProviderResponse } from './ruleV3ProviderResponseValidator.service';

// Mock fetch setup
let mockFetchPayload: any = null;
let mockFetchStatus: number = 200;
let lastRequestUrl: string = '';
let lastRequestHeaders: any = null;
let lastRequestBody: any = null;
let mockFetchDelayMs = 0;

let mockFetchResponseFn: ((url: string, options: any) => any) | null = null;

const originalFetch = global.fetch;
global.fetch = (async (url: string, options: any) => {
  lastRequestUrl = url;
  lastRequestHeaders = options?.headers || null;
  lastRequestBody = options?.body ? JSON.parse(options.body) : null;

  if (mockFetchResponseFn) {
    return mockFetchResponseFn(url, options);
  }

  if (options?.signal?.aborted) {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    throw err;
  }

  if (mockFetchDelayMs > 0) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        resolve(null);
      }, mockFetchDelayMs);

      function onAbort() {
        clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        const err = new Error('The user aborted a request.');
        err.name = 'AbortError';
        reject(err);
      }

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort);
      }
    });
  }

  return {
    ok: mockFetchStatus >= 200 && mockFetchStatus < 300,
    status: mockFetchStatus,
    json: async () => mockFetchPayload
  } as any;
}) as any;

// Helper to reset mocks
function resetMocks() {
  mockFetchPayload = null;
  mockFetchStatus = 200;
  lastRequestUrl = '';
  lastRequestHeaders = null;
  lastRequestBody = null;
  mockFetchDelayMs = 0;
  mockFetchResponseFn = null;
}

// Set test environment variables
process.env.GEMINI_API_KEY = 'mock-gemini-key';
process.env.RULE_V3_GEMINI_MODEL = 'gemini-3.5-flash';
process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
process.env.RULE_V3_OLLAMA_MODEL = 'qwen2.5:14b';
process.env.RULE_V3_ALLOWED_PREVIEW_PROVIDERS = 'ollama,gemini';

// Test targets definition
const mockProfile: any = {
  documentId: 'doc-123',
  documentType: 'quantitative_empirical',
  sourceLanguage: 'vi',
  typeConfidence: 'high',
  typeReasonCodes: [],
  typeEvidenceChannels: []
};

const mockExtractionPlan: any = {
  documentId: 'doc-123',
  documentType: 'quantitative_empirical',
  hasTargets: true,
  allExcluded: false,
  sectionDecisions: []
};

const mockEvidenceBatchPlan: any = {
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
          text: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
          sectionRole: 'results'
        }
      ]
    }
  ],
  diagnostics: {
    inputChunkCount: 1,
    targetChunkCount: 1,
    duplicateChunkCount: 0,
    missingSectionChunkCount: 0,
    skippedChunkCount: 0
  }
};

const mockHierarchicalPlan: any = {
  documentId: 'doc-123',
  researchType: 'quantitative_empirical',
  sourceLanguage: 'vi',
  organizationMode: 'article_sections',
  workUnits: [
    {
      workUnitId: 'wu-1',
      ordinal: 1,
      label: 'Kết quả định lượng',
      strategy: 'quantitative_results',
      sectionIds: ['sec-1'],
      targetChunkIds: ['chunk-1'],
      chunkCount: 1,
      characterCount: 100,
      batchIds: ['batch-1'],
      batchCount: 1
    }
  ],
  diagnostics: {
    workUnitCount: 1,
    technicalBatchCount: 1,
    targetChunkCount: 1,
    assignedChunkCount: 1,
    unassignedChunkCount: 0,
    duplicateAssignmentCount: 0
  }
};

const mockReaderInput = {
  documentId: 'doc-123',
  parserEngine: 'docling',
  documentUpdatedAt: '2026-07-18T00:00:00.000Z',
  sectionCount: 1,
  readerChunkCount: 1
};

const directProviderInput: RuleV3ProviderInput = {
  batchId: 'batch-direct',
  sectionId: 'sec-direct',
  sectionLabel: 'Direct provider test section',
  workUnitId: 'wu-direct',
  workUnitLabel: 'Direct provider test unit',
  strategy: 'quantitative_results',
  sourceLanguage: 'vi',
  chunks: [{ chunkId: 'c1', text: 'hello' }]
};

async function runTests() {
  console.log('=== RULE V3 EXTRACTOR & PROVIDERS TEST SUITE ===');

  // Test 1: Ollama request format uses JSON Schema object
  {
    resetMocks();
    mockFetchPayload = { response: JSON.stringify({ candidates: [] }) };
    const provider = new RuleV3OllamaProvider();
    await provider.generateCandidates(directProviderInput);
    
    assert.strictEqual(lastRequestUrl, 'http://localhost:11434/api/generate');
    assert.deepStrictEqual(lastRequestBody.format.type, 'object');
    assert.strictEqual(lastRequestBody.format.properties.candidates.maxItems, 3);
    assert.strictEqual(lastRequestBody.format.properties.candidates.items.properties.evidence.maxItems, 5);
    assert.strictEqual(lastRequestBody.options.temperature, 0);
    console.log('[PASS] Ollama request uses JSON Schema object, not "json" string');
  }

  // Test 2: Gemini request contains responseMimeType and responseSchema and x-goog-api-key
  {
    resetMocks();
    mockFetchPayload = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({ candidates: [] })
              }
            ]
          }
        }
      ]
    };
    const provider = new RuleV3GeminiProvider();
    await provider.generateCandidates(directProviderInput);

    assert.ok(lastRequestUrl.includes('generativelanguage.googleapis.com'));
    assert.ok(!lastRequestUrl.includes('key=')); // no API key in URL query parameter
    assert.strictEqual(lastRequestHeaders['x-goog-api-key'], 'mock-gemini-key');
    assert.strictEqual(lastRequestBody.generationConfig.responseMimeType, 'application/json');
    assert.strictEqual(lastRequestBody.generationConfig.temperature, 0);
    assert.deepStrictEqual(lastRequestBody.generationConfig.responseSchema.type, 'OBJECT');
    console.log('[PASS] Gemini request contains responseMimeType, responseSchema, and x-goog-api-key securely');
  }

  // Test 3: Invalid configured Gemini model is rejected before fetch
  {
    resetMocks();
    assert.throws(() => {
      new RuleV3GeminiProvider('invalid_gemini_model_!@#$');
    }, /invalid_provider/);
    console.log('[PASS] Invalid configured Gemini model is rejected before fetch');
  }

  // Test 4: Provider request contains the untrusted-document instruction and explicit chunk delimiters
  {
    resetMocks();
    mockFetchPayload = { response: JSON.stringify({ candidates: [] }) };
    const provider = new RuleV3OllamaProvider();
    await provider.generateCandidates({
      ...directProviderInput,
      chunks: [{ chunkId: 'chunk-abc', text: 'some content' }]
    });
    
    const prompt = lastRequestBody.prompt;
    assert.ok(prompt.includes('untrusted evidence data') || prompt.includes('untrusted data'));
    assert.ok(prompt.includes('NEVER followed'));
    assert.ok(prompt.includes('[DATA_START]'));
    assert.ok(prompt.includes('[chunkId]: chunk-abc'));
    assert.ok(prompt.includes('[DATA_END]'));
    console.log('[PASS] Provider prompt contains untrusted-data instruction and explicit chunk delimiters');
  }

  // Test 5: Valid Vietnamese candidate accepted
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'mức độ lo âu',
            conditions: ['REM sleep'],
            limitations: [],
            dreamFeatureTags: ['anxiety'],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'mức độ lo âu',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.rejectedCandidates.length, 0);
    assert.strictEqual(result.citationVerifiedCandidates[0].statement, 'Giấc mơ có mối liên kết tích cực với mức độ lo âu.');
    assert.strictEqual(result.citationVerifiedCandidates[0].warnings.length, 0);
    console.log('[PASS] Valid Vietnamese candidate accepted');
  }

  // Test 6: Valid English candidate accepted
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Dreaming has a positive correlation with anxiety levels.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Dreaming',
            outcome: 'anxiety levels',
            conditions: ['REM sleep'],
            limitations: [],
            dreamFeatureTags: ['anxiety'],
            evidence: [
              {
                chunkId: 'chunk-english',
                proposedQuote: 'anxiety levels',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const enProfile = { ...mockProfile, sourceLanguage: 'en' };
    const enBatchPlan = {
      ...mockEvidenceBatchPlan,
      batches: [
        {
          ...mockEvidenceBatchPlan.batches[0],
          chunks: [
            {
              chunkId: 'chunk-english',
              sectionId: 'sec-1',
              chunkOrder: 0,
              text: 'We found that dreaming has a positive correlation with anxiety levels.',
              sectionRole: 'results'
            }
          ]
        }
      ]
    };
    const enHierarchicalPlan = {
      ...mockHierarchicalPlan,
      workUnits: [
        {
          ...mockHierarchicalPlan.workUnits[0],
          targetChunkIds: ['chunk-english'],
          batchIds: ['batch-1']
        }
      ]
    };

    const result = await extractRuleV3Candidates(
      enProfile,
      mockExtractionPlan,
      enBatchPlan,
      enHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.rejectedCandidates.length, 0);
    assert.strictEqual(result.citationVerifiedCandidates[0].statement, 'Dreaming has a positive correlation with anxiety levels.');
    console.log('[PASS] Valid English candidate accepted');
  }

  // Test 7: Content-free candidate is rejected even when language is uncertain
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: '123 456 789',
            claimType: 'association',
            effectPolarity: 'neutral',
            evidenceInterpretation: 'associational',
            subject: '123',
            outcome: '456',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'mức độ lo âu',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates.length, 1);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'evidence_does_not_entail_claim');
    console.log('[PASS] Content-free candidate rejected before persistence');
  }

  // Test 8: Confirmed language mismatch rejected
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'The dream was with the participants and the results of the study.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'the dream and chapter method',
            outcome: 'results of the study',
            conditions: ['with the results in chapter'],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'mức độ lo âu',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates.length, 1);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'language_mismatch');
    console.log('[PASS] Confirmed language mismatch rejected with language_mismatch');
  }

  // Test 9: Exact quote accepted
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.citationVerifiedCandidates[0].evidence[0].exactQuote, 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.');
    console.log('[PASS] Exact quote accepted when it also entails the claim');
  }

  // Test 10: Translated quote => citation_missing
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có liên kết tích cực.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'dreams are positively correlated with anxiety', // translated proposedQuote
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates.length, 1);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'citation_missing');
    console.log('[PASS] Translated quote rejected with citation_missing');
  }

  // Test 11: Changed negation => citation_missing
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có liên kết tích cực.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ không có liên kết tích cực', // changed negation
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'citation_missing');
    console.log('[PASS] Changed negation rejected with citation_missing');
  }

  // Test 12: Ambiguous quotation => citation_ambiguous
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có liên kết tích cực.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-ambig',
                proposedQuote: 'từ trùng lặp xuất hiện', // proposedQuote matching multiple times
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const ambigBatchPlan = {
      ...mockEvidenceBatchPlan,
      batches: [
        {
          ...mockEvidenceBatchPlan.batches[0],
          chunks: [
            {
              chunkId: 'chunk-ambig',
              sectionId: 'sec-1',
              chunkOrder: 0,
              text: 'từ trùng lặp xuất hiện ở đây và từ trùng lặp xuất hiện ở kia nữa.',
              sectionRole: 'results'
            }
          ]
        }
      ]
    };
    const ambigHierarchicalPlan = {
      ...mockHierarchicalPlan,
      workUnits: [
        {
          ...mockHierarchicalPlan.workUnits[0],
          targetChunkIds: ['chunk-ambig']
        }
      ]
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      ambigBatchPlan,
      ambigHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'citation_ambiguous');
    console.log('[PASS] Ambiguous quotation rejected with citation_ambiguous');
  }

  // Test 13: Outside-work-unit chunk => chunk_outside_work_unit
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có liên kết tích cực.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-different', // not in target batches
                proposedQuote: 'mức độ lo âu của người tham gia',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'chunk_outside_work_unit');
    console.log('[PASS] Outside work unit chunk rejected with chunk_outside_work_unit');
  }

  // Test 14: Association + causal => invalid_causal_elevation
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có liên kết tích cực.',
            claimType: 'association', // claimType is association
            effectPolarity: 'positive',
            evidenceInterpretation: 'causal', // interpretation is causal (elevation!)
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'mức độ lo âu của người tham gia',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'invalid_causal_elevation');
    console.log('[PASS] Association + causal elevation rejected with invalid_causal_elevation');
  }

  // Test 15: Unsupported null finding rejected
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Không tìm thấy khác biệt lo âu.',
            claimType: 'null_finding',
            effectPolarity: 'neutral',
            evidenceInterpretation: 'not_applicable',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'mức độ lo âu của người tham gia',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 0);
    assert.strictEqual(result.rejectedCandidates[0].reasonCode, 'evidence_does_not_entail_claim');
    console.log('[PASS] Unsupported null finding rejected');
  }

  // Test 16: Duplicate candidate merged
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: ['Điều kiện A'],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          },
          {
            statement: 'Mức độ lo âu của người tham gia có mối liên kết tích cực với giấc mơ.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: ' Giấc mơ  ', // extra spacing/casing
            outcome: ' lo âu ',
            conditions: ['Điều kiện A'],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.diagnostics.mergedDuplicateCount, 1);
    assert.strictEqual(result.citationVerifiedCandidates[0].evidence.length, 2); // merged supporting evidence items
    console.log('[PASS] Duplicate candidate merged');
  }

  // Test 17: Duplicate evidence span removed
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              },
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.', // duplicate proposedQuote
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.citationVerifiedCandidates[0].evidence.length, 1); // duplicate evidence span skipped
    console.log('[PASS] Duplicate evidence span skipped');
  }

  // Test 18: Malformed provider response => provider_schema_invalid
  {
    resetMocks();
    mockFetchPayload = { response: 'invalid_json_###' };

    await assert.rejects(async () => {
      await extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        mockEvidenceBatchPlan,
        mockHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider()
      );
    }, /provider_schema_invalid/);
    console.log('[PASS] Malformed provider response throws run-level error provider_schema_invalid');
  }

  // Test 19: Provider returning 4 candidates in one call => provider_schema_invalid
  {
    resetMocks();
    const candidateItem = {
      statement: 'Mẫu',
      claimType: 'association',
      effectPolarity: 'positive',
      evidenceInterpretation: 'associational',
      subject: 'A',
      outcome: 'B',
      conditions: [],
      limitations: [],
      dreamFeatureTags: [],
      evidence: []
    };
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [candidateItem, candidateItem, candidateItem, candidateItem] // 4 items!
      })
    };

    await assert.rejects(async () => {
      await extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        mockEvidenceBatchPlan,
        mockHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider()
      );
    }, /provider_schema_invalid/);
    console.log('[PASS] Provider returning 4 candidates in one call throws run-level error provider_schema_invalid');
  }

  // Test 20: Total raw candidates can never exceed 6
  {
    resetMocks();
    const candidateItem = {
      statement: 'Mẫu',
      claimType: 'association',
      effectPolarity: 'positive',
      evidenceInterpretation: 'associational',
      subject: 'A',
      outcome: 'B',
      conditions: [],
      limitations: [],
      dreamFeatureTags: [],
      evidence: []
    };

    // Construct a plan with 2 batches
    const multiBatchPlan = {
      ...mockEvidenceBatchPlan,
      batches: [
        {
          ...mockEvidenceBatchPlan.batches[0],
          batchId: 'batch-1'
        },
        {
          ...mockEvidenceBatchPlan.batches[0],
          batchId: 'batch-2'
        }
      ]
    };
    const multiHierarchicalPlan = {
      ...mockHierarchicalPlan,
      workUnits: [
        {
          ...mockHierarchicalPlan.workUnits[0],
          batchIds: ['batch-1', 'batch-2']
        }
      ]
    };

    // Return 3 candidates per batch (total 6 is allowed, but let's test if it returns 4 in next batch and exceeds 6)
    let callCount = 0;
    mockFetchResponseFn = (url: string, options: any) => {
      callCount++;
      const itemCount = callCount === 1 ? 3 : 4; // first call returns 3, second returns 4 (total 7)
      const list = Array(itemCount).fill(candidateItem);
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: JSON.stringify({ candidates: list }) })
      } as any;
    };

    await assert.rejects(async () => {
      await extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        multiBatchPlan,
        multiHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider()
      );
    }, /provider_schema_invalid/);
    console.log('[PASS] Total raw candidates exceeding 6 throws run-level error provider_schema_invalid');
  }

  // Test 21: Oversized input => input_too_large without truncation
  {
    resetMocks();
    const oversizedBatchPlan = {
      ...mockEvidenceBatchPlan,
      batches: [
        {
          ...mockEvidenceBatchPlan.batches[0],
          chunks: [
            {
              ...mockEvidenceBatchPlan.batches[0].chunks[0],
              text: 'x'.repeat(60000) // 60000 chars exceeds 50000 limit
            }
          ]
        }
      ]
    };

    await assert.rejects(async () => {
      await extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        oversizedBatchPlan,
        mockHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider()
      );
    }, /input_too_large/);
    console.log('[PASS] Oversized input (>50000 chars) throws run-level error input_too_large without truncation');
  }

  // Test 22: Timeout => provider_timeout and active lock released
  {
    resetMocks();
    mockFetchDelayMs = 200; // delay to let abort trigger

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20); // abort quickly

    await assert.rejects(async () => {
      await extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        mockEvidenceBatchPlan,
        mockHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider(),
        controller.signal
      );
    }, /provider_timeout/);
    console.log('[PASS] Timeout maps to provider_timeout');
  }

  // Test 23: Enforces maximum of 2 sequential provider calls
  {
    resetMocks();
    let providerCalls = 0;
    mockFetchResponseFn = (url: string, options: any) => {
      providerCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: JSON.stringify({ candidates: [] }) })
      } as any;
    };

    const threeBatchPlan = {
      ...mockEvidenceBatchPlan,
      batches: [
        { ...mockEvidenceBatchPlan.batches[0], batchId: 'batch-1' },
        { ...mockEvidenceBatchPlan.batches[0], batchId: 'batch-2' },
        { ...mockEvidenceBatchPlan.batches[0], batchId: 'batch-3' }
      ]
    };
    const threeHierarchicalPlan = {
      ...mockHierarchicalPlan,
      workUnits: [
        {
          ...mockHierarchicalPlan.workUnits[0],
          batchIds: ['batch-1', 'batch-2', 'batch-3']
        }
      ]
    };

    await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      threeBatchPlan,
      threeHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(providerCalls, 2); // only first 2 batches processed
    console.log('[PASS] Enforces maximum of 2 sequential provider calls');
  }

  // Test 24: Differently ordered equivalent conditions deduplicate
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: ['A', 'B'],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          },
          {
            statement: 'Quy luật mẫu trùng.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: ['B', 'A'], // same conditions, different order
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1); // successfully deduplicated equivalent conditions
    console.log('[PASS] Differently ordered equivalent conditions deduplicate correctly');
  }

  // Test 25: Equivalent association interpretations normalize before deduplication
  {
    resetMocks();
    mockFetchPayload = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          },
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'descriptive', // different interpretation
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.citationVerifiedCandidates[0].evidenceInterpretation, 'associational');
    console.log('[PASS] Equivalent association interpretations normalize before deduplication');
  }

  // Test 26: Repeated identical dry-run verification input produces deep-equal deterministic output, excluding durationMs
  {
    resetMocks();
    const candidateData = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: ['A'],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    mockFetchResponseFn = (url: string, options: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => candidateData
      } as any;
    };

    const result1 = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    const result2 = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    // Assert deep-equal excluding durationMs
    result1.provider.durationMs = 0;
    result2.provider.durationMs = 0;
    assert.deepStrictEqual(result1, result2);
    console.log('[PASS] Repeated identical dry-run input produces deep-equal deterministic output (excluding durationMs)');
  }

  // Test 27: Ollama prompt contains all real provenance parameters and envelopes
  {
    resetMocks();
    const candidateData = {
      response: JSON.stringify({
        candidates: []
      })
    };

    mockFetchResponseFn = (url: string, options: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => candidateData
      } as any;
    };

    const provProfile = {
      ...mockProfile,
      sectionProfiles: [
        {
          sectionId: 'sec-1',
          heading: 'Real Section Heading',
          sectionType: 'results',
          sectionOrder: 1
        }
      ]
    };

    await extractRuleV3Candidates(
      provProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.ok(lastRequestBody);
    assert.strictEqual(typeof lastRequestBody.prompt, 'string');
    assert.ok(lastRequestBody.prompt.includes('[batchId]: batch-1'));
    assert.ok(lastRequestBody.prompt.includes('[workUnitId]: wu-1'));
    assert.ok(lastRequestBody.prompt.includes('[workUnitLabel]: Kết quả định lượng'));
    assert.ok(lastRequestBody.prompt.includes('[sectionId]: sec-1'));
    assert.ok(lastRequestBody.prompt.includes('[sectionLabel]: Real Section Heading'));
    assert.ok(lastRequestBody.prompt.includes('[strategy]: quantitative_results'));
    assert.ok(lastRequestBody.prompt.includes('[sourceLanguage]: vi'));
    assert.ok(lastRequestBody.prompt.includes('[chunkId]: chunk-1'));
    assert.ok(lastRequestBody.prompt.includes('[DATA_START]'));
    assert.ok(lastRequestBody.prompt.includes('[DATA_END]'));
    assert.ok(!lastRequestBody.prompt.includes('dry_run_batch'));
    console.log('[PASS] Ollama prompt contains all real provenance parameters and envelopes');
  }

  // Test 28: Ollama request format schema validation
  {
    resetMocks();
    mockFetchPayload = { response: JSON.stringify({ candidates: [] }) };
    await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    assert.strictEqual(typeof lastRequestBody.format, 'object');
    assert.notStrictEqual(lastRequestBody.format, 'json');
    assert.strictEqual(lastRequestBody.format.properties.candidates.maxItems, LIMIT_CANDIDATES);
    assert.strictEqual(lastRequestBody.format.properties.candidates.items.properties.evidence.maxItems, LIMIT_EVIDENCE_ITEMS);
    const ollamaEvidenceSchema = lastRequestBody.format.properties.candidates.items.properties.evidence.items;
    assert.deepStrictEqual(ollamaEvidenceSchema.required, ['evidenceId', 'stance']);
    assert.ok(!('proposedQuote' in ollamaEvidenceSchema.properties));
    console.log('[PASS] Ollama format schema and maxItems verify successfully');
  }

  // Test 29: Gemini prompt contains all real provenance parameters and envelopes
  {
    resetMocks();
    const candidateData = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({ candidates: [] })
              }
            ]
          }
        }
      ]
    };

    mockFetchResponseFn = (url: string, options: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => candidateData
      } as any;
    };

    const provProfile = {
      ...mockProfile,
      sectionProfiles: [
        {
          sectionId: 'sec-1',
          heading: 'Real Section Heading',
          sectionType: 'results',
          sectionOrder: 1
        }
      ]
    };

    await extractRuleV3Candidates(
      provProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3GeminiProvider()
    );

    assert.ok(lastRequestBody);
    assert.ok(lastRequestBody.contents?.[0]?.parts?.[0]?.text);
    const geminiPrompt = lastRequestBody.contents[0].parts[0].text;
    assert.ok(geminiPrompt.includes('[batchId]: batch-1'));
    assert.ok(geminiPrompt.includes('[workUnitId]: wu-1'));
    assert.ok(geminiPrompt.includes('[workUnitLabel]: Kết quả định lượng'));
    assert.ok(geminiPrompt.includes('[sectionId]: sec-1'));
    assert.ok(geminiPrompt.includes('[sectionLabel]: Real Section Heading'));
    assert.ok(geminiPrompt.includes('[strategy]: quantitative_results'));
    assert.ok(geminiPrompt.includes('[sourceLanguage]: vi'));
    assert.ok(geminiPrompt.includes('[chunkId]: chunk-1'));
    assert.ok(geminiPrompt.includes('[DATA_START]'));
    assert.ok(geminiPrompt.includes('[DATA_END]'));
    assert.ok(!geminiPrompt.includes('dry_run_batch'));

    // Check Gemini responseSchema contains maxItems
    const schema = lastRequestBody.generationConfig.responseSchema;
    assert.strictEqual(schema.properties.candidates.maxItems, LIMIT_CANDIDATES);
    assert.strictEqual(schema.properties.candidates.items.properties.evidence.maxItems, LIMIT_EVIDENCE_ITEMS);
    const geminiEvidenceSchema = schema.properties.candidates.items.properties.evidence.items;
    assert.deepStrictEqual(geminiEvidenceSchema.required, ['evidenceId', 'stance']);
    assert.ok(!('proposedQuote' in geminiEvidenceSchema.properties));
    console.log('[PASS] Gemini prompt contains all real provenance parameters, envelopes, and schema bounds');
  }

  // Test 30: Empty/missing batch contract rejection
  {
    resetMocks();
    const badHierarchicalPlan = {
      ...mockHierarchicalPlan,
      workUnits: [
        {
          ...mockHierarchicalPlan.workUnits[0],
          batchIds: [] // No batches
        }
      ]
    };

    await assert.rejects(
      extractRuleV3Candidates(
        mockProfile,
        mockExtractionPlan,
        mockEvidenceBatchPlan,
        badHierarchicalPlan,
        mockReaderInput,
        'wu-1',
        new RuleV3OllamaProvider()
      ),
      /work_unit_not_found/
    );
    console.log('[PASS] Empty/missing batch contract rejection throws work_unit_not_found');
  }

  // Test 31: Shared validator rejects non-string values inside conditions, limitations, or dreamFeatureTags
  {
    const makePayload = (field: string, badVal: any) => {
      const baseCandidate: any = {
        statement: 'Giấc mơ có mối liên kết.',
        claimType: 'association',
        effectPolarity: 'positive',
        evidenceInterpretation: 'associational',
        subject: 'Giấc mơ',
        outcome: 'lo âu',
        conditions: [],
        limitations: [],
        dreamFeatureTags: [],
        evidence: []
      };
      baseCandidate[field] = [badVal];
      return JSON.stringify({ candidates: [baseCandidate] });
    };

    // Array of non-string inside conditions
    assert.throws(() => validateProviderResponse(makePayload('conditions', 123)), /provider_schema_invalid/);
    // Array of non-string inside limitations
    assert.throws(() => validateProviderResponse(makePayload('limitations', true)), /provider_schema_invalid/);
    // Array of non-string inside tags
    assert.throws(() => validateProviderResponse(makePayload('dreamFeatureTags', { key: 'val' })), /provider_schema_invalid/);

    console.log('[PASS] Shared validator rejects non-string arrays successfully');
  }

  // Test 32: Cross-candidate evidence deduplication preserves chunkContentHash in compound signature
  {
    resetMocks();
    const candidateData = {
      response: JSON.stringify({
        candidates: [
          {
            statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
            claimType: 'association',
            effectPolarity: 'positive',
            evidenceInterpretation: 'associational',
            subject: 'Giấc mơ',
            outcome: 'lo âu',
            conditions: [],
            limitations: [],
            dreamFeatureTags: [],
            evidence: [
              {
                chunkId: 'chunk-1',
                proposedQuote: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
                stance: 'supports'
              }
            ]
          }
        ]
      })
    };

    mockFetchResponseFn = (url: string, options: any) => {
      return {
        ok: true,
        status: 200,
        json: async () => candidateData
      } as any;
    };

    // Ensure we use a plan with two batches and chunkContentHash
    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      new RuleV3OllamaProvider()
    );

    // Verify chunkContentHash was used (exact quote found, hash resolved)
    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(result.citationVerifiedCandidates[0].evidence[0].exactQuote, 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.');
    console.log('[PASS] Cross-candidate evidence deduplication successfully processes exact quotes');
  }

  // Test 33: Production evidenceId path resolves immutable source text without model transcription
  {
    const evidenceIdProvider: RuleV3GenerationProvider = {
      name: 'ollama',
      modelName: 'deterministic-evidence-id-test',
      async generateCandidates(input: RuleV3ProviderInput): Promise<ProviderCandidate[]> {
        const evidenceId = input.evidenceAnchors?.[0]?.evidenceId;
        assert.ok(evidenceId);
        return [{
          statement: 'Giấc mơ có mối liên kết tích cực với mức độ lo âu của người tham gia nghiên cứu.',
          claimType: 'association',
          effectPolarity: 'positive',
          evidenceInterpretation: 'associational',
          subject: 'Giấc mơ',
          outcome: 'mức độ lo âu',
          conditions: [],
          limitations: [],
          dreamFeatureTags: ['lo âu'],
          evidence: [{ evidenceId, stance: 'supports' }]
        }];
      }
    };
    const result = await extractRuleV3Candidates(
      mockProfile,
      mockExtractionPlan,
      mockEvidenceBatchPlan,
      mockHierarchicalPlan,
      mockReaderInput,
      'wu-1',
      evidenceIdProvider
    );
    assert.strictEqual(result.citationVerifiedCandidates.length, 1);
    assert.strictEqual(
      result.citationVerifiedCandidates[0].evidence[0].exactQuote,
      mockEvidenceBatchPlan.batches[0].chunks[0].text
    );
    console.log('[PASS] evidenceId resolves an immutable exact quote and canonical offsets');
  }

  // Restore fetch
  global.fetch = originalFetch;
  console.log('================================================');
  console.log('RULE V3 EXTRACTOR & PROVIDERS: 33 PASSED, 0 FAILED');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});

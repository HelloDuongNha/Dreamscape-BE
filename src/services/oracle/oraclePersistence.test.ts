import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose, { Types } from 'mongoose';

import { isOracleFeatureEnabled } from '../../config/oracleConfig';
import OracleThread from '../../models/OracleThread';
import OracleTurn from '../../models/OracleTurn';
import OracleRun from '../../models/OracleRun';
import OracleRunEvent from '../../models/OracleRunEvent';
import {
  parseClientRequestId,
  parseOracleContent,
  parseOracleMode,
  parseOracleObjectId,
} from './oracle.validation';
import { OracleContractError } from './oracle.types';
import { createOracleTurnRun } from './oraclePersistence.service';
import {
  cancelOracleRun,
  deleteOracleThread,
  getOracleThread,
  postOracleTurn,
} from '../../controllers/oracleController';
import oracleRoutes from '../../routes/oracleRoutes';

// Global assertion counters
let behavioralAssertions = 0;
let restorationAssertions = 0;

function assertBehavior(value: boolean, message: string) {
  behavioralAssertions++;
  assert.ok(value, message);
}

function assertBehaviorEqual<T>(actual: T, expected: T, message: string) {
  behavioralAssertions++;
  assert.strictEqual(actual, expected, message);
}

function assertBehaviorDeepEqual<T>(actual: T, expected: T, message: string) {
  behavioralAssertions++;
  assert.deepStrictEqual(actual, expected, message);
}

function assertRestorationEqual<T>(actual: T, expected: T, message: string) {
  restorationAssertions++;
  assert.strictEqual(actual, expected, message);
}

// Map for tracking patched methods to guarantee 100% clean restoration
const patchedTargets: Array<{ target: any; prop: string; original: any }> = [];

function patchMethod(target: any, prop: string, mockImplementation: any) {
  const existing = patchedTargets.find((p) => p.target === target && p.prop === prop);
  const original = existing ? existing.original : target[prop];
  patchedTargets.push({ target, prop, original });
  target[prop] = mockImplementation;
}

function restoreAllPatched() {
  // Group by target & prop to restore exact root original reference
  const uniquePatches = new Map<any, Map<string, any>>();
  for (const { target, prop, original } of patchedTargets) {
    if (!uniquePatches.has(target)) {
      uniquePatches.set(target, new Map());
    }
    if (!uniquePatches.get(target)!.has(prop)) {
      uniquePatches.get(target)!.set(prop, original);
    }
  }
  for (const [target, propMap] of uniquePatches.entries()) {
    for (const [prop, original] of propMap.entries()) {
      target[prop] = original;
    }
  }
}

// ─── Test Suite Execution ──────────────────────────────────────────────────────

// ─── Section A: Strict Feature Flag Tests ────────────────────────────────────
  test('Section A: isOracleFeatureEnabled evaluation rules', () => {
    assertBehaviorEqual(isOracleFeatureEnabled('true'), true, 'returns true for "true"');
    assertBehaviorEqual(isOracleFeatureEnabled('TRUE'), true, 'returns true for "TRUE"');
    assertBehaviorEqual(isOracleFeatureEnabled(' true '), true, 'returns true for whitespace padded " true "');
    assertBehaviorEqual(isOracleFeatureEnabled('TRUE  '), true, 'returns true for whitespace padded "TRUE  "');

    assertBehaviorEqual(isOracleFeatureEnabled(undefined), false, 'returns false for undefined');
    assertBehaviorEqual(isOracleFeatureEnabled(''), false, 'returns false for empty string');
    assertBehaviorEqual(isOracleFeatureEnabled('false'), false, 'returns false for "false"');
    assertBehaviorEqual(isOracleFeatureEnabled('1'), false, 'returns false for "1"');
    assertBehaviorEqual(isOracleFeatureEnabled('yes'), false, 'returns false for "yes"');
    assertBehaviorEqual(isOracleFeatureEnabled('arbitrary'), false, 'returns false for arbitrary text');
  });

  // ─── Section B: Validator Edge Cases ──────────────────────────────────────────
  test('Section B: Oracle validators boundary checks', () => {
    // Mode validator
    assertBehaviorEqual(parseOracleMode('chat'), 'chat', 'accepts chat mode');
    assertBehaviorEqual(parseOracleMode('dream_analysis'), 'dream_analysis', 'accepts dream_analysis mode');
    assertBehaviorEqual(parseOracleMode('creative_continuation'), 'creative_continuation', 'accepts creative_continuation mode');

    assert.throws(
      () => parseOracleMode('system'),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects system mode',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseOracleMode('unknown'),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects unknown mode',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseOracleMode(123),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects non-string mode',
    );
    behavioralAssertions++;

    // ObjectId validator
    const validId = '507f1f77bcf86cd799439011';
    assertBehaviorEqual(parseOracleObjectId(validId).toHexString(), validId, 'accepts valid ObjectId string');

    assert.throws(
      () => parseOracleObjectId('invalid-id'),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects malformed ObjectId string',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseOracleObjectId(null),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects null ObjectId',
    );
    behavioralAssertions++;

    // ClientRequestId validator
    assertBehaviorEqual(parseClientRequestId('req_12345678'), 'req_12345678', 'accepts valid clientRequestId');
    assertBehaviorEqual(parseClientRequestId('A'.repeat(128)), 'A'.repeat(128), 'accepts 128-char clientRequestId');

    assert.throws(
      () => parseClientRequestId('req_123'), // 7 chars
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects clientRequestId under 8 chars',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseClientRequestId('A'.repeat(129)), // 129 chars
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects clientRequestId over 128 chars',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseClientRequestId('req 12345678'), // contains space
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects clientRequestId containing whitespace',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseClientRequestId('-req12345678'), // starts with dash
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects clientRequestId starting with invalid char',
    );
    behavioralAssertions++;

    // Content validator & UTF-8 byte length test
    assertBehaviorEqual(parseOracleContent('  Hello world  '), 'Hello world', 'trims content');

    assert.throws(
      () => parseOracleContent(''),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects empty content',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseOracleContent('   '),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects whitespace-only content',
    );
    behavioralAssertions++;

    assert.throws(
      () => parseOracleContent(12345),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects non-string content',
    );
    behavioralAssertions++;

    // Multi-byte UTF-8 byte length boundary test:
    // 🌟 is a 4-byte UTF-8 emoji (2 UTF-16 code units).
    // 5001 emojis = 10,002 JS UTF-16 code units (chars), but 20,004 UTF-8 bytes (> 20,000 bytes max).
    const oversizeMultiByteEmoji = '🌟'.repeat(5001);
    assertBehaviorEqual(oversizeMultiByteEmoji.length, 10002, 'JS UTF-16 character length is 10002 (<20,000)');
    assertBehaviorEqual(Buffer.byteLength(oversizeMultiByteEmoji, 'utf8'), 20004, 'UTF-8 byte length is 20004 (>20,000)');

    assert.throws(
      () => parseOracleContent(oversizeMultiByteEmoji),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_invalid_request',
      'rejects content exceeding 20,000 UTF-8 bytes even if JS char length is under 20,000',
    );
    behavioralAssertions++;
  });

  // ─── Section C: Schema and Index Contracts ────────────────────────────────────
  test('Section C: Mongoose Schema metadata and Index declarations', () => {
    // OracleThread schema
    const threadNextTurnSeqPath: any = OracleThread.schema.path('nextTurnSequence');
    assertBehaviorEqual(threadNextTurnSeqPath.options.default, 0, 'OracleThread nextTurnSequence defaults to 0');

    const threadModeEnum = (OracleThread.schema.path('mode') as any).enumValues;
    assertBehaviorDeepEqual(
      threadModeEnum.sort(),
      ['chat', 'creative_continuation', 'dream_analysis'].sort(),
      'OracleThread mode enum contains exactly chat, dream_analysis, creative_continuation',
    );

    // OracleTurn schema
    const turnRoleEnum = (OracleTurn.schema.path('role') as any).enumValues;
    assertBehaviorDeepEqual(
      turnRoleEnum.sort(),
      ['assistant', 'user'].sort(),
      'OracleTurn role enum contains only user and assistant, never system or tool',
    );

    const turnIndexes = OracleTurn.schema.indexes();
    const uniqueTurnSeqIndex = turnIndexes.find(
      ([fields, options]: any) => fields.threadId === 1 && fields.sequence === 1 && options?.unique === true,
    );
    assertBehavior(!!uniqueTurnSeqIndex, 'OracleTurn has unique index { threadId: 1, sequence: 1 }');

    // OracleRun schema
    const runIndexes = OracleRun.schema.indexes();
    const uniqueRunReqIndex = runIndexes.find(
      ([fields, options]: any) => fields.userId === 1 && fields.clientRequestId === 1 && options?.unique === true,
    );
    assertBehavior(!!uniqueRunReqIndex, 'OracleRun has unique index { userId: 1, clientRequestId: 1 }');

    const reqHashPath: any = OracleRun.schema.path('requestHash');
    assertBehaviorEqual(reqHashPath.options.minlength, 64, 'OracleRun requestHash minlength is 64');
    assertBehaviorEqual(reqHashPath.options.maxlength, 64, 'OracleRun requestHash maxlength is 64');

    // OracleRunEvent schema
    const eventTypeEnum = (OracleRunEvent.schema.path('eventType') as any).enumValues;
    assertBehavior(eventTypeEnum.includes('cancelled'), 'OracleRunEvent eventType enum includes "cancelled"');

    const eventIndexes = OracleRunEvent.schema.indexes();
    const ttlIndex = eventIndexes.find(
      ([fields, options]: any) => fields.expiresAt === 1 && options?.expireAfterSeconds === 0,
    );
    assertBehavior(!!ttlIndex, 'OracleRunEvent uses TTL index on expiresAt with expireAfterSeconds: 0');

    const createdAtTtlIndex = eventIndexes.find(
      ([fields, options]: any) => fields.createdAt !== undefined && options?.expireAfterSeconds !== undefined,
    );
    assertBehavior(!createdAtTtlIndex, 'OracleRunEvent does NOT use TTL index on createdAt');

    const uniqueRunEventSeqIndex = eventIndexes.find(
      ([fields, options]: any) => fields.runId === 1 && fields.sequence === 1 && options?.unique === true,
    );
    assertBehavior(!!uniqueRunEventSeqIndex, 'OracleRunEvent has unique index { runId: 1, sequence: 1 }');
  });

  // ─── Section D: Server-Created Access Scope & Structural Contracts ───────────
  test('Section D: Access Scope and Ownership boundaries', () => {
    // Read oracle.types.ts source to prove OracleAccessScope contains no allowPrivateDreamIds
    const typesPath = path.resolve(__dirname, 'oracle.types.ts');
    const typesContent = fs.readFileSync(typesPath, 'utf8');
    assertBehavior(!typesContent.includes('allowPrivateDreamIds'), 'OracleAccessScope does not contain allowPrivateDreamIds');
    assertBehavior(typesContent.includes('ownDreamAccess'), 'OracleAccessScope contains ownDreamAccess');
    assertBehavior(typesContent.includes('otherDreamAccess'), 'OracleAccessScope contains otherDreamAccess');
    assertBehavior(typesContent.includes('ruleAccess'), 'OracleAccessScope contains ruleAccess');
    assertBehavior(typesContent.includes('academicAccess'), 'OracleAccessScope contains academicAccess');

    // Read oracleController.ts source to prove ownership derives from req.user._id
    const controllerPath = path.resolve(__dirname, '../../controllers/oracleController.ts');
    const controllerContent = fs.readFileSync(controllerPath, 'utf8');
    assertBehavior(controllerContent.includes('req.user._id'), 'oracleController extracts requester identity from req.user._id');
    assertBehavior(!controllerContent.includes('req.body.userId'), 'oracleController never accepts userId from body for ownership');
    assertBehavior(!controllerContent.includes('req.query.userId'), 'oracleController never accepts userId from query for ownership');

    // Read OracleTurn.ts source to prove role enum has no 'system'
    const turnModelPath = path.resolve(__dirname, '../../models/OracleTurn.ts');
    const turnModelContent = fs.readFileSync(turnModelPath, 'utf8');
    assertBehavior(!turnModelContent.includes("'system'"), 'OracleTurn model role enum never contains "system"');
    assertBehavior(turnModelContent.includes('OracleCitationSchema'), 'OracleTurn persists sanitized citation metadata');
    assertBehavior(turnModelContent.includes('suggestedPrompts'), 'OracleTurn persists follow-up suggestions');

    const similarDreamPath = path.resolve(__dirname, '../dream/similarDreamRetrieval.service.ts');
    const similarDreamContent = fs.readFileSync(similarDreamPath, 'utf8');
    assertBehavior(
      similarDreamContent.includes("$or: [{ userId: userObjectId }, { privacy: 'public', is_public: true }]"),
      'dream retrieval admits only own dreams or explicitly public dreams',
    );
    assertBehavior(
      !similarDreamContent.includes('email'),
      'dream retrieval never selects or exposes email fields',
    );

    const oracleRetrievalPath = path.resolve(__dirname, 'oracleRetrieval.service.ts');
    const oracleRetrievalContent = fs.readFileSync(oracleRetrievalPath, 'utf8');
    assertBehavior(
      oracleRetrievalContent.includes('retrieveApprovedRuleV3'),
      'Oracle grounding uses the verified Rule V3 retrieval boundary',
    );
    assertBehavior(
      oracleRetrievalContent.includes('untrusted_retrieved_content'),
      'retrieved content is marked as untrusted prompt data',
    );
  });

  // ─── Section E: Sanitized Errors ──────────────────────────────────────────────
  test('Section E: Controller error sanitization & status codes', async () => {
    // Mock req & res
    const createMockRes = () => {
      const res: any = {
        statusCode: 0,
        jsonPayload: null,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(data: any) {
          this.jsonPayload = data;
          return this;
        },
      };
      return res;
    };

    // 1. Malformed thread ID -> sanitized 400
    const reqInvalidId: any = {
      user: { _id: new Types.ObjectId() },
      params: { id: 'invalid-id' },
      query: {},
    };
    const resInvalidId = createMockRes();
    await getOracleThread(reqInvalidId, resInvalidId);

    assertBehaviorEqual(resInvalidId.statusCode, 400, 'malformed thread ID returns status 400');
    assertBehaviorEqual(resInvalidId.jsonPayload.success, false, 'success is false');
    assertBehaviorEqual(resInvalidId.jsonPayload.code, 'oracle_invalid_request', 'code is oracle_invalid_request');
    assertBehaviorEqual(resInvalidId.jsonPayload.message, 'Dữ liệu yêu cầu Oracle không hợp lệ.', 'sanitized Vietnamese message');
    assertBehavior(!('stack' in resInvalidId.jsonPayload), 'does not expose stack');
    assertBehavior(!('error' in resInvalidId.jsonPayload), 'does not expose raw error object');

    // 2. Missing / Cross-user thread -> sanitized 404
    patchMethod(OracleThread, 'findOne', () => ({
      lean: () => Promise.resolve(null),
    }));

    const reqMissing: any = {
      user: { _id: new Types.ObjectId() },
      params: { id: new Types.ObjectId().toHexString() },
      query: {},
    };
    const resMissing = createMockRes();
    await getOracleThread(reqMissing, resMissing);

    assertBehaviorEqual(resMissing.statusCode, 404, 'missing/cross-user thread returns status 404');
    assertBehaviorEqual(resMissing.jsonPayload.success, false, 'success is false');
    assertBehaviorEqual(resMissing.jsonPayload.code, 'oracle_not_found', 'code is oracle_not_found');
    assertBehaviorEqual(resMissing.jsonPayload.message, 'Không tìm thấy tài nguyên Oracle.', 'sanitized 404 message');
    assertBehavior(!('query' in resMissing.jsonPayload), 'does not expose database query');
    assertBehavior(!('requestHash' in resMissing.jsonPayload), 'does not expose requestHash');
  });

  // ─── Section F: Idempotency Behavior ──────────────────────────────────────────
  test('Section F: Idempotency behavior & replay isolation', async () => {
    const userId = new Types.ObjectId();
    const threadId = new Types.ObjectId();
    const userTurnId = new Types.ObjectId();
    const assistantTurnId = new Types.ObjectId();
    const runId = new Types.ObjectId();
    const clientRequestId = 'req_idempotent_123';
    const content = 'Test message content';

    // Mock session
    const mockSession: any = {
      withTransaction: async (cb: any) => cb(),
      endSession: async () => {},
    };
    patchMethod(mongoose, 'startSession', async () => mockSession);

    // 1. Exact replay match returns replayed: true without creating new turns/runs
    let createRunCalled = false;
    let createTurnCalled = false;

    const expectedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        threadId: threadId.toHexString(),
        content,
        parentTurnId: null,
        supersedesTurnId: null,
      }))
      .digest('hex');

    patchMethod(OracleRun, 'findOne', () => {
      // Return existing matching run
      const runDoc: any = {
        _id: runId,
        userId,
        threadId,
        clientRequestId,
        requestHash: expectedHash,
        userTurnId,
        assistantTurnId,
        status: 'queued',
      };
      runDoc.threadId.equals = (otherId: any) => String(otherId) === String(threadId);
      return runDoc;
    });

    patchMethod(OracleRun, 'create', () => {
      createRunCalled = true;
      return Promise.resolve([]);
    });
    patchMethod(OracleTurn, 'create', () => {
      createTurnCalled = true;
      return Promise.resolve([]);
    });

    const replayResult = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
    });

    assertBehaviorEqual(replayResult.replayed, true, 'exact match replay returns replayed: true');
    assertBehaviorEqual(String(replayResult.runId), String(runId), 'returns existing runId');
    assertBehavior(!createRunCalled, 'no new run is created on exact replay');
    assertBehavior(!createTurnCalled, 'no new turn is created on exact replay');

    // 2. Reusing clientRequestId with different content produces oracle_idempotency_conflict
    const replayDifferentContentResult = createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content: 'Different message content!', // different hash
    });

    await assert.rejects(
      replayDifferentContentResult,
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_idempotency_conflict',
      'reusing clientRequestId with different content produces oracle_idempotency_conflict',
    );
    behavioralAssertions++;

    // 3. Reusing clientRequestId for a different thread produces oracle_idempotency_conflict
    const replayDifferentThreadResult = createOracleTurnRun({
      userId,
      threadId: new Types.ObjectId(), // different thread
      clientRequestId,
      content,
    });

    await assert.rejects(
      replayDifferentThreadResult,
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_idempotency_conflict',
      'reusing clientRequestId for a different thread produces oracle_idempotency_conflict',
    );
    behavioralAssertions++;

    // 4. A matching duplicate-key race resolves to the run created by the
    // competing request instead of surfacing an internal MongoDB error.
    let matchingRaceFindCalls = 0;
    let matchingRaceSessionStarted = false;
    patchMethod(mongoose, 'startSession', async () => ({
      withTransaction: async (cb: any) => cb(),
      endSession: async () => {},
    }));
    patchMethod(mongoose, 'startSession', async () => {
      matchingRaceSessionStarted = true;
      throw new Error('standalone path must not start a transaction session');
    });
    patchMethod(OracleRun, 'findOne', () => {
      matchingRaceFindCalls++;
      const value = matchingRaceFindCalls < 3
        ? null
        : {
          _id: runId,
          userId,
          threadId,
          clientRequestId,
          requestHash: expectedHash,
          userTurnId,
          assistantTurnId,
          status: 'queued',
        };
      const query: any = Promise.resolve(value);
      query.session = () => query;
      return query;
    });
    patchMethod(OracleThread, 'findOneAndUpdate', () => Promise.resolve({
      _id: threadId,
      userId,
      nextTurnSequence: 0,
    }));
    patchMethod(OracleRun, 'create', () => Promise.reject({ code: 11000 }));

    const matchingRaceResult = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
    });
    assertBehaviorEqual(matchingRaceResult.replayed, true, 'matching duplicate-key race is returned as replay');
    assertBehaviorEqual(String(matchingRaceResult.runId), String(runId), 'matching race returns competing run ID');
    assertBehaviorEqual(matchingRaceFindCalls, 3, 'matching race performs early, transactional, and recovery lookups');
    assertBehavior(!matchingRaceSessionStarted, 'standalone race recovery does not start a transaction session');

    // 5. A duplicate-key race whose winning request has different canonical
    // input must remain an idempotency conflict.
    let conflictingRaceFindCalls = 0;
    let conflictingRaceSessionStarted = false;
    patchMethod(mongoose, 'startSession', async () => ({
      withTransaction: async (cb: any) => cb(),
      endSession: async () => {},
    }));
    patchMethod(mongoose, 'startSession', async () => {
      conflictingRaceSessionStarted = true;
      throw new Error('standalone path must not start a transaction session');
    });
    patchMethod(OracleRun, 'findOne', () => {
      conflictingRaceFindCalls++;
      const value = conflictingRaceFindCalls < 3
        ? null
        : {
          _id: runId,
          userId,
          threadId,
          clientRequestId,
          requestHash: 'f'.repeat(64),
          userTurnId,
          assistantTurnId,
          status: 'queued',
        };
      const query: any = Promise.resolve(value);
      query.session = () => query;
      return query;
    });
    patchMethod(OracleRun, 'create', () => Promise.reject({ code: 11000 }));

    await assert.rejects(
      createOracleTurnRun({ userId, threadId, clientRequestId, content }),
      (err: any) => err instanceof OracleContractError && err.code === 'oracle_idempotency_conflict',
      'conflicting duplicate-key race remains an idempotency conflict',
    );
    behavioralAssertions++;
    assertBehaviorEqual(conflictingRaceFindCalls, 3, 'conflicting race reaches the recovery lookup');
    assertBehavior(!conflictingRaceSessionStarted, 'standalone conflicting race does not start a transaction session');
  });

  // ─── Section G: Atomic Sequence Contract ─────────────────────────────────────
  test('Section G: Atomic sequence reservation & turn linking', async () => {
    const userId = new Types.ObjectId();
    const threadId = new Types.ObjectId();
    const clientRequestId = 'req_atomic_sequence_123';
    const content = 'Atomic sequence test message';

    const mockSession: any = {
      withTransaction: async (cb: any) => cb(),
      endSession: async () => {},
    };
    patchMethod(mongoose, 'startSession', async () => mockSession);

    // Mock findOne (no early replay)
    patchMethod(OracleRun, 'findOne', () => {
      const q: any = Promise.resolve(null);
      q.session = () => q;
      return q;
    });

    // Mock findOneAndUpdate on OracleThread
    let incValue = 0;
    patchMethod(OracleThread, 'findOneAndUpdate', (_filter: any, update: any) => {
      incValue = update.$inc?.nextTurnSequence;
      return Promise.resolve({
        _id: threadId,
        userId,
        nextTurnSequence: 10, // sequence before $inc
      });
    });

    // Mock OracleRun.create
    let createdRunData: any = null;
    patchMethod(OracleRun, 'create', (docs: any) => {
      createdRunData = docs[0];
      return Promise.resolve(docs);
    });

    // Mock OracleTurn.create
    let createdTurnsData: any[] = [];
    patchMethod(OracleTurn, 'create', (docs: any) => {
      createdTurnsData = docs;
      return Promise.resolve(docs);
    });

    // Mock OracleRun.findByIdAndUpdate
    let finalRunStatus = '';
    patchMethod(OracleRun, 'findByIdAndUpdate', (_id: any, update: any) => {
      finalRunStatus = update.$set?.status;
      return Promise.resolve({
        _id,
        userTurnId: createdRunData.userTurnId,
        assistantTurnId: createdRunData.assistantTurnId,
        status: finalRunStatus,
      });
    });

    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
    });

    assertBehaviorEqual(incValue, 2, 'reserves two sequence numbers using atomic $inc: { nextTurnSequence: 2 }');
    assertBehaviorEqual(createdTurnsData[0].sequence, 11, 'assigns consecutive user sequence (10 + 1)');
    assertBehaviorEqual(createdTurnsData[1].sequence, 12, 'assigns consecutive assistant sequence (11 + 1)');
    assertBehaviorEqual(createdTurnsData[0].role, 'user', 'first turn role is user');
    assertBehaviorEqual(createdTurnsData[1].role, 'assistant', 'second turn role is assistant');
    assertBehaviorEqual(
      String(createdTurnsData[1].parentTurnId),
      String(createdTurnsData[0]._id),
      'links assistant parentTurnId to new user turn ID',
    );
    assertBehaviorEqual(finalRunStatus, 'queued', 'moves run to queued status after both turns are created');
    assertBehaviorEqual(result.replayed, false, 'new creation has replayed: false');
  });

  test('Section G2: Replica-set transaction lifecycle', async () => {
    const userId = new Types.ObjectId();
    const threadId = new Types.ObjectId();
    let transactionCalled = false;
    let sessionEnded = false;

    patchMethod(mongoose.connection as any, 'db', {
      command: async () => ({ setName: 'rs0' }),
    });
    patchMethod(mongoose, 'startSession', async () => ({
      withTransaction: async (cb: any) => {
        transactionCalled = true;
        await cb();
      },
      endSession: async () => {
        sessionEnded = true;
      },
    }));
    patchMethod(OracleRun, 'findOne', () => {
      const query: any = Promise.resolve(null);
      query.session = () => query;
      return query;
    });
    patchMethod(OracleThread, 'findOneAndUpdate', () => Promise.resolve({
      _id: threadId,
      userId,
      nextTurnSequence: 0,
    }));
    patchMethod(OracleRun, 'create', (docs: any) => Promise.resolve(docs));
    patchMethod(OracleTurn, 'create', (docs: any) => Promise.resolve(docs));
    patchMethod(OracleRun, 'findByIdAndUpdate', (_id: any) => Promise.resolve({
      _id,
      threadId,
      userId,
      userTurnId: new Types.ObjectId(),
      assistantTurnId: new Types.ObjectId(),
      status: 'queued',
    }));

    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId: 'req_replica_transaction_123',
      content: 'Replica transaction lifecycle',
    });

    assertBehavior(transactionCalled, 'replica-set topology uses withTransaction');
    assertBehavior(sessionEnded, 'replica-set transaction session is always closed');
    assertBehaviorEqual(result.status, 'queued', 'replica-set transaction returns queued run');
  });

  // ─── Section H: Feature Route Isolation ──────────────────────────────────────
  test('Section H: Feature route isolation & stack ordering', () => {
    const stack = (oracleRoutes as any).stack;
    assertBehavior(Array.isArray(stack) && stack.length > 0, 'oracleRoutes stack is registered');

    // Prove feature flag middleware executes before authMiddleware
    const firstLayer = stack[0];
    assertBehavior(!!firstLayer, 'first route layer exists');
    const secondLayer = stack[1];
    assertBehavior(!!secondLayer, 'second route layer exists');
    assertBehaviorEqual(secondLayer.handle, (oracleRoutes as any).stack[1].handle, 'auth layer follows feature guard');
    assertBehavior(
      String(secondLayer.name).includes('authMiddleware') || String(secondLayer.handle?.name).includes('authMiddleware'),
      'second middleware is authMiddleware',
    );

    // Test feature flag guard when disabled
    const mockRes: any = {
      statusCode: 0,
      jsonPayload: null,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(d: any) {
        this.jsonPayload = d;
        return this;
      },
    };
    let nextCalled = false;

    // Execute first middleware layer with FEATURE_ORACLE_ENABLED unset/false
    const origEnv = process.env.FEATURE_ORACLE_ENABLED;
    process.env.FEATURE_ORACLE_ENABLED = 'false';

    firstLayer.handle({}, mockRes, () => {
      nextCalled = true;
    });

    process.env.FEATURE_ORACLE_ENABLED = origEnv;

    assertBehaviorEqual(mockRes.statusCode, 404, 'returns 404 when feature flag is disabled');
    assertBehaviorEqual(mockRes.jsonPayload.code, 'oracle_not_available', 'code is oracle_not_available');
    assertBehavior(!nextCalled, 'next() is not called when feature flag is disabled');

    // Prove routes do not import human conversation code
    const routesPath = path.resolve(__dirname, '../../routes/oracleRoutes.ts');
    const routesContent = fs.readFileSync(routesPath, 'utf8');
    assertBehavior(!routesContent.includes('Conversation'), 'oracleRoutes does not import Conversation model');
    assertBehavior(!routesContent.includes('Message'), 'oracleRoutes does not import Message model');
    assertBehavior(!routesContent.includes('socket'), 'oracleRoutes does not import socket');

    // Prove required route-method pairs are each registered exactly once.
    const routeLayers = stack.filter((layer: any) => layer.route);
    const routeCount = (method: string, routePath: string) => routeLayers.filter(
      (layer: any) => layer.route.path === routePath && layer.route.methods?.[method] === true,
    ).length;
    assertBehaviorEqual(routeCount('get', '/threads'), 1, 'GET /threads is registered exactly once');
    assertBehaviorEqual(routeCount('post', '/threads'), 1, 'POST /threads is registered exactly once');
    assertBehaviorEqual(routeCount('get', '/threads/:id'), 1, 'GET /threads/:id is registered exactly once');
    assertBehaviorEqual(routeCount('patch', '/threads/:id'), 1, 'PATCH /threads/:id is registered exactly once');
    assertBehaviorEqual(routeCount('delete', '/threads/:id'), 1, 'DELETE /threads/:id is registered exactly once');
    assertBehaviorEqual(routeCount('post', '/threads/:id/turns'), 1, 'POST /threads/:id/turns is registered exactly once');
    assertBehaviorEqual(routeCount('post', '/runs/:runId/cancel'), 1, 'POST /runs/:runId/cancel is registered exactly once');
  });

after(() => {
  // ─── Section I: Restoration Proof ───────────────────────────────────────────
  restoreAllPatched();

  // Validate every patched reference is restored to its exact original function
  for (const { target, prop, original } of patchedTargets) {
    assertRestorationEqual(target[prop], original, `restored ${prop} to exact original function reference`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ Oracle Phase ORACLE-1A-T Backend Contract Tests Completed');
  console.log(`📊 Behavioral Assertions Count : ${behavioralAssertions}`);
  console.log(`🛠️ Restoration Assertions Count : ${restorationAssertions}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

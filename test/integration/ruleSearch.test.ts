import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import User from '../../src/modules/identity/models/User';
import KnowledgeRuleV3 from '../../src/modules/rules_v3/models/KnowledgeRule';
import {
  buildRuleV3NameRegex,
  parseRuleV3CandidateQuery,
} from '../../src/modules/rules_v3/dto/ruleV3Request.dto';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const databaseUri = new URL(process.env.MONGODB_TEST_URI!);
  databaseUri.pathname = '/dreamscape_rule_search_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'rule-search-integration-secret';
  await connectTestDatabase();
  server = http.createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (!databaseConfigured) return;
  delete process.env.MODERATOR_USER_IDS;
  await Promise.all([
    KnowledgeRuleV3.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    KnowledgeRuleV3.deleteMany({}),
    User.deleteMany({}),
  ]);
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await disconnectTestDatabase();
});

test('rule name query normalization is bounded and regex punctuation remains literal', () => {
  assert.deepEqual(parseRuleV3CandidateQuery({ q: '  future   (event)  ' }), {
    status: 'pending',
    sourceId: null,
    nameQuery: 'future (event)',
    validationError: null,
  });
  const matcher = buildRuleV3NameRegex('future (event)');
  assert.equal(matcher.test('A Future   (event) can appear in dreams.'), true);
  assert.equal(matcher.test('A future event can appear in dreams.'), false);
  assert.equal(
    parseRuleV3CandidateQuery({ q: 'x'.repeat(121) }).validationError,
    'name_query_too_long',
  );
});

test('moderator rule search combines name and status while non-moderators remain forbidden', { skip: !databaseConfigured }, async () => {
  const moderatorSessionId = new mongoose.Types.ObjectId();
  const viewerSessionId = new mongoose.Types.ObjectId();
  const moderator = await createUser('@rule_search_mod', 'rule-search-mod@example.test', moderatorSessionId);
  const viewer = await createUser('@rule_search_viewer', 'rule-search-viewer@example.test', viewerSessionId);
  process.env.MODERATOR_USER_IDS = String(moderator._id);

  await KnowledgeRuleV3.create([
    ruleFixture('Future (event) incorporation in dreams', 'pending', '1'),
    ruleFixture('Past memory incorporation in dreams', 'pending', '2'),
    ruleFixture('Future (event) incorporation after review', 'verified', '3'),
  ]);

  const forbidden = await getJson(
    '/api/moderation/rules-v3/candidates?q=future',
    tokenFor(viewer._id, viewerSessionId),
  );
  assert.equal(forbidden.status, 403);

  const pending = await getJson(
    '/api/moderation/rules-v3/candidates?status=pending&q=FUTURE%20(event)',
    tokenFor(moderator._id, moderatorSessionId),
  );
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.body.data.map((rule: { label: string }) => rule.label), [
    'Future (event) incorporation in dreams',
  ]);

  const approved = await getJson(
    '/api/moderation/rules-v3/candidates?status=approved&q=future',
    tokenFor(moderator._id, moderatorSessionId),
  );
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body.data.map((rule: { label: string }) => rule.label), [
    'Future (event) incorporation after review',
  ]);
});

function ruleFixture(statement: string, status: 'pending' | 'verified', suffix: string) {
  return {
    statement,
    status,
    sourceLanguage: 'en',
    claimType: 'association',
    effectPolarity: 'positive',
    evidenceInterpretation: 'associational',
    subject: 'dream content',
    outcome: 'memory incorporation',
    conditions: [],
    limitations: [],
    dreamFeatureTags: [],
    classifications: [],
    dedupKey: suffix.repeat(64),
    evidenceScore: 20,
    certaintyTier: 'weak',
    supportingSourceCount: 0,
    contradictingSourceCount: 0,
    version: 1,
    isComposite: false,
    compositeComponents: [],
    mergedFromRuleIds: [],
  };
}

async function createUser(
  username: string,
  email: string,
  sessionId: mongoose.Types.ObjectId,
) {
  return User.create({
    username,
    display_name: username,
    email,
    password: 'CurrentPass9',
    sessions: [{ _id: sessionId, lastActive: new Date(), authenticatedAt: new Date() }],
  });
}

function tokenFor(userId: unknown, sessionId: mongoose.Types.ObjectId): string {
  return jwt.sign(
    { id: String(userId), sessionId: String(sessionId) },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  );
}

async function getJson(path: string, token: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

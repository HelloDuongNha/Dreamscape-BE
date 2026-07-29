import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import Dream from '../../src/modules/dream/models/Dream';
import User from '../../src/modules/identity/models/User';
import Comment from '../../src/modules/social/models/Comment';
import { findLiteralSearchRanges } from '../../src/modules/dream/services/content/dreamSearch.service';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const databaseUri = new URL(process.env.MONGODB_TEST_URI!);
  databaseUri.pathname = '/dreamscape_dream_search_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'dream-search-integration-secret';
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
  await Promise.all([
    Comment.deleteMany({}),
    Dream.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    Comment.deleteMany({}),
    Dream.deleteMany({}),
    User.deleteMany({}),
  ]);
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await disconnectTestDatabase();
});

test('literal search ranges preserve original text indices and regex punctuation', () => {
  const text = 'Nhà ga (lớn) rồi lại thành nhà ga (lớn).';
  const ranges = findLiteralSearchRanges(text, 'nhà ga (lớn)');
  assert.deepEqual(
    ranges.map(range => text.slice(range.start, range.end)),
    ['Nhà ga (lớn)', 'nhà ga (lớn)'],
  );
});

test('dream search combines visible dream and active comment matches without leaking private content', { skip: !databaseConfigured }, async () => {
  const ownerSessionId = new mongoose.Types.ObjectId();
  const viewerSessionId = new mongoose.Types.ObjectId();
  const owner = await createUser('@search_owner', 'search-owner@example.test', ownerSessionId);
  const viewer = await createUser('@search_viewer', 'search-viewer@example.test', viewerSessionId);

  const publicDream = await Dream.create({
    userId: owner._id,
    content: 'Nhà ga chuyển thành một hành lang trường học.',
    is_public: true,
    privacy: 'public',
    ai_result: { emotional_tone_key: 'calm' },
  });
  const secondPublicDream = await Dream.create({
    userId: owner._id,
    content: 'Một nhà ga khác xuất hiện gần sáng.',
    is_public: true,
    privacy: 'public',
    ai_result: { emotional_valence: -1, emotional_tone_key: 'calm' },
  });
  const privateDream = await Dream.create({
    userId: owner._id,
    content: 'Nhà ga bí mật chỉ chủ bài được xem.',
    is_public: false,
    privacy: 'private',
  });
  const mixedDream = await Dream.create({
    userId: owner._id,
    content: 'Một khung cảnh không liên quan.',
    is_public: true,
    privacy: 'public',
    ai_result: { emotional_valence: 0 },
  });
  const veryNegativeDream = await Dream.create({
    userId: owner._id,
    content: 'Một giấc mơ đáng sợ.',
    is_public: true,
    privacy: 'public',
    ai_result: { emotional_tone_key: 'fearful' },
  });
  const veryPositiveDream = await Dream.create({
    userId: owner._id,
    content: 'Một giấc mơ rất vui.',
    is_public: true,
    privacy: 'public',
    ai_result: { emotional_valence: 2 },
  });
  await Comment.create([
    {
      dreamId: publicDream._id,
      userId: viewer._id,
      content: 'Tôi cũng chú ý tới chiếc cặp khóa trong đoạn này.',
    },
    {
      dreamId: publicDream._id,
      userId: viewer._id,
      content: 'Nhà ga cũng xuất hiện trong bình luận này.',
    },
    {
      dreamId: publicDream._id,
      userId: viewer._id,
      content: 'Chiếc cặp khóa đã bị xóa.',
      is_deleted: true,
    },
    {
      dreamId: privateDream._id,
      userId: owner._id,
      content: 'Chiếc cặp khóa riêng tư không được lộ.',
    },
  ]);

  const commentSearch = await getJson('/api/dreams/search?q=chi%E1%BA%BFc%20c%E1%BA%B7p');
  assert.equal(commentSearch.status, 200);
  assert.equal(commentSearch.body.data.length, 1);
  assert.equal(commentSearch.body.data[0].dream._id, String(publicDream._id));
  assert.equal(commentSearch.body.data[0].matchedCommentCount, 1);
  assert.deepEqual(
    commentSearch.body.data[0].matchedComments.map((comment: any) => comment.content),
    ['Tôi cũng chú ý tới chiếc cặp khóa trong đoạn này.'],
  );
  assert.deepEqual(
    commentSearch.body.data[0].matchedComments[0].ranges.map(
      (range: { start: number; end: number }) =>
        commentSearch.body.data[0].matchedComments[0].content.slice(range.start, range.end),
    ),
    ['chiếc cặp'],
  );

  const guestSearch = await getJson('/api/dreams/search?q=nh%C3%A0%20ga');
  assert.equal(guestSearch.status, 200);
  assert.deepEqual(
    new Set(guestSearch.body.data.map((item: any) => item.dream._id)),
    new Set([String(publicDream._id), String(secondPublicDream._id)]),
  );
  assert.equal(
    guestSearch.body.data.filter((item: any) => item.dream._id === String(publicDream._id)).length,
    1,
  );
  assert.equal(
    guestSearch.body.data.find((item: any) => item.dream._id === String(publicDream._id))
      .matchedCommentCount,
    1,
  );

  const ownerSearch = await getJson(
    '/api/dreams/search?q=nh%C3%A0%20ga',
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(ownerSearch.status, 200);
  assert.deepEqual(
    new Set(ownerSearch.body.data.map((item: any) => item.dream._id)),
    new Set([String(publicDream._id), String(secondPublicDream._id), String(privateDream._id)]),
  );

  const viewerSearch = await getJson(
    '/api/dreams/search?q=b%C3%AD%20m%E1%BA%ADt',
    tokenFor(viewer._id, viewerSessionId),
  );
  assert.equal(viewerSearch.status, 200);
  assert.deepEqual(viewerSearch.body.data, []);

  const positiveMood = await getJson('/api/dreams/search?mood=positive');
  assert.deepEqual(
    positiveMood.body.data.map((item: any) => item.dream._id),
    [String(publicDream._id)],
  );
  const negativeMood = await getJson('/api/dreams/search?mood=negative');
  assert.deepEqual(
    negativeMood.body.data.map((item: any) => item.dream._id),
    [String(secondPublicDream._id)],
  );
  const mixedMood = await getJson('/api/dreams/search?mood=mixed');
  assert.deepEqual(mixedMood.body.data.map((item: any) => item.dream._id), [String(mixedDream._id)]);
  const veryNegativeMood = await getJson('/api/dreams/search?mood=very-negative');
  assert.deepEqual(
    veryNegativeMood.body.data.map((item: any) => item.dream._id),
    [String(veryNegativeDream._id)],
  );
  const veryPositiveMood = await getJson('/api/dreams/search?mood=very-positive');
  assert.deepEqual(
    veryPositiveMood.body.data.map((item: any) => item.dream._id),
    [String(veryPositiveDream._id)],
  );

  const firstPage = await getJson('/api/dreams/search?q=nh%C3%A0%20ga&limit=1');
  assert.equal(firstPage.body.data.length, 1);
  assert.equal(typeof firstPage.body.nextCursor, 'string');
  const secondPage = await getJson(
    `/api/dreams/search?q=nh%C3%A0%20ga&limit=1&nextCursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
  );
  assert.equal(secondPage.body.data.length, 1);
  assert.notEqual(secondPage.body.data[0].dream._id, firstPage.body.data[0].dream._id);
});

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

async function getJson(path: string, token?: string): Promise<{
  status: number;
  body: any;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

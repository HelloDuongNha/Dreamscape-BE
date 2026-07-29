import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import Dream from '../../src/modules/dream/models/Dream';
import User from '../../src/modules/identity/models/User';
import Comment from '../../src/modules/social/models/Comment';
import Notification from '../../src/modules/social/models/Notification';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const databaseUri = new URL(process.env.MONGODB_TEST_URI!);
  databaseUri.pathname = '/dreamscape_comment_lifecycle_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'comment-lifecycle-integration-secret';
  await connectTestDatabase();
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    Notification.deleteMany({}),
    Comment.deleteMany({}),
    Dream.deleteMany({}),
    User.deleteMany({}),
  ]);
});

after(async () => {
  if (!databaseConfigured) return;
  await Promise.all([
    Notification.deleteMany({}),
    Comment.deleteMany({}),
    Dream.deleteMany({}),
    User.deleteMany({}),
  ]);
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  await disconnectTestDatabase();
});

test('comment edit/delete permissions preserve bounded history and erase deleted text', { skip: !databaseConfigured }, async () => {
  const owner = await createActor('@comment_owner', 'comment-owner@example.test');
  const author = await createActor('@comment_author', 'comment-author@example.test');
  const outsider = await createActor('@comment_outsider', 'comment-outsider@example.test');
  const dream = await Dream.create({
    userId: owner.user._id,
    content: 'Comment lifecycle fixture',
    is_public: true,
    privacy: 'public',
  });

  const created = await requestJson(`/api/dreams/${dream._id}/comments`, {
    method: 'POST',
    token: author.token,
    body: { content: 'Original comment' },
  });
  assert.equal(created.status, 201);
  const commentId = created.body.data._id;
  assert.equal((await Dream.findById(dream._id))!.comments_count, 1);
  assert.equal(await Notification.countDocuments({ commentId }), 1);
  assert.equal((await User.findById(owner.user._id))!.rankPoints, 15);

  const ownerEdit = await requestJson(`/api/comments/${commentId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { content: 'Owner must not rewrite another author' },
  });
  assert.equal(ownerEdit.status, 403);
  const outsiderDelete = await requestJson(`/api/comments/${commentId}`, {
    method: 'DELETE',
    token: outsider.token,
  });
  assert.equal(outsiderDelete.status, 403);

  const edited = await requestJson(`/api/comments/${commentId}`, {
    method: 'PATCH',
    token: author.token,
    body: { content: 'Edited comment' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.content, 'Edited comment');
  assert.equal(edited.body.data.edit_history.length, 1);
  assert.equal(edited.body.data.edit_history[0].content, 'Original comment');

  for (let version = 1; version <= 21; version += 1) {
    const revision = await requestJson(`/api/comments/${commentId}`, {
      method: 'PATCH',
      token: author.token,
      body: { content: `Revision ${version}` },
    });
    assert.equal(revision.status, 200);
  }
  const bounded = await Comment.findById(commentId).lean();
  assert.equal(bounded!.edit_history.length, 20);
  assert.equal(bounded!.edit_history[0].content, 'Revision 1');
  assert.equal(bounded!.content, 'Revision 21');

  const ownerDelete = await requestJson(`/api/comments/${commentId}`, {
    method: 'DELETE',
    token: owner.token,
  });
  assert.equal(ownerDelete.status, 200);
  assert.equal(ownerDelete.body.data.deletedByRole, 'dream_owner');

  const tombstone = await Comment.findById(commentId).lean();
  assert.equal(tombstone!.is_deleted, true);
  assert.equal(tombstone!.content, '');
  assert.deepEqual(tombstone!.edit_history, []);
  assert.equal((await Dream.findById(dream._id))!.comments_count, 0);
  assert.equal(await Notification.countDocuments({ commentId }), 0);
  assert.equal((await User.findById(owner.user._id))!.rankPoints, 0);

  const repeatedDelete = await requestJson(`/api/comments/${commentId}`, {
    method: 'DELETE',
    token: owner.token,
  });
  assert.equal(repeatedDelete.status, 404);
  assert.equal((await Dream.findById(dream._id))!.comments_count, 0);
  assert.equal((await User.findById(owner.user._id))!.rankPoints, 0);

  const visible = await requestJson(`/api/dreams/${dream._id}/comments`);
  assert.equal(visible.body.data.length, 0);
  const authorHistory = await requestJson(`/api/comments/user/${author.user._id}`);
  assert.equal(authorHistory.body.data.length, 0);
});

test('comment policy keeps existing comments readable and rejects stale composers', { skip: !databaseConfigured }, async () => {
  const owner = await createActor('@policy_owner', 'policy-owner@example.test');
  const author = await createActor('@policy_author', 'policy-author@example.test');
  const dream = await Dream.create({
    userId: owner.user._id,
    content: 'Comment policy fixture',
    is_public: true,
    privacy: 'public',
  });
  const first = await requestJson(`/api/dreams/${dream._id}/comments`, {
    method: 'POST',
    token: author.token,
    body: { content: 'Existing comment remains readable' },
  });
  assert.equal(first.status, 201);

  const disabled = await requestJson(`/api/dreams/${dream._id}/comments-policy`, {
    method: 'PATCH',
    token: owner.token,
    body: { enabled: false },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.data.comments_enabled, false);

  const staleComposer = await requestJson(`/api/dreams/${dream._id}/comments`, {
    method: 'POST',
    token: author.token,
    body: { content: 'Must be rejected' },
  });
  assert.equal(staleComposer.status, 409);
  assert.equal(staleComposer.body.code, 'comments_disabled');

  const visible = await requestJson(`/api/dreams/${dream._id}/comments`);
  assert.deepEqual(
    visible.body.data.map((comment: any) => comment.content),
    ['Existing comment remains readable'],
  );
  assert.equal((await Dream.findById(dream._id))!.comments_count, 1);

  const outsiderToggle = await requestJson(`/api/dreams/${dream._id}/comments-policy`, {
    method: 'PATCH',
    token: author.token,
    body: { enabled: true },
  });
  assert.equal(outsiderToggle.status, 404);
});

async function createActor(username: string, email: string) {
  const sessionId = new mongoose.Types.ObjectId();
  const now = new Date();
  const user = await User.create({
    username,
    display_name: username,
    email,
    password: 'CurrentPass9',
    loginHistory: [now.toISOString().slice(0, 10)],
    lastLoginDate: now,
    sessions: [{ _id: sessionId, lastActive: new Date(), authenticatedAt: new Date() }],
  });
  const token = jwt.sign(
    { id: String(user._id), sessionId: String(sessionId) },
    process.env.JWT_SECRET!,
    { expiresIn: '5m' },
  );
  return { user, token };
}

async function requestJson(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    token?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

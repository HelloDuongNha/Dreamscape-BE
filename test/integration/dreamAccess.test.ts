import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../../src/app';
import Dream from '../../src/modules/dream/models/Dream';
import Comment from '../../src/modules/social/models/Comment';
import User from '../../src/modules/identity/models/User';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const databaseUri = new URL(process.env.MONGODB_TEST_URI!);
  databaseUri.pathname = '/dreamscape_dream_access_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'dream-access-integration-secret';
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

test('dream and comment reads apply one owner-or-public visibility contract', { skip: !databaseConfigured }, async () => {
  const ownerSessionId = new mongoose.Types.ObjectId();
  const viewerSessionId = new mongoose.Types.ObjectId();
  const owner = await createUser('@dream_owner', 'dream-owner@example.test', ownerSessionId);
  const viewer = await createUser('@dream_viewer', 'dream-viewer@example.test', viewerSessionId);
  const publicDream = await Dream.create({
    userId: owner._id,
    content: 'Public dream access fixture',
    is_public: true,
    privacy: 'public',
  });
  const privateDream = await Dream.create({
    userId: owner._id,
    content: 'Private dream access fixture',
    is_public: false,
    privacy: 'private',
  });
  const conflictingLegacyDream = await Dream.create({
    userId: owner._id,
    content: 'Conflicting legacy visibility fixture',
    is_public: true,
    privacy: 'private',
  });
  await Comment.create([
    { dreamId: publicDream._id, userId: owner._id, content: 'public comment' },
    { dreamId: privateDream._id, userId: owner._id, content: 'private comment' },
  ]);

  const guestArchive = await getJson(`/api/dreams/user/${owner._id}`);
  assert.equal(guestArchive.status, 200);
  assert.deepEqual(guestArchive.body.data.map((dream: any) => String(dream._id)), [
    String(publicDream._id),
  ]);

  const viewerArchive = await getJson(
    `/api/dreams/user/${owner._id}`,
    tokenFor(viewer._id, viewerSessionId),
  );
  assert.equal(viewerArchive.status, 200);
  assert.deepEqual(viewerArchive.body.data.map((dream: any) => String(dream._id)), [
    String(publicDream._id),
  ]);

  const ownerArchive = await getJson(
    `/api/dreams/user/${owner._id}`,
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(ownerArchive.status, 200);
  assert.deepEqual(
    new Set(ownerArchive.body.data.map((dream: any) => String(dream._id))),
    new Set([
      String(publicDream._id),
      String(privateDream._id),
      String(conflictingLegacyDream._id),
    ]),
  );

  const publicFeed = await getJson('/api/dreams');
  assert.deepEqual(publicFeed.body.data.map((dream: any) => String(dream._id)), [
    String(publicDream._id),
  ]);

  const privateDetail = await getJson(
    `/api/dreams/${privateDream._id}`,
    tokenFor(viewer._id, viewerSessionId),
  );
  assert.equal(privateDetail.status, 404);
  assert.equal(privateDetail.body.data, undefined);

  const privateComments = await getJson(`/api/dreams/${privateDream._id}/comments`);
  assert.equal(privateComments.status, 404);
  const publicComments = await getJson(`/api/dreams/${publicDream._id}/comments`);
  assert.equal(publicComments.status, 200);
  assert.equal(publicComments.body.data.length, 1);

  const guestAuthorComments = await getJson(`/api/comments/user/${owner._id}`);
  assert.equal(guestAuthorComments.status, 200);
  assert.deepEqual(
    guestAuthorComments.body.data.map((comment: any) => comment.content),
    ['public comment'],
  );
  const ownerComments = await getJson(
    `/api/comments/user/${owner._id}`,
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(ownerComments.status, 200);
  assert.deepEqual(
    new Set(ownerComments.body.data.map((comment: any) => comment.content)),
    new Set(['public comment', 'private comment']),
  );
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

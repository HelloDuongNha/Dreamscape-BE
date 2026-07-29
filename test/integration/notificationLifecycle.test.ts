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
  databaseUri.pathname = '/dreamscape_notification_lifecycle_test';
  process.env.MONGODB_TEST_URI = databaseUri.toString();
}

let server: http.Server;
let baseUrl = '';

before(async () => {
  if (!databaseConfigured) return;
  process.env.JWT_SECRET = 'notification-lifecycle-integration-secret';
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

test('owned notification open resolves a permitted target and marks only that row read', { skip: !databaseConfigured }, async () => {
  const ownerSessionId = new mongoose.Types.ObjectId();
  const strangerSessionId = new mongoose.Types.ObjectId();
  const owner = await createUser('@notif_owner', 'notif-owner@example.test', ownerSessionId);
  const sender = await createUser('@notif_sender', 'notif-sender@example.test', new mongoose.Types.ObjectId());
  const stranger = await createUser('@notif_stranger', 'notif-stranger@example.test', strangerSessionId);
  const dream = await Dream.create({
    userId: owner._id,
    content: 'Notification target dream',
    is_public: false,
    privacy: 'private',
    ai_status: 'completed',
  });
  const analysisNotification = await Notification.create({
    recipientId: owner._id,
    senderId: owner._id,
    type: 'dream_analysis',
    postId: dream._id,
  });
  const otherNotification = await Notification.create({
    recipientId: owner._id,
    senderId: sender._id,
    type: 'like',
    postId: dream._id,
  });

  const [ownerList, strangerList] = await Promise.all([
    requestJson('/api/notifications', 'GET', tokenFor(owner._id, ownerSessionId)),
    requestJson('/api/notifications', 'GET', tokenFor(stranger._id, strangerSessionId)),
  ]);
  assert.equal(ownerList.status, 200);
  assert.equal(ownerList.body.data.length, 2);
  assert.deepEqual(
    new Set(ownerList.body.data.map((notification: { _id: string }) => notification._id)),
    new Set([String(analysisNotification._id), String(otherNotification._id)]),
  );
  assert.equal(ownerList.body.data[0].postId, String(dream._id));
  assert.equal(ownerList.body.data[0].postId?.content, undefined);
  assert.equal(strangerList.status, 200);
  assert.deepEqual(strangerList.body.data, []);

  const strangerOpen = await requestJson(
    `/api/notifications/${analysisNotification._id}/open`,
    'POST',
    tokenFor(stranger._id, strangerSessionId),
  );
  assert.equal(strangerOpen.status, 404);

  const opened = await requestJson(
    `/api/notifications/${analysisNotification._id}/open`,
    'POST',
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.target.kind, 'dream_analysis');
  assert.equal(opened.body.data.target.dream._id, String(dream._id));
  assert.equal(opened.body.data.target.dream.content, 'Notification target dream');

  const [analysisAfter, otherAfter] = await Promise.all([
    Notification.findById(analysisNotification._id).lean(),
    Notification.findById(otherNotification._id).lean(),
  ]);
  assert.equal(analysisAfter?.isRead, true);
  assert.equal(otherAfter?.isRead, false);
});

test('notification delete, mark-all and unavailable targets remain owner-scoped', { skip: !databaseConfigured }, async () => {
  const ownerSessionId = new mongoose.Types.ObjectId();
  const strangerSessionId = new mongoose.Types.ObjectId();
  const owner = await createUser('@notif_owner_2', 'notif-owner-2@example.test', ownerSessionId);
  const sender = await createUser('@notif_sender_2', 'notif-sender-2@example.test', new mongoose.Types.ObjectId());
  const stranger = await createUser('@notif_stranger_2', 'notif-stranger-2@example.test', strangerSessionId);
  const inaccessibleDream = await Dream.create({
    userId: owner._id,
    content: 'Private notification target',
    is_public: false,
    privacy: 'private',
    ai_status: 'completed',
  });
  const inaccessible = await Notification.create({
    recipientId: stranger._id,
    senderId: owner._id,
    type: 'dream_analysis',
    postId: inaccessibleDream._id,
  });
  const publicDream = await Dream.create({
    userId: owner._id,
    content: 'Public notification target',
    is_public: true,
    privacy: 'public',
    ai_status: 'completed',
  });
  const publicTarget = await Notification.create({
    recipientId: stranger._id,
    senderId: owner._id,
    type: 'dream_analysis',
    postId: publicDream._id,
  });
  const missingTarget = await Notification.create({
    recipientId: stranger._id,
    senderId: owner._id,
    type: 'dream_analysis',
    postId: new mongoose.Types.ObjectId(),
  });
  const followNotification = await Notification.create({
    recipientId: owner._id,
    senderId: sender._id,
    type: 'follow',
  });
  const deletable = await Notification.create({
    recipientId: owner._id,
    senderId: sender._id,
    type: 'like',
    postId: inaccessibleDream._id,
  });

  const unavailable = await requestJson(
    `/api/notifications/${inaccessible._id}/open`,
    'POST',
    tokenFor(stranger._id, strangerSessionId),
  );
  assert.equal(unavailable.status, 410);
  assert.equal(unavailable.body.code, 'notification_target_unavailable');
  assert.equal((await Notification.findById(inaccessible._id).lean())?.isRead, false);

  const openedPublicTarget = await requestJson(
    `/api/notifications/${publicTarget._id}/open`,
    'POST',
    tokenFor(stranger._id, strangerSessionId),
  );
  assert.equal(openedPublicTarget.status, 200);
  assert.equal(openedPublicTarget.body.data.target.dream._id, String(publicDream._id));

  const missing = await requestJson(
    `/api/notifications/${missingTarget._id}/open`,
    'POST',
    tokenFor(stranger._id, strangerSessionId),
  );
  assert.equal(missing.status, 410);
  assert.equal(missing.body.code, 'notification_target_unavailable');
  assert.equal((await Notification.findById(missingTarget._id).lean())?.isRead, false);

  const deniedDelete = await requestJson(
    `/api/notifications/${deletable._id}`,
    'DELETE',
    tokenFor(stranger._id, strangerSessionId),
  );
  assert.equal(deniedDelete.status, 404);
  assert.ok(await Notification.exists({ _id: deletable._id }));

  const deleted = await requestJson(
    `/api/notifications/${deletable._id}`,
    'DELETE',
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(deleted.status, 200);
  assert.equal(await Notification.exists({ _id: deletable._id }), null);

  const followOpened = await requestJson(
    `/api/notifications/${followNotification._id}/open`,
    'POST',
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(followOpened.status, 200);
  assert.deepEqual(followOpened.body.data.target, {
    kind: 'profile',
    userId: String(sender._id),
  });

  const unread = await Notification.create({
    recipientId: owner._id,
    senderId: sender._id,
    type: 'follow',
  });
  const marked = await requestJson(
    '/api/notifications/mark-read',
    'PATCH',
    tokenFor(owner._id, ownerSessionId),
  );
  assert.equal(marked.status, 200);
  assert.equal((await Notification.findById(unread._id).lean())?.isRead, true);
  assert.equal((await Notification.findById(inaccessible._id).lean())?.isRead, false);
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

async function requestJson(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  token: string,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

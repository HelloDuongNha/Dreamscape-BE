import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import User from '../../src/modules/identity/models/User';
import {
  AvatarUploadError,
  replaceUserAvatar,
} from '../../src/modules/identity/services/avatar.service';
import { connectTestDatabase, disconnectTestDatabase } from '../support/testDatabase';

const databaseConfigured = Boolean(process.env.MONGODB_TEST_URI);
if (databaseConfigured) {
  const avatarDatabaseUri = new URL(process.env.MONGODB_TEST_URI!);
  avatarDatabaseUri.pathname = '/dreamscape_avatar_test';
  process.env.MONGODB_TEST_URI = avatarDatabaseUri.toString();
}

before(async () => {
  if (databaseConfigured) await connectTestDatabase();
});

beforeEach(async () => {
  if (databaseConfigured) await User.deleteMany({});
});

after(async () => {
  if (!databaseConfigured) return;
  await User.deleteMany({});
  await disconnectTestDatabase();
});

test('avatar replacement commits the new owned asset before removing the old one', { skip: !databaseConfigured }, async () => {
  const user = await User.create({
    username: '@avatar_owner',
    display_name: 'Avatar Owner',
    email: 'avatar-owner@example.test',
    password: 'CurrentPass9',
    avatar: 'https://old.example/avatar.png',
    avatarAsset: { provider: 'cloudinary', publicId: 'user_avatars/old-avatar' },
  });
  const removed: string[] = [];
  const storage = {
    async upload() {
      return {
        public_id: 'user_avatars/new-avatar',
        secure_url: 'https://cdn.example/new-avatar.webp',
        resource_type: 'image' as const,
        bytes: 128,
      };
    },
    async remove(publicId: string) {
      removed.push(publicId);
    },
  };

  const avatar = await replaceUserAvatar(String(user._id), pngFile(), storage);
  const persisted = await User.findById(user._id);

  assert.equal(avatar, 'https://cdn.example/new-avatar.webp');
  assert.equal(persisted!.avatar, avatar);
  assert.equal(persisted!.avatarAsset?.publicId, 'user_avatars/new-avatar');
  assert.deepEqual(removed, ['user_avatars/old-avatar']);
});

test('avatar replacement rejects MIME spoofing before storage is called', { skip: !databaseConfigured }, async () => {
  const user = await User.create({
    username: '@avatar_spoof',
    display_name: 'Avatar Spoof',
    email: 'avatar-spoof@example.test',
    password: 'CurrentPass9',
  });
  let uploaded = false;

  await assert.rejects(
    replaceUserAvatar(
      String(user._id),
      { ...pngFile(), buffer: Buffer.from('not an image') },
      {
        async upload() {
          uploaded = true;
          throw new Error('must not run');
        },
        async remove() {},
      },
    ),
    (error: unknown) =>
      error instanceof AvatarUploadError && error.code === 'avatar_content_invalid',
  );
  assert.equal(uploaded, false);
});

test('avatar replacement changes only the authenticated user selected by the server', { skip: !databaseConfigured }, async () => {
  const owner = await User.create({
    username: '@avatar_authenticated',
    display_name: 'Authenticated Owner',
    email: 'avatar-authenticated@example.test',
    password: 'CurrentPass9',
  });
  const otherUser = await User.create({
    username: '@avatar_other',
    display_name: 'Other User',
    email: 'avatar-other@example.test',
    password: 'CurrentPass9',
    avatar: 'https://cdn.example/other-user.webp',
    avatarAsset: { provider: 'cloudinary', publicId: 'user_avatars/other-user' },
  });

  await replaceUserAvatar(String(owner._id), pngFile(), {
    async upload(_buffer, userId) {
      assert.equal(userId, String(owner._id));
      return {
        public_id: 'user_avatars/authenticated-owner',
        secure_url: 'https://cdn.example/authenticated-owner.webp',
        resource_type: 'image' as const,
        bytes: 128,
      };
    },
    async remove() {},
  });

  const untouched = await User.findById(otherUser._id);
  assert.equal(untouched!.avatar, 'https://cdn.example/other-user.webp');
  assert.equal(untouched!.avatarAsset?.publicId, 'user_avatars/other-user');
});

test('avatar replacement removes the new asset when MongoDB persistence fails', { skip: !databaseConfigured }, async () => {
  const user = await User.create({
    username: '@avatar_rollback',
    display_name: 'Avatar Rollback',
    email: 'avatar-rollback@example.test',
    password: 'CurrentPass9',
    avatar: 'https://old.example/avatar.png',
  });
  const removed: string[] = [];
  const originalSave = User.prototype.save;
  User.prototype.save = async function forcedAvatarSaveFailure() {
    throw new Error('forced avatar persistence failure');
  } as typeof User.prototype.save;

  try {
    await assert.rejects(
      replaceUserAvatar(String(user._id), pngFile(), {
        async upload() {
          return {
            public_id: 'user_avatars/orphan-candidate',
            secure_url: 'https://cdn.example/orphan-candidate.webp',
            resource_type: 'image' as const,
            bytes: 128,
          };
        },
        async remove(publicId: string) {
          removed.push(publicId);
        },
      }),
      /forced avatar persistence failure/,
    );
  } finally {
    User.prototype.save = originalSave;
  }

  assert.deepEqual(removed, ['user_avatars/orphan-candidate']);
  assert.equal((await User.findById(user._id))!.avatar, 'https://old.example/avatar.png');
});

function pngFile(): Express.Multer.File {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  return {
    fieldname: 'avatar',
    originalname: 'avatar.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

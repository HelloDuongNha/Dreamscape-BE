import fs from 'fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getStorage, Storage } from 'firebase-admin/storage';
import { requireEnvironmentVariable } from './env';

function getCredential() {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  if (encoded) {
    return cert(JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')));
  }

  const serviceAccountPath = requireEnvironmentVariable('FIREBASE_SERVICE_ACCOUNT_PATH');
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH does not point to a readable file.');
  }

  const raw = fs.readFileSync(serviceAccountPath, 'utf8');
  return cert(JSON.parse(raw));
}

export function getFirebaseApp(): App {
  const existingApp = getApps()[0];
  if (existingApp) return existingApp;
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  return initializeApp({
    credential: getCredential(),
    ...(storageBucket ? { storageBucket } : {}),
  });
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

export function getFirebaseStorage(): Storage {
  const storageBucket = getFirebaseStorageBucketName();
  const app = getFirebaseApp();
  return getStorage(app);
}

export function getFirebaseStorageBucketName(): string {
  return requireEnvironmentVariable('FIREBASE_STORAGE_BUCKET');
}

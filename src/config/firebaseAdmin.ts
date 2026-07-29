import fs from 'fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage, Storage } from 'firebase-admin/storage';
import { requireEnvironmentVariable } from './env';

function getCredential() {
  const serviceAccountPath = requireEnvironmentVariable('FIREBASE_SERVICE_ACCOUNT_PATH');
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH does not point to a readable file.');
  }

  const raw = fs.readFileSync(serviceAccountPath, 'utf8');
  return cert(JSON.parse(raw));
}

export function getFirebaseStorage(): Storage {
  const storageBucket = getFirebaseStorageBucketName();
  const existingApp = getApps()[0];
  const app = existingApp ?? initializeApp({ credential: getCredential(), storageBucket });
  return getStorage(app);
}

export function getFirebaseStorageBucketName(): string {
  return requireEnvironmentVariable('FIREBASE_STORAGE_BUCKET');
}

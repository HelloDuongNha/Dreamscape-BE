import fs from 'fs';
import os from 'os';
import path from 'path';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getStorage, Storage } from 'firebase-admin/storage';

const DEFAULT_BUCKET = 'dreamscape-61009.firebasestorage.app';

function getCredential() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
    || path.join(os.homedir(), 'Library/Application Support/DreamScape/firebase/service-account.json');
  if (!fs.existsSync(serviceAccountPath)) return applicationDefault();

  const raw = fs.readFileSync(serviceAccountPath, 'utf8');
  return cert(JSON.parse(raw));
}

export function getFirebaseStorage(): Storage {
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
  const app = getApps()[0] || initializeApp({
    credential: getCredential(),
    storageBucket,
  });
  return getStorage(app);
}

export function getFirebaseStorageBucketName(): string {
  return process.env.FIREBASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
}

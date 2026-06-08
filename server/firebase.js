import { existsSync, readFileSync } from 'node:fs';
import admin from 'firebase-admin';
import { logger } from './logger.js';

let app = null;

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    return JSON.parse(readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf8'));
  }

  return null;
}

export function firebaseConfigured() {
  return Boolean(
    process.env.FIREBASE_PROJECT_ID &&
      (process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
  );
}

export function initializeFirebase() {
  if (app) {
    return app;
  }

  if (!firebaseConfigured()) {
    logger.warn('Firebase nao configurado. API v1 usara adaptador SQLite local ate a migracao ser habilitada.');
    return null;
  }

  const serviceAccount = readServiceAccount();
  const credential = serviceAccount ? admin.credential.cert(serviceAccount) : admin.credential.applicationDefault();
  app = admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
  logger.info({ projectId: process.env.FIREBASE_PROJECT_ID }, 'Firebase Admin inicializado');
  return app;
}

export function firestore() {
  const firebaseApp = initializeFirebase();
  if (!firebaseApp) {
    return null;
  }

  return admin.firestore(firebaseApp);
}

export function firebaseAuth() {
  const firebaseApp = initializeFirebase();
  if (!firebaseApp) {
    return null;
  }

  return admin.auth(firebaseApp);
}

export function firebaseStorageBucket() {
  const firebaseApp = initializeFirebase();
  if (!firebaseApp || !process.env.FIREBASE_STORAGE_BUCKET) {
    return null;
  }

  return admin.storage(firebaseApp).bucket();
}

export function firebaseMessaging() {
  const firebaseApp = initializeFirebase();
  if (!firebaseApp) {
    return null;
  }

  return admin.messaging(firebaseApp);
}

export const FieldValue = admin.firestore.FieldValue;

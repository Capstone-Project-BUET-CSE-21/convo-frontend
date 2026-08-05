import { bufferToBase64 } from "./buffers";
import { authHeaders } from "../auth/authFetch";

const API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;

const DB_NAME = "convo-keys";
const STORE_NAME = "keypairs";

const openDb = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Composite key so ECDSA and ECDH private keys don't collide for the same user
const storageKey = (userId, algorithm) => `${userId}:${algorithm}`;

const storePrivateKey = async (userId, algorithm, privateKey) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(privateKey, storageKey(userId, algorithm));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const deletePrivateKey = async (userId, algorithm) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(storageKey(userId, algorithm));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const getPrivateKey = async (userId, algorithm = "ECDSA-P256") => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(storageKey(userId, algorithm));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export const generateAndStoreKeypair = async (userId) => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable — needed so we can export the public key below
    ["sign", "verify"]
  );

  await storePrivateKey(userId, "ECDSA-P256", keyPair.privateKey);

  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyBase64 = bufferToBase64(spki);

  return { privateKey: keyPair.privateKey, publicKeyBase64 };
}

export const generateAndStoreECDHKeypair = async (userId) => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true, // extractable — needed so we can export the public key below
    ["deriveKey", "deriveBits"]
  );

  await storePrivateKey(userId, "ECDH-P256", keyPair.privateKey);

  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyBase64 = bufferToBase64(spki);

  return { privateKey: keyPair.privateKey, publicKeyBase64 };
}

export const registerPublicKey = async (userId, publicKeyBase64, algorithm = "ECDSA-P256") => {
  const res = await fetch(`${API_BASE_URL}/api/keys`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      userId,
      publicKey: publicKeyBase64,
      algorithm,
    }),
  });
  if (!res.ok) throw new Error(`Key registration failed: ${res.status}`);
  return res.status; // no body to parse — 201 Created has none
}

// Deliberately separate from crypto/verify.js's fetchPublicKey, which
// collapses every non-2xx (404, 401, 500, network blip) into the same
// null — correct for "is this incoming file's signer verifiable", wrong
// here. The backend keeps exactly one row per (userId, algorithm) with no
// history (see PublicKeyEntity), so overwriting it is destructive: it
// permanently orphans every file already signed with the old key. Only a
// confirmed 404 means "truly not registered"; anything else (expired
// token, backend hiccup) must NOT be treated as license to rotate a
// perfectly good key.
const isKeyRegisteredOnBackend = async (userId, algorithm) => {
  const res = await fetch(`${API_BASE_URL}/api/keys/${userId}/${algorithm}`, { headers: authHeaders() });
  if (res.status === 404) return false;
  if (res.ok) return true;
  throw new Error(`Key registration check failed: ${res.status}`);
};

// Local IndexedDB presence alone isn't proof the backend still has the
// matching public key registered — e.g. the file-sharing service's key
// store can be reset (dev DB recreated, redeploy) while this browser's
// IndexedDB survives. Trusting local-only would leave the sender able to
// sign with a key nobody else can ever verify. So a local key is only
// dropped and regenerated when the backend positively confirms it's gone
// (404) — an inconclusive check (thrown error above) is left untouched
// rather than risking a destructive rotation.
const ensureKeyPair = async (userId, algorithm, generate) => {
  const existingPrivate = await getPrivateKey(userId, algorithm);
  if (existingPrivate) {
    const registered = await isKeyRegisteredOnBackend(userId, algorithm);
    if (registered) return;
    await deletePrivateKey(userId, algorithm);
  }

  const { publicKeyBase64 } = await generate(userId);
  try {
    await registerPublicKey(userId, publicKeyBase64, algorithm);
  } catch (err) {
    await deletePrivateKey(userId, algorithm);
    throw err;
  }
};

export const ensureUserHasKeys = async (userId) => {
  await ensureKeyPair(userId, "ECDSA-P256", generateAndStoreKeypair);
  await ensureKeyPair(userId, "ECDH-P256", generateAndStoreECDHKeypair);
};
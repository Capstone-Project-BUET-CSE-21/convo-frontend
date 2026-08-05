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

export const ensureUserHasKeys = async (userId) => {
  const existingEcdsa = await getPrivateKey(userId, "ECDSA-P256");
  if (!existingEcdsa) {
    const ecdsa = await generateAndStoreKeypair(userId);
    try {
      await registerPublicKey(userId, ecdsa.publicKeyBase64, "ECDSA-P256");
    } catch (err) {
      await deletePrivateKey(userId, "ECDSA-P256");
      throw err;
    }
  }

  const existingEcdh = await getPrivateKey(userId, "ECDH-P256");
  if (!existingEcdh) {
    const ecdh = await generateAndStoreECDHKeypair(userId);
    try {
      await registerPublicKey(userId, ecdh.publicKeyBase64, "ECDH-P256");
    } catch (err) {
      await deletePrivateKey(userId, "ECDH-P256");
      throw err;
    }
  }
};
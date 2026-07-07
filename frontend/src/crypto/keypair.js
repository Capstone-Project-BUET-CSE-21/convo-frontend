import { bufferToBase64 } from "./canonicalize";

const DB_NAME = "convo-keys";
const STORE_NAME = "keypairs";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storePrivateKey(userId, privateKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(privateKey, userId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPrivateKey(userId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function generateAndStoreKeypair(userId) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable — needed so we can export the public key below
    ["sign", "verify"]
  );

  await storePrivateKey(userId, keyPair.privateKey);

  const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyBase64 = bufferToBase64(spki);

  return { privateKey: keyPair.privateKey, publicKeyBase64 };
}

export async function registerPublicKey(userId, publicKeyBase64) {
  const res = await fetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      publicKey: publicKeyBase64,
      algorithm: "ECDSA-P256",
    }),
  });
  if (!res.ok) throw new Error(`Key registration failed: ${res.status}`);
  return res.json();
}
import { bufferToBase64 } from "./buffers";
import { authHeaders } from "../auth/authFetch";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

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
  const res = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/keys`, {
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

// Re-derive the public half of a locally stored private key, in the exact
// base64 SPKI form registerPublicKey uploads. A private EC key's JWK carries
// the public point (x, y), so we can reconstruct the public key without having
// stored it — letting us tell whether THIS browser's key is among the user's
// registered keys, not merely whether the user has some key registered.
const localPublicKeyBase64 = async (privateKey, algorithm) => {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const params = algorithm === "ECDH-P256"
    ? { name: "ECDH", namedCurve: "P-256" }
    : { name: "ECDSA", namedCurve: "P-256" };
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    params,
    true,
    [] // public key needs no usages of its own; we only export it
  );
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bufferToBase64(spki);
};

// This device's own public key for an algorithm, in base64 SPKI — derived from
// the locally stored private key. Used to announce the live session key to
// peers over the data channel (see the meeting session-key handshake). Returns
// null if this device has no key for the algorithm.
export const getLocalPublicKeyBase64 = async (userId, algorithm = "ECDSA-P256") => {
  const privateKey = await getPrivateKey(userId, algorithm);
  if (!privateKey) return null;
  return localPublicKeyBase64(privateKey, algorithm);
};

// Every public key the backend has on file for this user+algorithm (the key
// history — see PublicKeyEntity). Only a definitive answer counts: a network or
// auth hiccup must NOT be read as "no keys registered", or it could trigger a
// spurious mismatch/registration — so this throws on an inconclusive response
// rather than returning an empty list.
const fetchRegisteredKeys = async (userId, algorithm) => {
  const res = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/keys/${userId}/${algorithm}/all`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`Key history lookup failed: ${res.status}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((r) => r.publicKey).filter(Boolean) : [];
};

// Reconciles one algorithm's keypair between this browser and the backend.
// Under the per-device model each browser holds its own keypair; registration
// is additive (the backend keeps key history) and nothing here overwrites or
// deletes an existing key:
//   - local key present, already registered  → nothing to do
//   - local key present, NOT registered       → register it (additive re-upload;
//                                               fixes a key present locally but
//                                               missing from the backend, e.g.
//                                               after a key-store reset)
//   - no local key                            → this is a new device (or first
//                                               login): generate its own keypair
//                                               and register it. Senders encrypt
//                                               to whichever device key is
//                                               announced live in the meeting, so
//                                               a per-device key is exactly right.
// Returns "ok", or "new-device" when a key had to be provisioned for a user who
// already had keys registered elsewhere (used only to surface an awareness notice).
const reconcileKeyPair = async (userId, algorithm, generate) => {
  const localPrivate = await getPrivateKey(userId, algorithm);
  const registeredKeys = await fetchRegisteredKeys(userId, algorithm);

  if (localPrivate) {
    const localPublic = await localPublicKeyBase64(localPrivate, algorithm);
    if (!registeredKeys.includes(localPublic)) {
      await registerPublicKey(userId, localPublic, algorithm);
    }
    return "ok";
  }

  const userAlreadyHadKeys = registeredKeys.length > 0;
  const { publicKeyBase64 } = await generate(userId);
  try {
    await registerPublicKey(userId, publicKeyBase64, algorithm);
  } catch (err) {
    await deletePrivateKey(userId, algorithm);
    throw err;
  }
  return userAlreadyHadKeys ? "new-device" : "ok";
};

// Ensures this browser has its signing (ECDSA) and encryption (ECDH) keypairs
// registered. Returns { status: "ok" }, or { status: "new-device" } when a key
// was freshly provisioned for a user who already had keys on other devices —
// the caller surfaces a non-blocking "new device added" awareness notice.
export const ensureUserHasKeys = async (userId) => {
  const ecdsa = await reconcileKeyPair(userId, "ECDSA-P256", generateAndStoreKeypair);
  const ecdh = await reconcileKeyPair(userId, "ECDH-P256", generateAndStoreECDHKeypair);

  const newDevice = ecdsa === "new-device" || ecdh === "new-device";
  return { status: newDevice ? "new-device" : "ok" };
};
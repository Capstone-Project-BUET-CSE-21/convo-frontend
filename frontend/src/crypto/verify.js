import { canonicalize } from "./canonicalize";
import { concatBuffers, hexToBuffer, base64ToBuffer } from "./buffers";
import { authHeaders } from "../auth/authFetch";

const API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;

export const fetchPublicKey = async (userId, algorithm = "ECDSA-P256") => {
  const res = await fetch(`${API_BASE_URL}/api/keys/${userId}/${algorithm}`, { headers: authHeaders() });
  if (!res.ok) return null;
  const { publicKey } = await res.json();
  return publicKey;
}

// Every key this user has registered for the algorithm (newest first). The
// backend keeps key history additively, so verification can accept a signature
// made with a since-rotated key — see verifyBlockWithHistory. Returns [] if the
// user has no registered keys (or the lookup fails).
export const fetchPublicKeys = async (userId, algorithm = "ECDSA-P256") => {
  const res = await fetch(`${API_BASE_URL}/api/keys/${userId}/${algorithm}/all`, { headers: authHeaders() });
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows) ? rows.map((r) => r.publicKey).filter(Boolean) : [];
}

export const importPublicKey = async (publicKeyBase64) => {
  const spki = base64ToBuffer(publicKeyBase64);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"]
  );
}

export const verifyBlock = async (signature, fileHash, metadataBlock, publicKey) => {
  if (!publicKey) {
    return { valid: false, reason: "key-not-found" };
  }

  const payload = concatBuffers(
    hexToBuffer(fileHash),
    hexToBuffer(metadataBlock.previousHash ?? ""),
    new TextEncoder().encode(canonicalize(metadataBlock))
  );

  const isValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64ToBuffer(signature),
    payload
  );

  return isValid
    ? { valid: true }
    : { valid: false, reason: "invalid-signature" };
}

// Verifies against a user's full key history: passes if ANY of their registered
// keys verifies the signature. This is what makes key rotation non-destructive —
// a file signed with an old key still verifies after the user's current key has
// changed. Same result shape as verifyBlock. 'key-not-found' when the user has
// no registered keys at all; 'invalid-signature' when they have keys but none
// match.
export const verifyBlockWithHistory = async (signature, fileHash, metadataBlock, publicKeysBase64) => {
  if (!publicKeysBase64 || publicKeysBase64.length === 0) {
    return { valid: false, reason: "key-not-found" };
  }

  for (const base64 of publicKeysBase64) {
    const publicKey = await importPublicKey(base64);
    const result = await verifyBlock(signature, fileHash, metadataBlock, publicKey);
    if (result.valid) {
      return { valid: true };
    }
  }

  return { valid: false, reason: "invalid-signature" };
}

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

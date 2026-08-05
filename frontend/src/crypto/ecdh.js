import { base64ToBuffer } from "./buffers";
import { authHeaders } from "../auth/authFetch";

const API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;

export const fetchECDHPublicKey = async (userId) => {
  const res = await fetch(`${API_BASE_URL}/api/keys/${userId}/ECDH-P256`, {
    cache: "no-store",
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  const { publicKey } = await res.json();
  return publicKey;
}

export const importECDHPublicKey = async (publicKeyBase64) => {
  const spki = base64ToBuffer(publicKeyBase64);
  return crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [] // public key has no usages of its own — it's only ever used as the "public" param in deriveKey
  );
}

// privateKey belongs to "me", publicKey belongs to the other party.
// Both sides compute this independently and arrive at the identical AES key —
// that's the whole point of ECDH, no key ever crosses the network.
export const deriveSharedKey = async (privateKey, publicKey) => {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false, // not extractable — no reason this derived key should ever leave the browser as raw bytes
    ["encrypt", "decrypt"]
  );
}

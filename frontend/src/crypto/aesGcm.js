import { base64ToBuffer, bufferToBase64 } from "./buffers";

export const encryptData = async (sharedKey, data) => {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM standard IV size
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    data
  );
  return {
    ciphertext: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv), // not secret, but required to decrypt — must travel with the ciphertext
  };
}

export const decryptData = async (sharedKey, ciphertextBase64, ivBase64) => {
  const iv = base64ToBuffer(ivBase64);
  const ciphertext = base64ToBuffer(ciphertextBase64);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    ciphertext
  );
}
// The content key needs to be extractable — it must be exported to raw
// bytes so it can be wrapped (encrypted) separately for each recipient.
export const generateContentKey = async () => {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export const exportRawKey = async (key) => {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufferToBase64(raw);
}

export const importRawKey = async (rawBase64) => {
  const raw = base64ToBuffer(rawBase64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
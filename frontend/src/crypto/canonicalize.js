// Shared serialization + buffer helpers used across hashing, signing, verification

export const canonicalize = (metadataBlock) => {
  const sortedKeys = [
    "fileName",
    "fileSize",
    "mimeType",
    "previousHash",
    "senderId",
    "sessionId",
    "timestamp",
    "transferId",
  ];

  const ordered = {};
  for (const key of sortedKeys) {
    ordered[key] = metadataBlock[key] ?? null;
  }

  return JSON.stringify(ordered);
}

export const concatBuffers = (...buffers) => {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    result.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return result.buffer;
}

export const bufferToHex = (buffer) => {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const hexToBuffer = (hex) => {
  if (!hex) return new Uint8Array(0).buffer;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

export const bufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const base64ToBuffer = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
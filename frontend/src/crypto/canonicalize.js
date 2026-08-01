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


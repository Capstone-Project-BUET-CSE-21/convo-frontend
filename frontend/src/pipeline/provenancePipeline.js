import { computeFileHash } from "../crypto/hashing";
import { signBlock } from "../crypto/signing";
import { embedProvenanceBlock } from "./chainEmbed";

const CONFIDENTIALITY_API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;

const emitStage = (sessionCtx, stage) => {
  sessionCtx?.onStageChange?.(stage);
};

export const requestMetadataBlock = async (sessionCtx, file) => {
  if (!CONFIDENTIALITY_API_BASE_URL) {
    throw new Error("Confidentiality service URL is not configured");
  }

  const response = await fetch(`${CONFIDENTIALITY_API_BASE_URL}/api/transfer/metadata`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: sessionCtx.sessionId,
      senderId: sessionCtx.senderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    }),
  });

  if (!response.ok) {
    throw new Error(`Metadata request failed: ${response.status}`);
  }

  return response.json();
};

export const requestEncryptionKeyBundle = async (sessionCtx) => {
  if (!CONFIDENTIALITY_API_BASE_URL) {
    throw new Error("Confidentiality service URL is not configured");
  }

  const recipientIds = Array.isArray(sessionCtx.recipientIds) ? sessionCtx.recipientIds : [];
  const lookups = await Promise.all(
    recipientIds.map(async (recipientId) => {
      const response = await fetch(`${CONFIDENTIALITY_API_BASE_URL}/api/keys/${recipientId}`);
      if (!response.ok) {
        throw new Error(`Public key lookup failed for ${recipientId}: ${response.status}`);
      }

      const keyRecord = await response.json();
      if (!keyRecord?.publicKey || !keyRecord?.algorithm) {
        throw new Error(`Invalid key record returned for ${recipientId}`);
      }

      return [recipientId, keyRecord];
    })
  );

  return Object.fromEntries(lookups);
};

export async function prepareFileForTransfer(file, sessionCtx = {}) {
  emitStage(sessionCtx, { phase: "metadata", label: "Fetching provenance metadata", progress: 0 });
  const metadata = await requestMetadataBlock(sessionCtx, file);

  emitStage(sessionCtx, { phase: "keys", label: "Verifying confidentiality keys", progress: 10 });
  const encryptionKeys = await requestEncryptionKeyBundle(sessionCtx);

  const fileBuffer = await file.arrayBuffer();

  emitStage(sessionCtx, { phase: "hashing", label: "Hashing file contents", progress: 25 });
  const fileHash = await computeFileHash(fileBuffer, metadata);

  emitStage(sessionCtx, { phase: "signing", label: "Signing provenance block", progress: 55 });
  const signature = await signBlock(fileHash, metadata, sessionCtx.privateKey);

  emitStage(sessionCtx, { phase: "embedding", label: "Embedding provenance block", progress: 75 });
  const wrapped = embedProvenanceBlock(fileBuffer, metadata, fileHash, signature);

  if (typeof sessionCtx.encryptPayload === "function") {
    emitStage(sessionCtx, { phase: "encrypting", label: "Applying confidentiality wrapper", progress: 90 });
    const encrypted = await sessionCtx.encryptPayload(wrapped, {
      metadata,
      fileHash,
      signature,
      encryptionKeys,
    });
    emitStage(sessionCtx, { phase: "ready", label: "Ready to send", progress: 100 });
    return encrypted;
  }

  emitStage(sessionCtx, { phase: "ready", label: "Ready to send", progress: 100 });
  return wrapped;
}
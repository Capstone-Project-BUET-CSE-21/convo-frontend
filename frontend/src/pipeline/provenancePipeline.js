import { computeFileHash, computeContentHash } from "../crypto/hashing";
import { signBlock } from "../crypto/signing";
import { embedProvenanceBlock } from "./chainEmbed";
import { fetchChainHistory } from "./chainReconstruct";
import { makeVerifyHop } from "../identity/traceVerification";
import { authHeaders } from "../auth/authFetch";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

const emitStage = (sessionCtx, stage) => {
  sessionCtx?.onStageChange?.(stage);
};

// Thrown when the most recent chain-history entry for this file's content
// fails signature re-verification. Kept distinguishable from generic
// network/validation errors so the caller (ChatFileShare's sendStagedFile)
// can show a message that's specific to "refusing to link to tampered
// history" instead of the generic send-failure text.
export class ProvenanceLinkError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProvenanceLinkError";
  }
}

// Looks up prior shares of this exact file content and, if found, verifies
// the most recent entry before trusting it as the chain's previousHash.
// Returns null for a fresh root (no prior shares, or none linkable).
export const resolvePreviousHash = async (contentHash, baseUrl) => {
  const history = await fetchChainHistory(contentHash, baseUrl);
  if (!history || history.length === 0) {
    return null;
  }

  // findByContentHashOrderByTimestampAsc on the server — last entry is latest.
  const latest = history[history.length - 1];
  const verification = await makeVerifyHop(contentHash)(latest);
  if (!verification.valid) {
    throw new ProvenanceLinkError(
      `Refusing to link to prior share: ${verification.reason ?? "verification failed"}`
    );
  }

  return latest.fileHash;
};

export const requestMetadataBlock = async (sessionCtx, file, previousHash) => {
  const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/transfer/metadata`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: sessionCtx.sessionId,
      senderId: sessionCtx.senderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      previousHash: previousHash ?? null,
    }),
  });

  if (!response.ok) {
  const errorBody = await response.json().catch(() => ({}));
  throw new Error(`Metadata request failed: ${response.status} — ${errorBody.error || "unknown reason"}`);
}

  return response.json();
};

export const attachHashAndSignature = async (transferId, { fileHash, signature, contentHash }) => {
  const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/transfer/metadata/${transferId}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fileHash, signature, contentHash }),
  });

  if (!response.ok) {
    throw new Error(`Metadata patch failed: ${response.status}`);
  }

  return response.json();
};

export const requestEncryptionKeyBundle = async (sessionCtx) => {
  if (!CONFIDENTIALITY_CHAIN_URL) {
    throw new Error("Confidentiality service URL is not configured");
  } 

  const recipientIds = Array.isArray(sessionCtx.recipientIds) ? sessionCtx.recipientIds : [];
  const announcedKeys = sessionCtx.recipientKeys ?? {};

  const lookups = await Promise.all(
    recipientIds.map(async (recipientId) => {
      // Prefer the ECDH key the recipient announced live over the data channel —
      // the exact device key they're using in this meeting. Fall back to their
      // current registered key only if they didn't announce one (e.g. an older
      // peer), which is the legacy "latest key" behavior.
      const announcedKey = announcedKeys[recipientId];
      if (announcedKey) {
        return [recipientId, { publicKey: announcedKey, algorithm: "ECDH-P256" }];
      }

      const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/keys/${recipientId}/ECDH-P256`, {
        headers: authHeaders(),
      });
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
  const fileBuffer = await file.arrayBuffer();

  emitStage(sessionCtx, { phase: "metadata", label: "Checking prior shares", progress: 0 });
  const contentHash = await computeContentHash(fileBuffer);
  const previousHash = await resolvePreviousHash(contentHash, CONFIDENTIALITY_CHAIN_URL);

  emitStage(sessionCtx, { phase: "metadata", label: "Fetching provenance metadata", progress: 5 });
  const metadata = await requestMetadataBlock(sessionCtx, file, previousHash);

  emitStage(sessionCtx, { phase: "keys", label: "Verifying confidentiality keys", progress: 10 });
  const encryptionKeys = await requestEncryptionKeyBundle(sessionCtx);

  emitStage(sessionCtx, { phase: "hashing", label: "Hashing file contents", progress: 25 });
  const fileHash = await computeFileHash(fileBuffer, metadata);

  emitStage(sessionCtx, { phase: "signing", label: "Signing provenance block", progress: 55 });
  const signature = await signBlock(fileHash, metadata, sessionCtx.privateKey);

  await attachHashAndSignature(metadata.transferId, { fileHash, signature, contentHash });

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

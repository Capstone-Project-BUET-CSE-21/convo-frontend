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

// Thrown when the parent share the server chose for this send is missing
// from the history or fails signature re-verification. Kept distinguishable from generic
// network/validation errors so the caller (ChatFileShare's sendStagedFile)
// can show a message that's specific to "refusing to link to tampered
// history" instead of the generic send-failure text.
export class ProvenanceLinkError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProvenanceLinkError";
  }
}

// The server picks which earlier share this one continues (the latest share
// of this content that named the sender as a recipient — see
// TransferMetadataService.createPendingTransfer) and returns it as
// metadata.previousHash. Before signing on top of it, re-verify that parent
// so a send never links onto tampered history.
export const verifyParentShare = async (contentHash, previousHash, baseUrl) => {
  if (!previousHash) return;

  const history = await fetchChainHistory(contentHash, baseUrl);
  const parent = (history ?? []).find((entry) => entry.fileHash === previousHash);
  const verification = parent
    ? await makeVerifyHop(contentHash)(parent)
    : { valid: false, reason: "parent share not found" };
  if (!verification.valid) {
    throw new ProvenanceLinkError(
      `Refusing to link to prior share: ${verification.reason ?? "verification failed"}`
    );
  }
};

export const requestMetadataBlock = async (sessionCtx, file, contentHash) => {
  // Who this share is going to (already resolved to user IDs by the caller —
  // see ChatFileShare.jsx's sessionCtx.recipientIds). A later share by one of
  // these recipients is attached under this one in the file's history.
  const recipients = Array.isArray(sessionCtx.recipientIds) ? sessionCtx.recipientIds : [];
  if (recipients.length === 0) {
    throw new Error("Cannot request transfer metadata without at least one recipient");
  }

  const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/file-sharing/transfer/metadata`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId: sessionCtx.sessionId,
      senderId: sessionCtx.senderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      contentHash,
      recipients,
    }),
  });

  if (!response.ok) {
  const errorBody = await response.json().catch(() => ({}));
  throw new Error(`Metadata request failed: ${response.status} — ${errorBody.error || "unknown reason"}`);
}

  return response.json();
};

export const attachHashAndSignature = async (transferId, { fileHash, signature, contentHash }) => {
  const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/file-sharing/transfer/metadata/${transferId}`, {
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

      const response = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/file-sharing/keys/${recipientId}/ECDH-P256`, {
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

  emitStage(sessionCtx, { phase: "metadata", label: "Fetching provenance metadata", progress: 0 });
  const contentHash = await computeContentHash(fileBuffer);
  const metadata = await requestMetadataBlock(sessionCtx, file, contentHash);

  emitStage(sessionCtx, { phase: "metadata", label: "Checking prior shares", progress: 5 });
  await verifyParentShare(contentHash, metadata.previousHash, CONFIDENTIALITY_CHAIN_URL);

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
    return { wrappedBuffer: encrypted, contentHash };
  }

  emitStage(sessionCtx, { phase: "ready", label: "Ready to send", progress: 100 });
  return { wrappedBuffer: wrapped, contentHash };
}

// 5.3 — Cross-session trace verification.
//
// Used by the trace screen (screens/FileTraceScreen.jsx) to re-verify every
// share in a file's history, and by the send flow
// (pipeline/provenancePipeline.js) to re-verify the parent share before
// signing on top of it. Checks against the durable server-side history,
// never a local in-memory reconstruction.
//
// ChainHistoryResponseDto includes fileHash + signature (see
// convo-file-sharing's TransferMetadataService.getChainHistory), so
// verifyHop does real per-hop ECDSA signature re-verification, not just a
// content-hash sanity check. The DTO is flat (transferId, sessionId,
// senderId, fileName, fileSize, mimeType, timestamp, previousHash — no
// nested "metadata" object), so the provenance block canonicalize.js
// expects is reassembled from those fields below.
//
// There used to also be an isAuthorizedHop check here (was the sender a
// recorded recipient of the previous hop, or a session participant for a
// root hop). Removed deliberately: it could only ever confirm sharing that
// happened through Convo itself, so a completely legitimate hand-off done
// any other way (email, USB drive, a different app — or even the file's
// own original sender branching it out to someone new later, outside the
// recipient list they happened to pick at send time) would be flagged as
// "unauthorized" with no way to tell that apart from an actual leak. That's
// a false-positive rate real usage can't tolerate, not a fixable edge case.

import { fetchPublicKeys, verifyBlockWithHistory } from "../crypto/verify";

/**
 * Builds a verifier for one share of a file: (entry) => { valid, reason }.
 *
 * @param {string} contentHash the content hash every share must belong to
 */
export const makeVerifyHop = (contentHash) => async (entry) => {
  // Cheapest, always-available check: this row actually belongs to the
  // content we're tracing. Protects against a stray/misindexed row.
  if (entry.contentHash !== contentHash) {
    return { valid: false, reason: "content-hash-mismatch" };
  }

  // Full signature re-verification per hop. Reassemble the flat response
  // fields into the same shape canonicalize.js signs against — field names
  // must match exactly (fileName, fileSize, mimeType, previousHash,
  // senderId, sessionId, timestamp, transferId).
  if (entry.fileHash && entry.signature) {
    const metadataBlock = {
      transferId: entry.transferId,
      sessionId: entry.sessionId,
      senderId: entry.senderId,
      fileName: entry.fileName,
      fileSize: entry.fileSize,
      mimeType: entry.mimeType,
      timestamp: entry.timestamp,
      previousHash: entry.previousHash ?? null,
    };
    // Try the sender's full key history — a hop signed with a key the sender
    // has since rotated away from must still verify.
    const publicKeys = await fetchPublicKeys(entry.senderId);
    const result = await verifyBlockWithHistory(entry.signature, entry.fileHash, metadataBlock, publicKeys);
    if (!result.valid) {
      return { valid: false, reason: result.reason ?? "invalid-signature" };
    }
  }

  return { valid: true, reason: null };
};
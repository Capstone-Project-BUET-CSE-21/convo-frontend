// 5.3 — Cross-session trace verification.
//
// Plugs into Suchi's walkChain/traceChain (pipeline/chainReconstruct.js) as
// the verifyHop callback. This is what makes the trace/lineage screen check
// against Fariha's durable server-side chain instead of a local in-memory
// reconstruction (per the plan: "Check against Fariha's durable server-side
// chain, not local reconstruction").
//
// ChainHistoryResponseDto now includes fileHash + signature (see
// convo-file-sharing's TransferMetadataService.getChainHistory), so
// verifyHop does real per-hop ECDSA signature re-verification, not just a
// content-hash sanity check. The DTO is flat (transferId, sessionId,
// senderId, fileName, fileSize, mimeType, timestamp, previousHash — no
// nested "metadata" object), so the provenance block Canonicalizer.java /
// canonicalize.js expect is reassembled from those fields below.
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
//
// STILL OPEN: this depends on Anisa's real AES-GCM/keys work being live
// and on the frontend actually sending contentHash on PATCH (see
// pipeline/provenancePipeline.js — nothing currently populates or sends
// it), otherwise there's no history to query in the first place.

import { fetchPublicKeys, verifyBlockWithHistory } from "../crypto/verify";

/**
 * Builds the verifyHop callback walkChain expects: (entry) => { valid, reason }.
 *
 * @param {string} contentHash the content hash the trace screen is walking
 */
export const makeVerifyHop = (contentHash) => async (entry) => {
  // Cheapest, always-available check: this row actually belongs to the
  // content we're tracing. Protects against a stray/misindexed row.
  if (entry.contentHash !== contentHash) {
    return { valid: false, reason: "content-hash-mismatch" };
  }

  // Full signature re-verification per hop, now that fileHash/signature
  // are on the DTO. Reassemble the flat response fields into the same
  // shape Canonicalizer.java / canonicalize.js sign against — field names
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
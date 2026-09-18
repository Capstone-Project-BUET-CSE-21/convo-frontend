// 5.3 — Cross-session trace verification.
//
// Plugs into Suchi's walkChain/traceChain (pipeline/chainReconstruct.js) as
// the { verifyHop, isAuthorizedHop } callbacks. This is what makes the
// trace/lineage screen check against Fariha's durable server-side chain
// instead of a local in-memory reconstruction (per the plan: "Check
// against Fariha's durable server-side chain, not local reconstruction").
//
// ChainHistoryResponseDto now includes fileHash + signature (see
// convo-file-sharing's TransferMetadataService.getChainHistory), so
// verifyHop does real per-hop ECDSA signature re-verification, not just a
// content-hash sanity check. The DTO is flat (transferId, sessionId,
// senderId, fileName, fileSize, mimeType, timestamp, previousHash — no
// nested "metadata" object), so the provenance block Canonicalizer.java /
// canonicalize.js expect is reassembled from those fields below.
//
// STILL OPEN: this depends on Anisa's real AES-GCM/keys work being live
// and on the frontend actually sending contentHash on PATCH (see
// pipeline/provenancePipeline.js — nothing currently populates or sends
// it), otherwise there's no history to query in the first place.

import { fetchPublicKeys, verifyBlockWithHistory } from "../crypto/verify";
import { authHeaders } from "../auth/authFetch";

const participantsCache = new Map(); // sessionId -> Promise<Set<userId>>

// GET /api/file-sharing/sessions/{sessionId}/participants — convo-file-sharing's
// SessionParticipantService answers this by calling convo-backend's own
// internal API for the real meeting_user rows, not a separate copy. No
// corresponding registration call exists on this side — convo-backend's
// own meeting-entry flow is what creates the row this reads, before a
// client ever gets here.
export const fetchSessionParticipants = async (sessionId, baseUrl) => {
  if (!participantsCache.has(sessionId)) {
    const promise = fetch(`${baseUrl}/api/file-sharing/sessions/${sessionId}/participants`, { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Participants lookup failed for session ${sessionId}: ${res.status}`);
        }
        return res.json();
      })
      .then((rows) => new Set(rows.map((r) => r.userId)))
      .catch((err) => {
        participantsCache.delete(sessionId); // don't poison the cache on failure
        throw err;
      });
    participantsCache.set(sessionId, promise);
  }
  return participantsCache.get(sessionId);
};

export const clearParticipantsCache = () => participantsCache.clear();

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

/**
 * Builds the isAuthorizedHop callback walkChain expects:
 * (entry, chainIndex) => boolean.
 *
 * Real per-file ACL, not meeting attendance: every transfer now records who
 * it was actually sent to (TransferRecipient, populated from
 * MetadataRequestDto.recipients — see provenancePipeline.js). A non-root
 * hop is authorized iff its sender was named as a recipient by whoever held
 * the file immediately before them — i.e. "did the previous holder actually
 * hand this to them," not "were they merely present in the same meeting."
 *
 * A root hop (previousHash === null) has no prior holder to have authorized
 * it, so there's nothing to check it against except the session it claims
 * to have originated in — session_participants remains the fallback there,
 * and only there. See the note this replaces in SessionParticipantService
 * for why that's a weaker signal in general.
 *
 * @param {string} baseUrl confidentiality service base URL
 */
export const makeIsAuthorizedHop = (baseUrl) => async (entry, chainIndex) => {
  if (!entry.previousHash) {
    try {
      const participants = await fetchSessionParticipants(entry.sessionId, baseUrl);
      return participants.has(entry.senderId);
    } catch {
      // Fail closed: if we can't confirm authorization, treat the hop as
      // unauthorized rather than silently passing it through. The trace
      // screen surfaces this distinctly (see FileTraceScreen.jsx).
      return false;
    }
  }

  const ancestor = chainIndex?.get(entry.previousHash);
  if (!ancestor) {
    // walkChain already treats a missing link as "broken" before it ever
    // reaches authorization, so this shouldn't happen in practice — fail
    // closed anyway rather than assuming authorized.
    return false;
  }

  const recipients = Array.isArray(ancestor.recipients) ? ancestor.recipients : [];
  return recipients.includes(entry.senderId);
};
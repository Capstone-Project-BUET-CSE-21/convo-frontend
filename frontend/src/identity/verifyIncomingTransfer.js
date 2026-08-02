// // 5.2 — Orchestrates verification + identity mapping for a received file.
// //
// // This is the single entry point screens/MeetingRoom.jsx calls once a file
// // has been reassembled and unwrapped (Unmona's 1.2 → Suchi's chainReconstruct
// // → here). It does NOT re-implement hashing, signing, or chain-linking —
// // it just calls each person's module in the order the manual's "Build
// // order" diagram specifies, and only proceeds to identity mapping once
// // every check has passed (§5.2 Task 4 — never map identity on untrusted
// // data).

// import { fetchPublicKey, importPublicKey, verifyBlock } from "../crypto/verify";
// import { reconstructChain } from "../pipeline/chainReconstruct";
// import { verifyBlockHash, verifyChainLinkage } from "../pipeline/hashVerify";
// import { resolveSenderName } from "./senderIdentity";

// // reason is one of:
// //   'hash-mismatch'   — file bytes don't match what was signed (5.1)
// //   'chain-broken'    — previousHash doesn't resolve (5.1 + Suchi's 4.2 Task 3)
// //   'key-not-found'   — sender's public key isn't registered yet (2.4 Task 2)
// //   'invalid-signature' — signature doesn't match (2.4)
// const rejected = (reason) => ({
//   valid: false,
//   reason,
//   senderName: null,
//   timestamp: null,
// });

// /**
//  * @param {object} params
//  * @param {object} params.signedBlock   { metadata, fileHash, signature } — from unwrapPayload
//  * @param {ArrayBuffer} params.fileBytes
//  * @param {Map} params.chainStore       per-session store from createChainStore()
//  * @param {Map} [params.peerNames]      peerId -> display name, already known to the meeting
//  * @param {string} [params.fallbackName] name carried in the transfer's own metadata, used if peerNames doesn't have it yet
//  * @param {string} [params.sessionName]  human label for the session/room (optional)
//  */
// export const verifyIncomingTransfer = async ({
//   signedBlock,
//   fileBytes,
//   chainStore,
//   peerNames,
//   fallbackName,
//   sessionName,
// }) => {
//   // Suchi's chain reconstruction — links this block to any prior one and
//   // flags an unresolved gap.
//   const { priorBlock, chainBroken } = reconstructChain(signedBlock, chainStore);

//   // 5.1 Task 1: hash check first — cheapest check, and there's no point
//   // checking signatures or chain linkage on a file that's already corrupt.
//   const hashOk = await verifyBlockHash(signedBlock, fileBytes);
//   if (!hashOk) {
//     return rejected("hash-mismatch");
//   }

//   // 5.1 Task 2: chain-linkage check. reconstructChain already flags an
//   // unresolved gap via chainBroken; verifyChainLinkage re-derives the same
//   // condition directly from the metadata so this doesn't silently depend on
//   // Suchi's internal implementation staying in sync.
//   const chainOk = !chainBroken && verifyChainLinkage(signedBlock, priorBlock);
//   if (!chainOk) {
//     return rejected("chain-broken");
//   }

//   // Anisa's 2.4 — signature verification.
//   const publicKeyBase64 = await fetchPublicKey(signedBlock.metadata.senderId);
//   const publicKey = publicKeyBase64 ? await importPublicKey(publicKeyBase64) : null;
//   const sigResult = await verifyBlock(
//     signedBlock.signature,
//     signedBlock.fileHash,
//     signedBlock.metadata,
//     publicKey
//   );

//   if (!sigResult.valid) {
//     return rejected(sigResult.reason ?? "invalid-signature");
//   }

//   // 5.2 Task 1: only now — after every check passed — do we map identity.
//   const senderName = resolveSenderName(signedBlock.metadata.senderId, {
//     peerNames,
//     fallbackName,
//   });

//   return {
//     valid: true,
//     reason: null,
//     senderName,
//     sessionName: sessionName ?? null,
//     timestamp: signedBlock.metadata.timestamp,
//   };
// };

// Added by Taba
import { fetchPublicKey, importPublicKey, verifyBlock } from "../crypto/verify";
import { resolvePriorBlockDurable } from "../pipeline/chainReconstruct";
import { verifyBlockHash, verifyChainLinkage } from "../pipeline/hashVerify";
import { computeContentHash } from "../crypto/hashing";
import { resolveSenderName } from "./senderIdentity";

const rejected = (reason) => ({
  valid: false,
  reason,
  senderName: null,
  timestamp: null,
});

/**
 * @param {object} params
 * @param {object} params.signedBlock    { metadata, fileHash, signature } — from unwrapPayload
 * @param {ArrayBuffer} params.fileBytes
 * @param {string} params.baseUrl        confidentiality service base URL (same one
 *                                        provenancePipeline.js uses for
 *                                        /api/transfer/metadata/history/{contentHash})
 * @param {Map} [params.peerNames]
 * @param {string} [params.fallbackName]
 * @param {string} [params.sessionName]
 */
export const verifyIncomingTransfer = async ({
  signedBlock,
  fileBytes,
  baseUrl,
  peerNames,
  fallbackName,
  sessionName,
}) => {
  // 5.1 Task 1: cheapest, local check first — no point verifying chain
  // linkage or signature on a file that's already corrupt.
  const hashOk = await verifyBlockHash(signedBlock, fileBytes);
  if (!hashOk) {
    return rejected("hash-mismatch");
  }

  // 5.1 Task 2 (revised): resolve previousHash against the backend's
  // durable chain history rather than an in-session Map. contentHash is
  // the same content-addressed hash the sender already computes via
  // computeContentHash() and PATCHes to the backend — it's stable across
  // resends/re-encryptions and independent of this block's own metadata,
  // so it's the correct key for a cross-session lookup.
  let priorBlock, chainBroken;
  try {
    const contentHash = await computeContentHash(fileBytes);
    ({ priorBlock, chainBroken } = await resolvePriorBlockDurable(
      contentHash,
      signedBlock.metadata.previousHash,
      baseUrl
    ));
  } catch (err) {
    console.error("Durable chain history lookup failed:", err);
    // Fail closed: if we can't confirm linkage against the backend,
    // treat it as broken rather than silently accepting it.
    return rejected("chain-lookup-failed");
  }

  const chainOk = !chainBroken && verifyChainLinkage(signedBlock, priorBlock);
  if (!chainOk) {
    return rejected("chain-broken");
  }

  // Anisa's 2.4 — signature verification (unchanged).
  const publicKeyBase64 = await fetchPublicKey(signedBlock.metadata.senderId);
  const publicKey = publicKeyBase64 ? await importPublicKey(publicKeyBase64) : null;
  const sigResult = await verifyBlock(
    signedBlock.signature,
    signedBlock.fileHash,
    signedBlock.metadata,
    publicKey
  );

  if (!sigResult.valid) {
    return rejected(sigResult.reason ?? "invalid-signature");
  }

  // 5.2 Task 1: identity mapping only after every check passed (unchanged).
  const senderName = resolveSenderName(signedBlock.metadata.senderId, {
    peerNames,
    fallbackName,
  });

  return {
    valid: true,
    reason: null,
    senderName,
    sessionName: sessionName ?? null,
    timestamp: signedBlock.metadata.timestamp,
  };
};
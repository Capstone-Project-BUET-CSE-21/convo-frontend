// 5.1 — Hash verification & chain-linkage check
//
// This deliberately reuses computeFileHash (../crypto/hashing) rather
// than reimplementing SHA-256 hashing — divergent implementations are the
// #1 cause of "verification always fails" bugs (see manual §5.1 Task 1).

import { computeFileHash } from "../crypto/hashing";

// 5.1 Task 1: recompute the file hash from the received bytes + metadata and
// compare against what the sender signed. If a single byte of the file (or
// the metadata) changed in transit, this will not match.
export const verifyBlockHash = async (signedBlock, fileBytes) => {
  const recomputed = await computeFileHash(fileBytes, signedBlock.metadata);
  return recomputed === signedBlock.fileHash;
};

// 5.1 Task 2: confirm this block's declared previousHash actually resolves
// to the prior block reconstructChain (pipeline/chainReconstruct.js)
// found in the chain store. A block with no previousHash is valid as the
// first link in the chain.
export const verifyChainLinkage = (signedBlock, priorBlock) => {
  const { previousHash } = signedBlock.metadata;
  if (!previousHash) return true;
  return priorBlock != null && previousHash === priorBlock.fileHash;
};

// 5.1 Task 3: structured result so callers (identity mapping / UI) can
// distinguish *why* a file was rejected instead of just pass/fail.
// reason is one of: 'hash-mismatch' | 'chain-broken'.
export const verifyReceivedBlock = async (signedBlock, fileBytes, priorBlock) => {
  const hashOk = await verifyBlockHash(signedBlock, fileBytes);
  if (!hashOk) {
    return { valid: false, reason: "hash-mismatch" };
  }

  const chainOk = verifyChainLinkage(signedBlock, priorBlock);
  if (!chainOk) {
    return { valid: false, reason: "chain-broken" };
  }

  return { valid: true, reason: null };
};
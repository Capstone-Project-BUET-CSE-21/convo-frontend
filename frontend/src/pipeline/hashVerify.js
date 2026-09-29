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
// to a real earlier share in the durable history (resolvePriorBlockDurable
// in pipeline/chainReconstruct.js). A block with no previousHash starts its
// own tree and is valid on its own.
export const verifyChainLinkage = (signedBlock, priorBlock) => {
  const { previousHash } = signedBlock.metadata;
  if (!previousHash) return true;
  return priorBlock != null && previousHash === priorBlock.fileHash;
};
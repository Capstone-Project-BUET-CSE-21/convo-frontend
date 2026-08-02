import { MAGIC, VERSION, HEADER_LENGTH } from "./wireFormat";

// 4.2 Task 1: exact inverse of buildHeader. Throws on malformed input
// rather than guessing, so Unmona's Task 4 (surface a clear error state)
// has something concrete to catch.
export const parseHeader = (buffer) => {
  if (buffer.byteLength < HEADER_LENGTH) {
    throw new Error("Malformed provenance wrapper: buffer shorter than header");
  }

  const view = new DataView(buffer);

  const magic = view.getUint32(0, false);
  if (magic !== MAGIC) 
    throw new Error("Malformed provenance wrapper: bad magic bytes");
  }

  const version = view.getUint8(4);
  if (version !== VERSION) {
    throw new Error(`Unsupported provenance wrapper version: ${version}`);
  }

  const jsonLength = view.getUint32(5, false);
  const jsonStart = HEADER_LENGTH;
  const jsonEnd = jsonStart + jsonLength;

  if (jsonEnd > buffer.byteLength) {
    throw new Error(
      "Malformed provenance wrapper: declared metadata length exceeds buffer size"
    );
  }

  const jsonBytes = buffer.slice(jsonStart, jsonEnd);
  let signedBlock;
  try {
    signedBlock = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch (err) {
    throw new Error("Malformed provenance wrapper: signed block is not valid JSON(" + err.message + ")");
  }

  const fileBytes = buffer.slice(jsonEnd);
  return { signedBlock, fileBytes };
}

// This is the exact export name referenced in Unmona's 1.2 Task 2 —
// coordinate here so nobody has to rename anything downstream.
export const unwrapPayload = (buffer) => {
  return parseHeader(buffer);
}

// pipeline/chainReconstruct.js
// ---------------------------------------------------------------
// v1 API — NOTE: not used for receive-side verification anymore.
// It only reflects blocks seen in-session, which produces false
// "chain broken" results the first time a file crosses sessions,
// and a false PASS on the very next attempt once that block gets
// cached locally (see identity/verifyIncomingTransfer.js — this
// was the actual root cause of the Meeting A -> Meeting B bug).
// Kept only as optional local scaffolding (e.g. optimistic UI),
// never as the verification source of truth. Use
// resolvePriorBlockDurable for verification.
// ---------------------------------------------------------------
export const createChainStore = () => {
  return new Map();
}

export const reconstructChain = (signedBlock, chainStore) => {
  const { previousHash } = signedBlock.metadata;
  const priorBlock = previousHash ? chainStore.get(previousHash) ?? null : null;
  const chainBroken = Boolean(previousHash) && priorBlock === null;

  chainStore.set(signedBlock.fileHash, signedBlock);

  return { signedBlock, priorBlock, chainBroken };
}

// ---------------------------------------------------------------
// v2 API — backend-backed. Used by the trace/lineage screen AND
// (as of this change) by receive-side verification.
// ---------------------------------------------------------------
// export const fetchChainHistory = async (contentHash, baseUrl) => {
//   // GET /api/transfer/metadata/history/{contentHash} — TransferMetadataController
//   const res = await fetch(`${baseUrl}/api/transfer/metadata/history/${contentHash}`);
//   if (!res.ok) {
//     throw new Error(`Chain history lookup failed: ${res.status} ${res.statusText}`);
//   }
//   return res.json();
// }

export const fetchChainHistory = async (contentHash, baseUrl) => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, ""); // strip any trailing slash(es)
  const res = await fetch(`${normalizedBaseUrl}/api/transfer/metadata/history/${contentHash}`);
  if (!res.ok) {
    throw new Error(`Chain history lookup failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const buildChainIndex = (entries) => {
  const byFileHash = new Map();
  for (const entry of entries) {
    if (!entry.fileHash) {
      throw new Error(
        "Chain history entry is missing fileHash — ChainHistoryResponseDto must include " +
        "each row's own fileHash for the walk to link entries by previousHash."
      );
    }
    byFileHash.set(entry.fileHash, entry);
  }
  return byFileHash;
}

export const loadChainIndex = async (contentHash, baseUrl) => {
  const entries = await fetchChainHistory(contentHash, baseUrl);
  return buildChainIndex(entries);
}

// ---------------------------------------------------------------
// Receive-side durable linkage resolution. Resolves previousHash
// against the backend's authoritative chain history for this
// file's content, not against anything seen locally in-browser.
// This is what verifyIncomingTransfer.js calls in place of
// reconstructChain().
// ---------------------------------------------------------------
export const resolvePriorBlockDurable = async (contentHash, previousHash, baseUrl) => {
  if (!previousHash) {
    // No previousHash declared — this block claims to be a root link.
    // Nothing to resolve against; verifyChainLinkage treats null
    // previousHash as valid on its own.
    return { priorBlock: null, chainBroken: false };
  }

  const chainIndex = await loadChainIndex(contentHash, baseUrl);
  const priorBlock = chainIndex.get(previousHash) ?? null;
  const chainBroken = priorBlock === null;

  return { priorBlock, chainBroken };
}

export const walkChain = async (startEntry, chainIndex, { verifyHop, isAuthorizedHop }) => {
  const hops = [];
  let current = startEntry;

  while (current) {
    const verification = await verifyHop(current);
    if (!verification.valid) {
      hops.push({ entry: current, status: "broken", reason: verification.reason ?? "verification-failed" });
      return { hops, stopReason: "broken" };
    }

    const authorized = await isAuthorizedHop(current);
    if (!authorized) {
      hops.push({ entry: current, status: "unauthorized", reason: "sender-not-a-permitted-participant" });
      return { hops, stopReason: "unauthorized" };
    }

    hops.push({ entry: current, status: "ok", reason: null });

    const previousHash = current.previousHash;
    if (!previousHash) {
      return { hops, stopReason: "root" };
    }

    const prior = chainIndex.get(previousHash);
    if (!prior) {
      hops.push({ entry: null, status: "broken", reason: "missing-link", missingHash: previousHash });
      return { hops, stopReason: "broken" };
    }

    current = prior;
  }

  return { hops, stopReason: "root" };
}

export const traceChain = async (contentHash, startFileHash, baseUrl, { verifyHop, isAuthorizedHop }) => {
  const chainIndex = await loadChainIndex(contentHash, baseUrl);
  const startEntry = chainIndex.get(startFileHash);
  if (!startEntry) {
    throw new Error(`Starting fileHash "${startFileHash}" not found in chain history for this content.`);
  }
  return walkChain(startEntry, chainIndex, { verifyHop, isAuthorizedHop });
}
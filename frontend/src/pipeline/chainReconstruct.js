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
  if (magic !== MAGIC) {
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

// ---------------------------------------------------------------
// v1 API — kept as-is, NOT replaced. This is what Debashri's
// hashVerify.js / verifyIncomingTransfer.js already call on receipt,
// for an immediate single-hop check within the current live session
// (no network round trip needed, since the server already validated
// previousHash at POST time — this is just the client's own quick
// "does this line up with what I've already seen" check).
// The new multi-hop walk below is a separate, additive feature for
// cross-session trace-back and does not replace this.
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
// v2 API — new multi-hop, backend-backed trace-back. Used by the
// trace/lineage screen, not by the real-time receipt path above.
// ---------------------------------------------------------------
export const fetchChainHistory = async (contentHash, baseUrl) => {
  // Confirmed route from Fariha's TransferMetadataController:
  // GET /api/transfer/metadata/history/{contentHash}
  const res = await fetch(`${baseUrl}/api/transfer/metadata/history/${contentHash}`);
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
        "each row's own fileHash for the walk to link entries by previousHash. " +
        "This needs to be added on Fariha's side before the walk can run."
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
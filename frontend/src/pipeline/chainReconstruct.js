import { MAGIC, VERSION, HEADER_LENGTH } from "./wireFormat";
import { authHeaders } from "../auth/authFetch";

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
// Backend-backed chain history. Used by the trace screen and by
// receive-side verification.
// ---------------------------------------------------------------
export const fetchChainHistory = async (contentHash, baseUrl) => {
  // GET /api/file-sharing/transfer/metadata/history/{contentHash} — TransferMetadataController
  // const res = await fetch(`${baseUrl}/api/file-sharing/transfer/metadata/history/${contentHash}`);
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, ""); // strip any trailing slash(es)
  const res = await fetch(`${normalizedBaseUrl}/api/file-sharing/transfer/metadata/history/${contentHash}`, {
    headers: authHeaders(),
  });
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
// Called by verifyIncomingTransfer.js.
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

// A file's history is a forest: a share continues the earlier share its
// sender received the file on, and a share by someone who never received it
// through Convo starts its own tree (see convo-file-sharing's
// TransferMetadataService.createPendingTransfer). This turns the flat
// history into every root-to-leaf path, one step per (share, recipient), so
//   Charlie→[Alice], Charlie→[Bob], Alice→[Dave]
// becomes
//   [Charlie→Alice, Alice→Dave] and [Charlie→Bob].
//
// A share only continues its parent if its sender was one of the parent's
// recipients. Shares recorded before the server chose parents this way were
// linked to whatever was newest; this rule shows those exactly as the
// current design would have recorded them, instead of inventing hand-offs.
export const buildSharePaths = (entries) => {
  const byFileHash = buildChainIndex(entries);
  const continues = (entry) => {
    const parent = entry.previousHash ? byFileHash.get(entry.previousHash) : null;
    return Boolean(parent?.recipients?.some((r) => r.userId === entry.senderId));
  };

  const childrenOf = new Map();
  const roots = [];
  for (const entry of entries) {
    if (continues(entry)) {
      const siblings = childrenOf.get(entry.previousHash) ?? [];
      siblings.push(entry);
      childrenOf.set(entry.previousHash, siblings);
    } else {
      roots.push(entry);
    }
  }

  const paths = [];
  const extend = (share, steps) => {
    const recipients = share.recipients?.length ? share.recipients : [null];
    for (const recipient of recipients) {
      const path = [...steps, { share, recipient }];
      const next = (childrenOf.get(share.fileHash) ?? [])
        .filter((child) => recipient && child.senderId === recipient.userId);
      if (next.length === 0) {
        paths.push(path);
      } else {
        next.forEach((child) => extend(child, path));
      }
    }
  };
  roots.forEach((root) => extend(root, []));
  return paths;
};

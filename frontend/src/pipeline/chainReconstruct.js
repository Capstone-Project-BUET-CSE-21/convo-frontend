import { MAGIC, VERSION, HEADER_LENGTH } from "./wireFormat";

// 4.2 Task 1: exact inverse of buildHeader. Throws on malformed input
// rather than guessing, so Unmona's Task 4 (surface a clear error state)
// has something concrete to catch.
export function parseHeader(buffer) {
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
    throw new Error("Malformed provenance wrapper: signed block is not valid JSON");
  }

  const fileBytes = buffer.slice(jsonEnd);
  return { signedBlock, fileBytes };
}

// This is the exact export name referenced in Unmona's 1.2 Task 2 —
// coordinate here so nobody has to rename anything downstream.
export function unwrapPayload(buffer) {
  return parseHeader(buffer);
}

// 4.2 Task 2: per-session store, keyed by fileHash so each block can be
// linked to its previousHash. Plain Map for now; swap for an IndexedDB
// wrapper later if chains need to survive a reload without changing
// reconstructChain's call signature.
export function createChainStore() {
  return new Map();
}

// 4.2 Task 3: if previousHash is set but doesn't resolve, flag it —
// this is the actual tamper/gap detection, so we never silently treat
// a gap as "chain just started here."
export function reconstructChain(signedBlock, chainStore) {
  const { previousHash } = signedBlock.metadata;
  const priorBlock = previousHash ? chainStore.get(previousHash) ?? null : null;
  const chainBroken = Boolean(previousHash) && priorBlock === null;

  chainStore.set(signedBlock.fileHash, signedBlock);

  return { signedBlock, priorBlock, chainBroken };
}
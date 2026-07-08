import { concatBuffers } from "../crypto/canonicalize";
import { MAGIC, VERSION, HEADER_LENGTH } from "./wireFormat";

// 4.1 Task 1: builds the 9-byte header exactly per section 0.6 —
// magic (4 bytes BE), version (1 byte), metadataBlockLength (4 bytes BE).
function buildHeader(jsonByteLength) {
  const header = new ArrayBuffer(HEADER_LENGTH);
  const view = new DataView(header);
  view.setUint32(0, MAGIC, false);       // false = big-endian
  view.setUint8(4, VERSION);
  view.setUint32(5, jsonByteLength, false);
  return header;
}

export function embedProvenanceBlock(fileBuffer, metadata, fileHash, signature) {
  const signedBlock = { metadata, fileHash, signature }; // section 0.5
  const jsonBytes = new TextEncoder().encode(JSON.stringify(signedBlock));
  const header = buildHeader(jsonBytes.length);

  // header + signed-block JSON + raw file bytes, in that order (0.6)
  return concatBuffers(header, jsonBytes, fileBuffer);
}

// Exported for the round-trip test / anyone who needs header size elsewhere.
export { buildHeader };
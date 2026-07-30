import { canonicalize, concatBuffers, bufferToHex } from "./canonicalize";

export const computeFileHash = async (fileBuffer, metadataBlock) => {
  const metaBytes = new TextEncoder().encode(canonicalize(metadataBlock));
  const combined = concatBuffers(fileBuffer, metaBytes);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return bufferToHex(digest);
}

// Additive — per the plan (Anisa 2.x): "a new, additive content-only hash
// function (file bytes alone, nothing else mixed in) — separate from the
// signing hash, not a replacement." computeFileHash above stays untouched
// and is still what gets signed; this is only for identifying "is this the
// same file content" across sessions (MetadataPatchDto.contentHash /
// TransferMetadata.content_hash), independent of which session or metadata
// it was shared under.
//
// Required by screens/FileSharingTestPage.jsx — without this export the
// test page throws "computeContentHash is not a function" as soon as you
// run a simulation.
export const computeContentHash = async (fileBuffer) => {
  const digest = await crypto.subtle.digest("SHA-256", fileBuffer);
  return bufferToHex(digest);
}
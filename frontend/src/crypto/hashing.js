import { canonicalize, concatBuffers, bufferToHex } from "./canonicalize";

export async function computeFileHash(fileBuffer, metadataBlock) {
  const metaBytes = new TextEncoder().encode(canonicalize(metadataBlock));
  const combined = concatBuffers(fileBuffer, metaBytes);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  return bufferToHex(digest);
}
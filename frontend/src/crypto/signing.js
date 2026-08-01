import { canonicalize } from "./canonicalize";
import { concatBuffers, hexToBuffer, bufferToBase64 } from "./buffers";

export const signBlock = async (fileHash, metadataBlock, privateKey) => {
  const payload = concatBuffers(
    hexToBuffer(fileHash),
    hexToBuffer(metadataBlock.previousHash ?? ""),
    new TextEncoder().encode(canonicalize(metadataBlock))
  );

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    payload
  );

  return bufferToBase64(signature);
}
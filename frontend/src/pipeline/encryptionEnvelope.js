import { importECDHPublicKey, deriveSharedKey, fetchECDHPublicKey } from "../crypto/ecdh";
import { encryptData, decryptData, generateContentKey, exportRawKey, importRawKey } from "../crypto/aesGcm";
import { getPrivateKey } from "../crypto/keypair";

// Envelope encryption: one random content key encrypts the wrapped
// provenance buffer ONCE. That content key is then wrapped separately per
// recipient using an ECDH-derived shared key, so a file sent to N peers is
// encrypted once, not N times.
export const encryptPayload = async (wrappedBuffer, { senderId, encryptionKeys }) => {
  const senderPrivateKey = await getPrivateKey(senderId, "ECDH-P256");
  if (!senderPrivateKey) {
    throw new Error("No ECDH private key found for sender — cannot encrypt");
  }

  const contentKey = await generateContentKey();
  const { ciphertext, iv } = await encryptData(contentKey, wrappedBuffer);
  const rawContentKeyBase64 = await exportRawKey(contentKey);

  const recipients = {};
  for (const [recipientId, keyRecord] of Object.entries(encryptionKeys)) {
    const recipientPublicKey = await importECDHPublicKey(keyRecord.publicKey);
    const sharedKey = await deriveSharedKey(senderPrivateKey, recipientPublicKey);
    const wrappedKey = await encryptData(sharedKey, new TextEncoder().encode(rawContentKeyBase64));
    recipients[recipientId] = { wrappedKey: wrappedKey.ciphertext, iv: wrappedKey.iv };
  }

  const envelope = { senderId, iv, ciphertext, recipients };
  console.log("SENDING — ciphertext length:", ciphertext.length, "iv:", iv);
  return new TextEncoder().encode(JSON.stringify(envelope)).buffer;
}

// senderPublicKeyBase64 is the sender's live session ECDH key, announced to us
// over the data channel (see the meeting session-key handshake) — the exact
// device key the sender encrypted with. We fall back to the sender's current
// registered key only if no announced key was provided (e.g. an older peer that
// doesn't announce), which is the legacy "latest key" path.
export const decryptPayload = async (envelopeBuffer, { recipientId, senderPublicKeyBase64 }) => {
  const envelope = JSON.parse(new TextDecoder().decode(envelopeBuffer));
  const { senderId, iv, ciphertext, recipients } = envelope;

  const myEntry = recipients[recipientId];
  if (!myEntry) {
    throw new Error("This file was not encrypted for this recipient");
  }

  const recipientPrivateKey = await getPrivateKey(recipientId, "ECDH-P256");
  if (!recipientPrivateKey) {
    throw new Error("No ECDH private key found — cannot decrypt");
  }

  const resolvedSenderKey = senderPublicKeyBase64 ?? await fetchECDHPublicKey(senderId);
  if (!resolvedSenderKey) {
    throw new Error(`No ECDH public key available for sender ${senderId}`);
  }
  const senderPublicKey = await importECDHPublicKey(resolvedSenderKey);

  const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);
  const rawContentKeyBytes = await decryptData(sharedKey, myEntry.wrappedKey, myEntry.iv);
  const contentKey = await importRawKey(new TextDecoder().decode(rawContentKeyBytes));
  console.log("RECEIVING — ciphertext length:", ciphertext.length, "iv:", iv);
  return decryptData(contentKey, ciphertext, iv);
}
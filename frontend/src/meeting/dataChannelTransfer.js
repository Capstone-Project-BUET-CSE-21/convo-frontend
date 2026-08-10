// File-transfer over the WebRTC data channel: the session-key handshake and the
// receive/decrypt/verify pipeline for incoming files. Factored out of the
// session hook as a factory that closes over the refs and state setters it
// needs, keeping the hook itself focused on signaling/media orchestration.

import { decodeChunkFrame, reassembleChunkFrames } from "../pipeline/transferFrames";
import { unwrapPayload } from "../pipeline/chainReconstruct";
import { verifyIncomingTransfer } from "../identity/verifyIncomingTransfer";
import { decryptPayload } from "../pipeline/encryptionEnvelope";
import { getLocalPublicKeyBase64 } from "../crypto/keypair";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

// Backpressure threshold for the file-transfer data channel (1 MiB).
const BUFFERED_AMOUNT_LOW_THRESHOLD = 1024 * 1024;

export const createDataChannelTransfer = ({
  authUser,
  roomId,
  dataChannelsRef,
  incomingTransfersRef,
  peerSessionKeysRef,
  // A ref that always holds the latest peerNames Map — read live so display
  // names resolve correctly even though a channel's onmessage handler is bound
  // once at channel-creation time.
  peerNamesRef,
  setChatMessages,
}) => {
  // Announce this device's live ECDH public key to the peer as soon as the
  // channel is usable, so they encrypt files to the key we're actually using in
  // this meeting (not whatever key is newest in the registry). Sent on open, so
  // it always arrives before any file transfer the user could trigger.
  const announceSessionKey = async (channel) => {
    try {
      const ecdhPublicKey = await getLocalPublicKeyBase64(authUser.id, "ECDH-P256");
      if (ecdhPublicKey && channel.readyState === "open") {
        channel.send(JSON.stringify({ kind: "session-key", userId: authUser.id, ecdhPublicKey }));
      }
    } catch (err) {
      console.error("Failed to announce session key:", err);
    }
  };

  const handleDataChannelMessage = async (peerId, data) => {
    const peerNames = peerNamesRef.current;

    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.kind === "session-key") {
        // The peer's live ECDH key for this session. We trust WHO the peer is
        // from the signaling layer (peerUserIds); this just tells us which of
        // their keys to encrypt to / decrypt with here. A peer that announces a
        // bogus key only denies itself the transfer, so no cross-check is
        // required for confidentiality.
        if (typeof msg.ecdhPublicKey === "string" && msg.ecdhPublicKey) {
          peerSessionKeysRef.current.set(peerId, msg.ecdhPublicKey);
        }
        return;
      }

      if (msg.kind === "wrapped-file-meta") {
        incomingTransfersRef.current.set(peerId, {
          meta: msg,
          chunks: new Map(),
          chunkCount: msg.totalChunks,
          receivedBytes: 0,
        });
        return;
      }

      if (msg.kind === "wrapped-file-end") {
        const transfer = incomingTransfersRef.current.get(peerId);
        if (!transfer || transfer.meta.transferId !== msg.transferId) return;
        console.log("File metadata received:", transfer.meta.fileName, transfer.meta);
        if (transfer.chunkCount == null || transfer.chunks.size !== transfer.chunkCount) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: "Could not receive file: incomplete chunk stream.",
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        let wrappedBuffer;
        try {
          const orderedChunks = Array.from({ length: transfer.chunkCount }, (_, index) => {
            const chunk = transfer.chunks.get(index);
            if (!chunk) {
              throw new Error(`Missing chunk ${index}`);
            }
            return chunk;
          });
          wrappedBuffer = reassembleChunkFrames(orderedChunks);
        } catch (err) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: `Could not receive file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        // with:
        let decryptedBuffer;
        console.log("Decrypting as authUser.id:", authUser.id);
        try {
          decryptedBuffer = await decryptPayload(wrappedBuffer, {
            recipientId: authUser.id,
            // The sender's live session key, announced by this peer over the
            // channel — the exact device key they encrypted with. Falls back to
            // the registry inside decryptPayload if the peer didn't announce.
            senderPublicKeyBase64: peerSessionKeysRef.current.get(peerId),
          });
        } catch (err) {
          console.error("Decrypt error:", err.name, err.message, err);
          setChatMessages((prev) => [
            ...prev,

            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: `Could not decrypt file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }
        let signedBlock;
        let fileBytes;
        try {
          ({ signedBlock, fileBytes } = unwrapPayload(decryptedBuffer));
        } catch (err) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: `Could not receive file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        const blob = new Blob([fileBytes], {
          type: transfer.meta.fileType || "application/octet-stream",
        });
        const fileUrl = URL.createObjectURL(blob);

        let provenance;
        try {
          provenance = await verifyIncomingTransfer({
            signedBlock,
            fileBytes,
            baseUrl: CONFIDENTIALITY_CHAIN_URL,   // NOT BACKEND_URL — this is the
                                                      // service that owns /api/transfer/metadata,
                                                      // same one provenancePipeline.js posts to
            peerNames,
            fallbackName: peerNames.get(peerId) || transfer.meta.fromName,
            sessionName: roomId,
          });
        } catch (err) {
          console.error("Provenance verification failed unexpectedly:", err);
          provenance = { valid: false, reason: "verification error", senderName: null, timestamp: null };
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            type: "file",
            from: peerId,
            fromName: peerNames.get(peerId) || transfer.meta.fromName,
            to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
            fileId: transfer.meta.transferId,
            fileUrl,
            fileName: transfer.meta.fileName,
            fileType: transfer.meta.fileType,
            fileSize: transfer.meta.fileSize,
            time: transfer.meta.time,
            isMine: false,
            provenance,
          },
        ]);

        incomingTransfersRef.current.delete(peerId);
        return;
      }

      return;
    }

    const transfer = incomingTransfersRef.current.get(peerId);
    if (!transfer) return;

    try {
      const { chunkIndex, payload } = decodeChunkFrame(data);
      transfer.chunks.set(chunkIndex, payload);
      transfer.receivedBytes += payload.byteLength;
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          type: "chat",
          from: peerId,
          fromName: peerNames.get(peerId) || "Guest",
          to: authUser.id,
          text: `Could not receive file chunk: ${err.message}`,
          time: Date.now(),
          isMine: false,
          error: true,
        },
      ]);
      incomingTransfersRef.current.delete(peerId);
    }
  };

  const setupDataChannel = (peerId, channel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    dataChannelsRef.current.set(peerId, channel);

    if (channel.readyState === "open") {
      announceSessionKey(channel);
    } else {
      channel.addEventListener("open", () => announceSessionKey(channel), { once: true });
    }

    channel.onclose = () => {
      dataChannelsRef.current.delete(peerId);
      incomingTransfersRef.current.delete(peerId);
      peerSessionKeysRef.current.delete(peerId);
    };

    channel.onerror = (err) => {
      const isExpectedAbort =
        err?.error?.message?.includes("User-Initiated Abort") ||
        err?.error?.message?.includes("Close called");

      if (isExpectedAbort) return;
      console.error(`Data channel error with ${peerId}:`, err);
    };

    channel.onmessage = (e) => handleDataChannelMessage(peerId, e.data);
  };

  return { setupDataChannel };
};

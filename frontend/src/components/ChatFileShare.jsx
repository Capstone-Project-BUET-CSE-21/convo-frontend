import { forwardRef, useImperativeHandle, useRef } from "react";
import PropTypes from "prop-types";
import "./ChatFileShare.css";
import { prepareFileForTransfer } from "../pipeline/provenancePipeline";
import { splitBufferIntoChunkFrames, DATA_CHANNEL_CHUNK_PAYLOAD_BYTES } from "../pipeline/transferFrames";
import { getPrivateKey } from "../crypto/keypair";

const EVERYONE = "__everyone__";

// Browser-memory guard, not a backend limit — transfers are P2P over
// RTCDataChannel now, so the ceiling is "how much can comfortably live in
// memory on both ends" rather than an upload quota.
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Resolves once the channel has drained back under the low-water mark, so
// we never queue more into bufferedAmount than the connection can carry.
const waitForBufferLow = (channel) => {
  if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
  });
};

const waitForChannelOpen = (channel, timeoutMs = 10000) => {
  if (channel.readyState === "open") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for data channel to open"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
    };

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onClose = () => {
      cleanup();
      reject(new Error("Data channel closed before the file could be sent"));
    };

    const onError = () => {
      cleanup();
      reject(new Error("Data channel error while waiting to send file"));
    };

    channel.addEventListener("open", onOpen);
    channel.addEventListener("close", onClose);
    channel.addEventListener("error", onError);
  });
};

const sendFileOverChannel = async (channel, wrappedBuffer, meta, onProgress) => {
  if (channel.readyState !== "open") {
    throw new Error("Data channel not open");
  }

  const frames = splitBufferIntoChunkFrames(wrappedBuffer);
  channel.send(JSON.stringify({ kind: "wrapped-file-meta", ...meta, totalChunks: frames.length }));

  for (let i = 0; i < frames.length; i++) {
    await waitForBufferLow(channel);
    channel.send(frames[i]);
    onProgress(i + 1, frames.length);
  }

  channel.send(JSON.stringify({ kind: "wrapped-file-end", transferId: meta.transferId }));
};

// Attach button + hidden file input. Picking a file no longer sends it right
// away — it just hands the File up to the parent via onStageFile, which
// shows it in the input tray (Messenger-style) until the user hits Send.
// The parent calls sendStagedFile() through the ref when that happens.
const ChatFileShare = forwardRef(function ChatFileShare(
  {
    roomId,
    currentUser,
    activeThread,
    peers,
    peerNames,
    dataChannelsRef,
    onFileSent,
    stagedFile,
    onStageFile,
    onStageError,
    onProgressChange,
    disabled,
  },
  ref
) {
  const fileInputRef = useRef(null);

  const handleAttachClick = () => {
    if (disabled) return;
    onStageError("");
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      onStageError(`"${file.name}" exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`);
      return;
    }

    onStageError("");
    onStageFile(file);
  };

  const sendStagedFile = async () => {
    const file = stagedFile;
    if (!file) return;

    const targetPeerIds = activeThread === EVERYONE ? peers : [activeThread];
    const targets = targetPeerIds
      .map((peerId) => ({ peerId, channel: dataChannelsRef.current?.get(peerId) }))
      .filter(({ channel }) => channel);

    if (targets.length === 0) {
      onStageError("No connected peers to send this file to right now.");
      return;
    }

    onStageError("");
    onProgressChange(0);

    const transferId = `${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const time = Date.now();
    const meta = {
      transferId,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      from: currentUser.id,
      fromName: currentUser.displayName,
      to: activeThread,
      time,
    };

    const sessionCtx = {
      sessionId: roomId,
      senderId: currentUser.id,
      recipientIds: activeThread === EVERYONE ? peers : [activeThread],
      onStageChange: (stage) => {
        const progressByStage = {
          metadata: 5,
          keys: 10,
          hashing: 25,
          signing: 55,
          embedding: 75,
          encrypting: 90,
          ready: 100,
        };

        onProgressChange({
          phase: stage.phase,
          label: stage.label,
          progress: stage.progress ?? progressByStage[stage.phase] ?? 0,
        });
      },
      encryptPayload: async (wrappedBuffer) => wrappedBuffer,
    };

    // Track how far along each target peer's transfer is so the tray can
    // show one combined percentage even when sending to several peers at once.
    const fractionPerChannel = new Array(targets.length).fill(0);
    const reportProgress = (idx, sent, total) => {
      fractionPerChannel[idx] = sent / total;
      const overall = fractionPerChannel.reduce((a, b) => a + b, 0) / targets.length;
      onProgressChange(Math.round(overall * 100));
    };

    try {
      await Promise.all(targets.map(({ channel }) => waitForChannelOpen(channel)));
      onProgressChange({ phase: "metadata", label: "Preparing transfer", progress: 0 });

      sessionCtx.privateKey = await getPrivateKey(currentUser.id);
      if (!sessionCtx.privateKey) {
        throw new Error("No private key found for the current user");
      }

      const wrappedBuffer = await prepareFileForTransfer(file, sessionCtx);
      const totalChunks = Math.ceil(wrappedBuffer.byteLength / DATA_CHANNEL_CHUNK_PAYLOAD_BYTES) || 1;
      meta.totalChunks = totalChunks;

      const results = await Promise.allSettled(
        targets.map(({ channel }, idx) =>
          sendFileOverChannel(channel, wrappedBuffer, meta, (sent, total) => reportProgress(idx, sent, total))
        )
      );

      const succeededCount = results.filter((r) => r.status === "fulfilled").length;
      const failedPeerIds = results
        .map((r, idx) => (r.status === "rejected" ? targets[idx].peerId : null))
        .filter(Boolean);

      if (succeededCount === 0) {
        // Every send failed — nothing went out, so don't post a chat bubble.
        onStageError("Couldn't send that file. Try again.");
        return;
      }

      if (failedPeerIds.length > 0) {
        const names = failedPeerIds.map((id) => peerNames?.get?.(id) || "a peer").join(", ");
        onStageError(`Sent, but delivery to ${names} failed.`);
      }

      // At least one peer received it, so the sender's own chat bubble
      // should still show up — it reflects what was sent, not full delivery.
      onFileSent({
        type: "file",
        roomId,
        from: currentUser.id,
        fromName: currentUser.displayName,
        to: activeThread,
        fileId: transferId,
        fileUrl: URL.createObjectURL(file),
        fileName: file.name,
        fileType: file.type || "application/octet-stream",
        fileSize: file.size,
        time,
      });
    } finally {
      onProgressChange(null);
    }
  };

  useImperativeHandle(ref, () => ({ sendStagedFile }));

  return (
    <div className="chat-file-share">
      <input
        ref={fileInputRef}
        type="file"
        className="chat-file-input"
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      <button
        type="button"
        className="chat-attach-btn"
        onClick={handleAttachClick}
        disabled={disabled}
        aria-label="Attach file"
      >
        <img
          src="/attach.png"
          alt="Attach file"
          width="18"
          height="18"
          className="chat-attach-btn__icon"
        />
      </button>
    </div>
  );
});

ChatFileShare.propTypes = {
  roomId: PropTypes.string.isRequired,
  currentUser: PropTypes.shape({
    id: PropTypes.string.isRequired,
    displayName: PropTypes.string.isRequired,
  }).isRequired,
  activeThread: PropTypes.string.isRequired,
  peers: PropTypes.arrayOf(PropTypes.string).isRequired,
  peerNames: PropTypes.instanceOf(Map).isRequired,
  dataChannelsRef: PropTypes.shape({ current: PropTypes.object }).isRequired,
  onFileSent: PropTypes.func.isRequired,
  stagedFile: PropTypes.instanceOf(File),
  onStageFile: PropTypes.func.isRequired,
  onStageError: PropTypes.func.isRequired,
  onProgressChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

ChatFileShare.defaultProps = {
  stagedFile: null,
  disabled: false,
};

export default ChatFileShare;

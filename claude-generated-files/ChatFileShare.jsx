import { useRef, useState } from "react";
import PropTypes from "prop-types";
import "./ChatFileShare.css";

const EVERYONE = "__everyone__";

// Browser-memory guard, not a backend limit — transfers are P2P over
// RTCDataChannel now, so the ceiling is "how much can comfortably live in
// memory on both ends" rather than an upload quota.
const MAX_FILE_SIZE = 50 * 1024 * 1024;

// Data channel messages should stay well under the ~256KB SCTP message cap
// most browsers enforce, and small chunks make backpressure/progress finer
// grained.
const CHUNK_SIZE = 16 * 1024;

const ChatFileShare = ({ roomId, currentUser, activeThread, peers, peerNames, dataChannelsRef, onFileSent }) => {
  const fileInputRef = useRef(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null); // null = idle, 0-100 while sending

  const handleAttachClick = () => {
    setError("");
    fileInputRef.current?.click();
  };

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

  const sendFileOverChannel = async (channel, file, meta, onProgress) => {
    if (channel.readyState !== "open") {
      throw new Error("Data channel not open");
    }

    channel.send(JSON.stringify({ kind: "file-meta", ...meta }));

    for (let i = 0; i < meta.totalChunks; i++) {
      await waitForBufferLow(channel);
      const start = i * CHUNK_SIZE;
      const slice = file.slice(start, start + CHUNK_SIZE);
      const buffer = await slice.arrayBuffer();
      channel.send(buffer);
      onProgress(i + 1, meta.totalChunks);
    }

    channel.send(JSON.stringify({ kind: "file-end", transferId: meta.transferId }));
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setError(`"${file.name}" exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`);
      return;
    }

    const targetPeerIds = activeThread === EVERYONE ? peers : [activeThread];
    const targets = targetPeerIds
      .map((peerId) => ({ peerId, channel: dataChannelsRef.current?.get(peerId) }))
      .filter(({ channel }) => channel);

    if (targets.length === 0) {
      setError("No connected peers to send this file to right now.");
      return;
    }

    setError("");
    setProgress(0);

    const transferId = `${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE) || 1;
    const time = Date.now();
    const meta = {
      transferId,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      fileSize: file.size,
      totalChunks,
      from: currentUser.id,
      fromName: currentUser.displayName,
      to: activeThread,
      time,
    };

    // Track how far along each target peer's transfer is so the button can
    // show one combined percentage even when sending to several peers at once.
    const fractionPerChannel = new Array(targets.length).fill(0);
    const reportProgress = (idx, sent, total) => {
      fractionPerChannel[idx] = sent / total;
      const overall = fractionPerChannel.reduce((a, b) => a + b, 0) / targets.length;
      setProgress(Math.round(overall * 100));
    };

    try {
      await Promise.all(targets.map(({ channel }) => waitForChannelOpen(channel)));

      const results = await Promise.allSettled(
        targets.map(({ channel }, idx) =>
          sendFileOverChannel(channel, file, meta, (sent, total) => reportProgress(idx, sent, total))
        )
      );

      const succeededCount = results.filter((r) => r.status === "fulfilled").length;
      const failedPeerIds = results
        .map((r, idx) => (r.status === "rejected" ? targets[idx].peerId : null))
        .filter(Boolean);

      if (succeededCount === 0) {
        // Every send failed — nothing went out, so don't post a chat bubble.
        setError("Couldn't send that file. Try again.");
        return;
      }

      if (failedPeerIds.length > 0) {
        const names = failedPeerIds.map((id) => peerNames?.get?.(id) || "a peer").join(", ");
        setError(`Sent, but delivery to ${names} failed.`);
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
      setProgress(null);
    }
  };

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
        disabled={progress !== null}
        aria-label="Attach file"
      >
        {progress !== null ? (
          <span className="chat-attach-btn__progress">{progress}%</span>
        ) : (
          <img
            src="/attach.png"
            alt="Attach file"
            width="18"
            height="18"
            className="chat-attach-btn__icon"
          />
        )}
      </button>

      {error && <p className="chat-file-error">{error}</p>}
    </div>
  );
};

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
};

export default ChatFileShare;

import PropTypes from "prop-types";
import "./ChatFileBubble.css";
import ProvenanceBadge from "./ProvenanceBadge";

const formatBytes = (bytes) => {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// `provenance` (optional — only present on received files that went through
// the verification pipeline; the sender's own bubble never has one) is the
// result shape from identity/verifyIncomingTransfer.js:
//   { valid, reason, senderName, sessionName, timestamp, contentHash }
// container per manual §5.2 Task 2.
//
// `contentHash` + `onDownload` back the download-tracking feature. No
// separate download button: the image/doc links below already save the
// file to disk when clicked (via their `download` attribute) — the
// tracked event just piggybacks on that same click through onClick,
// instead of bolting on dedicated UI for it. Video has no equivalent
// click-to-save link today, so it isn't tracked yet.
const ChatFileBubble = ({ fileUrl, fileName, fileType, fileSize, provenance, contentHash, onDownload }) => {
  console.log("ChatFileBubble props:", { fileName, fileType, fileSize });
  const badge = provenance && (
    <ProvenanceBadge
      verified={provenance.valid}
      reason={provenance.reason}
      senderName={provenance.senderName}
      sessionName={provenance.sessionName}
      timestamp={provenance.timestamp}
    />
  );

  const handleDownloadClick = () => onDownload?.(contentHash);

  if (fileType?.startsWith("image/")) {
    return (
      <div className="chat-file-wrapper">
        <a
          className="chat-file chat-file--image"
          href={fileUrl}
          download={fileName}
          target="_blank"
          rel="noreferrer"
          onClick={handleDownloadClick}
        >
          <img src={fileUrl} alt={fileName} className="chat-file__thumb" loading="lazy" />
        </a>
        {badge}
      </div>
    );
  }

  if (fileType?.startsWith("video/")) {
    return (
      <div className="chat-file-wrapper">
        <div className="chat-file chat-file--video">
          <video src={fileUrl} className="chat-file__video" controls preload="metadata" />
        </div>
        {badge}
      </div>
    );
  }

  return (
    <div className="chat-file-wrapper">
      <a
        className="chat-file chat-file--doc"
        href={fileUrl}
        download={fileName}
        target="_blank"
        rel="noreferrer"
        onClick={handleDownloadClick}
      >
        <span className="chat-file__icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </span>
        <span className="chat-file__meta">
          <span className="chat-file__name">{fileName}</span>
          <span className="chat-file__size">{formatBytes(fileSize)}</span>
        </span>
        <span className="chat-file__download" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </span>
      </a>
      {badge}
    </div>
  );
};

ChatFileBubble.propTypes = {
  fileUrl: PropTypes.string.isRequired,
  fileName: PropTypes.string.isRequired,
  fileType: PropTypes.string,
  fileSize: PropTypes.number,
  provenance: PropTypes.shape({
    valid: PropTypes.bool,
    reason: PropTypes.string,
    senderName: PropTypes.string,
    sessionName: PropTypes.string,
    timestamp: PropTypes.string,
  }),
  contentHash: PropTypes.string,
  onDownload: PropTypes.func,
};

ChatFileBubble.defaultProps = {
  provenance: null,
  contentHash: null,
  onDownload: null,
};

export default ChatFileBubble;

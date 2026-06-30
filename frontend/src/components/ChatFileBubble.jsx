import PropTypes from "prop-types";

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ChatFileBubble = ({ fileUrl, fileName, fileType, fileSize }) => {
  if (fileType?.startsWith("image/")) {
    return (
      <a className="chat-file chat-file--image" href={fileUrl} download={fileName} target="_blank" rel="noreferrer">
        <img src={fileUrl} alt={fileName} className="chat-file__thumb" />
        <span className="chat-file__name">{fileName}</span>
      </a>
    );
  }

  return (
    <a className="chat-file" href={fileUrl} download={fileName} target="_blank" rel="noreferrer">
      <span className="chat-file__icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      </span>
      <span className="chat-file__meta">
        <span className="chat-file__name">{fileName}</span>
        <span className="chat-file__size">{formatBytes(fileSize)}</span>
      </span>
    </a>
  );
};

ChatFileBubble.propTypes = {
  fileUrl: PropTypes.string.isRequired,
  fileName: PropTypes.string.isRequired,
  fileType: PropTypes.string,
  fileSize: PropTypes.number,
};

export default ChatFileBubble;
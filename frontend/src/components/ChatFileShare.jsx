import { useRef, useState } from "react";
import PropTypes from "prop-types";
import "./ChatFileShare.css";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // backend's call ultimately, this is just a UX guard

const ChatFileShare = ({ roomId, currentUser, activeThread, onFileSent }) => {
  const fileInputRef = useRef(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(null); // null = idle, 0-100 while uploading

  const handleAttachClick = () => {
    setError("");
    fileInputRef.current?.click();
  };

  const uploadFile = (file) => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("roomId", roomId);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText)); // expect { fileId, fileUrl, fileName, fileSize, fileType }
        } else {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error("Upload failed — network error"));
      xhr.send(formData);
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setError(`"${file.name}" exceeds the ${MAX_FILE_SIZE / 1024 / 1024}MB limit.`);
      return;
    }

    setError("");
    setProgress(0);

    try {
      const uploaded = await uploadFile(file);

      onFileSent({
        type: "file",
        roomId,
        from: currentUser.id,
        fromName: currentUser.displayName,
        to: activeThread,
        fileId: uploaded.fileId,
        fileUrl: uploaded.fileUrl,
        fileName: uploaded.fileName ?? file.name,
        fileType: uploaded.fileType ?? file.type ?? "application/octet-stream",
        fileSize: uploaded.fileSize ?? file.size,
        time: Date.now(),
      });
    } catch {
      setError("Couldn't upload that file. Try again.");
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
  onFileSent: PropTypes.func.isRequired,
};

export default ChatFileShare;
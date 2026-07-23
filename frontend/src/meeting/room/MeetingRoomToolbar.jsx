import PropTypes from "prop-types";

const MeetingRoomToolbar = ({
  isAudioEnabled,
  isVideoEnabled,
  isRecording,
  hasRecording,
  isChatOpen,
  hasUnreadChat,
  onToggleAudio,
  onToggleVideo,
  onToggleRecording,
  onDownloadRecording,
  onToggleChat,
  onLeaveRoom,
}) => {
  return (
    <footer className="meeting-toolbar">
      <button
        className={`toolbar-btn toolbar-btn--audio ${!isAudioEnabled ? "toolbar-btn--off" : ""}`}
        onClick={onToggleAudio}
        aria-label={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
          <line x1="12" y1="19" x2="12" y2="23"></line>
          <line x1="8" y1="23" x2="16" y2="23"></line>
          {!isAudioEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
        </svg>
        <span className="toolbar-btn__label">{isAudioEnabled ? "Mute" : "Unmute"}</span>
      </button>

      <button
        className={`toolbar-btn toolbar-btn--video ${!isVideoEnabled ? "toolbar-btn--off" : ""}`}
        onClick={onToggleVideo}
        aria-label={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"></polygon>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
          {!isVideoEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
        </svg>
        <span className="toolbar-btn__label">{isVideoEnabled ? "Camera On" : "Camera Off"}</span>
      </button>

      <div className="toolbar-btn-group">
        <button
          className={`toolbar-btn toolbar-btn--record ${isRecording ? "toolbar-btn--active" : ""}`}
          onClick={onToggleRecording}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
        >
          {isRecording ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="8"></circle>
            </svg>
          )}
          <span className="toolbar-btn__label">{isRecording ? "Stop Rec" : "Record"}</span>
        </button>

        {hasRecording && !isRecording && (
          <button
            className="toolbar-btn toolbar-btn--download"
            onClick={onDownloadRecording}
            aria-label="Download recording"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span className="toolbar-btn__label">Download</span>
          </button>
        )}
      </div>

      <button
        className="toolbar-btn toolbar-btn--chat"
        onClick={onToggleChat}
        aria-label="Toggle chat"
      >
        <span className="toolbar-btn__icon-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          {hasUnreadChat && !isChatOpen && (
            <span className="toolbar-btn__unread-dot" aria-hidden="true" />
          )}
        </span>
        <span className="toolbar-btn__label">Chat</span>
      </button>

      <button
        className="toolbar-btn toolbar-btn--leave"
        onClick={onLeaveRoom}
        aria-label="Leave call"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.34 9.9a16 16 0 0 0 3.34 3.41z"></path>
          <line x1="23" y1="1" x2="17" y2="7"></line>
          <polyline points="17 1 23 1 23 7"></polyline>
        </svg>
        <span className="toolbar-btn__label">Leave</span>
      </button>
    </footer>
  );
};

MeetingRoomToolbar.propTypes = {
  isAudioEnabled: PropTypes.bool.isRequired,
  isVideoEnabled: PropTypes.bool.isRequired,
  isRecording: PropTypes.bool.isRequired,
  hasRecording: PropTypes.bool.isRequired,
  isChatOpen: PropTypes.bool.isRequired,
  hasUnreadChat: PropTypes.bool.isRequired,
  onToggleAudio: PropTypes.func.isRequired,
  onToggleVideo: PropTypes.func.isRequired,
  onToggleRecording: PropTypes.func.isRequired,
  onDownloadRecording: PropTypes.func.isRequired,
  onToggleChat: PropTypes.func.isRequired,
  onLeaveRoom: PropTypes.func.isRequired,
};

export default MeetingRoomToolbar;

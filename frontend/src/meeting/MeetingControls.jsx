import PropTypes from "prop-types";

const MeetingControls = ({
    isAudioEnabled,
    isVideoEnabled,
    isRecording,
    hasRecording,
    onToggleAudio,
    onToggleVideo,
    onToggleRecording,
    onDownloadRecording,
    onLeaveRoom,
}) => {
    return (
        <div className="controls-bar">
            <button
                className={`btn-control ${!isAudioEnabled ? "disabled" : ""}`}
                onClick={onToggleAudio}
                title={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                    {!isAudioEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
                </svg>
            </button>

            <button
                className={`btn-control ${!isVideoEnabled ? "disabled" : ""}`}
                onClick={onToggleVideo}
                title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                    {!isVideoEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
                </svg>
            </button>

            <button
                className="btn-control"
                onClick={() => { }}
                title="Upload file"
            >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
            </button>

            <button
                className={`btn-control${isRecording ? " btn-recording" : ""}`}
                onClick={onToggleRecording}
                title={isRecording ? "Stop recording" : "Record meeting audio"}
            >
                {isRecording ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="8" />
                    </svg>
                )}
            </button>

            {hasRecording && !isRecording && (
                <button
                    className="btn-control btn-download"
                    onClick={onDownloadRecording}
                    title="Download recording as WAV"
                >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
            )}

            <button className="btn-leave" onClick={onLeaveRoom} title="Leave call">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 15.46l-5.27-1.61a1 1 0 0 0-1 .27l-2.2 2.2a15.05 15.05 0 0 1-6.32-6.32l2.2-2.2a1 1 0 0 0 .27-1L8.54 3a1 1 0 0 0-1-.7H3a1 1 0 0 0-1 1 19 19 0 0 0 19 19 1 1 0 0 0 1-1v-4.54a1 1 0 0 0-.7-1z" />
                </svg>
            </button>
        </div>
    );
};

MeetingControls.propTypes = {
    isAudioEnabled: PropTypes.bool.isRequired,
    isVideoEnabled: PropTypes.bool.isRequired,
    isRecording: PropTypes.bool.isRequired,
    hasRecording: PropTypes.bool.isRequired,
    onToggleAudio: PropTypes.func.isRequired,
    onToggleVideo: PropTypes.func.isRequired,
    onToggleRecording: PropTypes.func.isRequired,
    onDownloadRecording: PropTypes.func.isRequired,
    onLeaveRoom: PropTypes.func.isRequired,
};

export default MeetingControls;

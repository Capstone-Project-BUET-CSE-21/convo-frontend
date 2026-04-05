import PropTypes from "prop-types";

const MeetingHeader = ({ roomId, copied, onCopyMeetingId, participantsCount }) => {
    return (
        <div className="room-header">
            <div className="room-info">
                <h2 className="room-title">Meeting Room</h2>
                <div className="room-id-container">
                    <span className="room-id">ID: {roomId}</span>
                    <button className="copy-id-btn" onClick={onCopyMeetingId} title="Copy meeting ID">
                        {copied ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        )}
                    </button>
                </div>
            </div>
            <div className="participants-count">
                <span className="participant-icon"></span>
                <span>{participantsCount} Participant{participantsCount !== 1 ? "s" : ""}</span>
            </div>
        </div>
    );
};

MeetingHeader.propTypes = {
    roomId: PropTypes.string.isRequired,
    copied: PropTypes.bool.isRequired,
    onCopyMeetingId: PropTypes.func.isRequired,
    participantsCount: PropTypes.number.isRequired,
};

export default MeetingHeader;

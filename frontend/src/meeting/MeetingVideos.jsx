import PropTypes from "prop-types";

const MeetingVideos = ({ peers, userName, peerNames, isVideoEnabled, localVideoRef, remoteVideosRef }) => {
    const visiblePeers = peers.length > 5 ? peers.slice(0, 5) : peers;
    const hiddenPeersCount = peers.length > 5 ? peers.length - 5 : 0;

    const attachRemoteStream = (peerId, element) => {
        if (!element) return;
        const stream = remoteVideosRef.current.get(peerId) ?? null;
        if (element.srcObject !== stream) {
            element.srcObject = stream;
        }
    };

    return (
        <div className="videos-container" data-participant-count={Math.min(peers.length + 1, 6)}>
            <div className="video-wrapper local-video-wrapper">
                <video ref={localVideoRef} autoPlay muted playsInline className="video" />
                {!isVideoEnabled && <div className="video-overlay">Camera is off</div>}
                <div className="video-label" title={userName}>{userName}</div>
            </div>

            {visiblePeers.map((pid) => {
                const peerName = peerNames.get(pid) || "Unknown Participant";
                return (
                    <div key={pid} className="video-wrapper remote-video-wrapper">
                        <video
                            autoPlay
                            playsInline
                            className="video"
                            ref={(el) => attachRemoteStream(pid, el)}
                        />
                        <div className="video-label" title={peerName}>{peerName}</div>
                    </div>
            )})}

            {hiddenPeersCount > 0 && (
                <div className="hidden-participants">
                    +{hiddenPeersCount} more participant{hiddenPeersCount > 1 ? "s" : ""}
                </div>
            )}
        </div>
    );
};

MeetingVideos.propTypes = {
    peers: PropTypes.arrayOf(PropTypes.string).isRequired,
    userName: PropTypes.string.isRequired,
    peerNames: PropTypes.instanceOf(Map).isRequired,
    isVideoEnabled: PropTypes.bool.isRequired,
    localVideoRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
    remoteVideosRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};

export default MeetingVideos;

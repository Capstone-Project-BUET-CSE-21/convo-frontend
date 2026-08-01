import PropTypes from "prop-types";
import { ParticipantAvatar, RemoteParticipantTile } from "../../components/MeetingRoomHelperComponents";

const MeetingRoomScene = ({
  authUser,
  peers,
  peerNames,
  peerVideoStates,
  isAudioEnabled,
  isVideoEnabled,
  isPlaybackReady,
  localVideoRef,
  remoteVideosRef,
}) => {
  const totalParticipants = peers.length + 1;
  const gridDataAttr = { "data-tile-count": totalParticipants };
  // Fail-closed: even with the camera on, don't render video until the
  // watermarked playback path is confirmed live (see useMeetingRoomSession's
  // isPlaybackReady).
  const isLocalVideoVisible = isVideoEnabled && isPlaybackReady;

  return (
    <main className="meeting-stage">
      <section className="participants-grid" {...gridDataAttr}>
        <div className="participant-card participant-card--self">
          <video
            ref={localVideoRef}
            className={`participant-video ${!isLocalVideoVisible ? "participant-video--hidden" : ""}`}
            autoPlay
            playsInline
            muted
          />

          {!isLocalVideoVisible && (
            <ParticipantAvatar name={authUser.displayName} size="large" />
          )}

          {!isAudioEnabled && (
            <span className="participant-muted-indicator" aria-label="Microphone muted">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
                <line x1="1" y1="1" x2="23" y2="23"></line>
              </svg>
            </span>
          )}

          <span className="participant-label">
            {authUser.displayName} (You)
          </span>
        </div>

        {peers.map((peerId) => (
          <RemoteParticipantTile
            key={peerId}
            peerId={peerId}
            peerName={peerNames.get(peerId) || "Guest"}
            remoteVideosRef={remoteVideosRef}
            isPlaybackReady={isPlaybackReady}
            isVideoEnabled={peerVideoStates.get(peerId) !== false}
          />
        ))}

        {peers.length === 0 && (
          <div className="participants-grid__waiting">
            <p className="participants-grid__waiting-text">Waiting for others to join…</p>
          </div>
        )}
      </section>
    </main>
  );
};

MeetingRoomScene.propTypes = {
  authUser: PropTypes.shape({
    displayName: PropTypes.string.isRequired,
  }).isRequired,
  peers: PropTypes.arrayOf(PropTypes.string).isRequired,
  peerNames: PropTypes.instanceOf(Map).isRequired,
  peerVideoStates: PropTypes.instanceOf(Map).isRequired,
  isAudioEnabled: PropTypes.bool.isRequired,
  isVideoEnabled: PropTypes.bool.isRequired,
  isPlaybackReady: PropTypes.bool.isRequired,
  localVideoRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  remoteVideosRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};

export default MeetingRoomScene;

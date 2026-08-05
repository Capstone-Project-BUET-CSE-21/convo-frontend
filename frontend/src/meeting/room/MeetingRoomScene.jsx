import PropTypes from "prop-types";
import { ParticipantAvatar, MutedIndicator, RemoteParticipantTile } from "../../components/MeetingRoomHelperComponents";

const MeetingRoomScene = ({
  authUser,
  peers,
  peerNames,
  peerVideoStates,
  peerAudioStates,
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

          {!isAudioEnabled && <MutedIndicator />}

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
            isAudioEnabled={peerAudioStates.get(peerId) !== false}
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
  peerAudioStates: PropTypes.instanceOf(Map).isRequired,
  isAudioEnabled: PropTypes.bool.isRequired,
  isVideoEnabled: PropTypes.bool.isRequired,
  isPlaybackReady: PropTypes.bool.isRequired,
  localVideoRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  remoteVideosRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
};

export default MeetingRoomScene;

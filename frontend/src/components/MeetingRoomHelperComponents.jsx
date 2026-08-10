import { useEffect, useRef, useState } from "react";
import PropTypes from 'prop-types';

/** Derives initials from a display name, e.g. "John Doe" → "JD", "Alice" → "A" */
const getInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase())
    .join("")
    .slice(0, 2);

// ---------------------------------------------------------------------------
// ParticipantAvatar — shown when a participant's camera is off
// ---------------------------------------------------------------------------

export const ParticipantAvatar = ({ name, size = "large" }) => (
  <div className={`participant-avatar participant-avatar--${size}`}>
    <div className="participant-avatar__circle">
      <span className="participant-avatar__initials">{getInitials(name)}</span>
    </div>
    <span className="participant-avatar__name">{name}</span>
  </div>
);

// ---------------------------------------------------------------------------
// MutedIndicator — shown when a participant's microphone is muted
// ---------------------------------------------------------------------------

export const MutedIndicator = () => (
  <span className="participant-muted-indicator" aria-label="Microphone muted">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  </span>
);

// ---------------------------------------------------------------------------
// RemoteParticipantTile — a single remote peer tile (video or avatar)
// ---------------------------------------------------------------------------

// Maps an RTCPeerConnection.connectionState to a short user-facing label.
// A steady "connected" (or an as-yet-unknown state) shows nothing.
const CONNECTION_BADGE = {
  new: "Connecting…",
  connecting: "Connecting…",
  disconnected: "Reconnecting…",
  failed: "Connection failed",
  closed: "Disconnected",
};

export const RemoteParticipantTile = ({ peerId, peerName, remoteVideosRef, isPlaybackReady, isVideoEnabled, isAudioEnabled, connectionState }) => {
  const videoRef = useRef(null);
  // Tracks whether the peer's stream currently carries a video track at
  // all. NOTE: MediaStreamTrack.enabled is sender-local only and is never
  // signaled over the wire — a remote track stays enabled=true even while
  // the sending peer has their camera toggled off — so camera-off state is
  // carried separately via isVideoEnabled (signaled over the WS channel,
  // see useMeetingRoomSession's "video-state" messages). Rendering also
  // requires isPlaybackReady (fail-closed gate on watermarked playback),
  // kept as a separate prop so a later isPlaybackReady flip is picked up
  // immediately without waiting on a track event to re-run this.
  const [hasTrackVideo, setHasTrackVideo] = useState(false);

  useEffect(() => {
    const stream = remoteVideosRef.current.get(peerId);
    if (!stream || !videoRef.current) return;

    videoRef.current.srcObject = stream;

    const checkVideo = () => {
      const videoTracks = stream.getVideoTracks();
      setHasTrackVideo(videoTracks.length > 0);
    };

    checkVideo();

    // Re-check whenever a track is added/removed from the stream, not just
    // when mute/unmute fires on a track that may not exist yet.
    stream.addEventListener("addtrack", checkVideo);
    stream.addEventListener("removetrack", checkVideo);

    // Still listen on the current video track for mute/unmute/ended,
    // but re-attach whenever the track set changes.
    let currentVideoTrack = stream.getVideoTracks()[0];
    const attachTrackListeners = () => {
      if (currentVideoTrack) {
        currentVideoTrack.removeEventListener("mute", checkVideo);
        currentVideoTrack.removeEventListener("unmute", checkVideo);
        currentVideoTrack.removeEventListener("ended", checkVideo);
      }
      currentVideoTrack = stream.getVideoTracks()[0];
      if (currentVideoTrack) {
        currentVideoTrack.addEventListener("mute", checkVideo);
        currentVideoTrack.addEventListener("unmute", checkVideo);
        currentVideoTrack.addEventListener("ended", checkVideo);
      }
    };
    attachTrackListeners();
    stream.addEventListener("addtrack", attachTrackListeners);
    stream.addEventListener("removetrack", attachTrackListeners);

    return () => {
      stream.removeEventListener("addtrack", checkVideo);
      stream.removeEventListener("removetrack", checkVideo);
      stream.removeEventListener("addtrack", attachTrackListeners);
      stream.removeEventListener("removetrack", attachTrackListeners);
      if (currentVideoTrack) {
        currentVideoTrack.removeEventListener("mute", checkVideo);
        currentVideoTrack.removeEventListener("unmute", checkVideo);
        currentVideoTrack.removeEventListener("ended", checkVideo);
      }
    };
  }, [peerId, remoteVideosRef]);

  const hasVideo = hasTrackVideo && isVideoEnabled && isPlaybackReady;
  const connectionBadge = CONNECTION_BADGE[connectionState];

  return (
    <div className="participant-card">
      <video
        ref={videoRef}
        className={`participant-video ${!hasVideo ? "participant-video--hidden" : ""}`}
        autoPlay
        playsInline
        muted
      />
      {!hasVideo && (
        <ParticipantAvatar name={peerName || "Guest"} size="large" />
      )}
      {connectionBadge && (
        <span className="participant-connection-badge">{connectionBadge}</span>
      )}
      {!isAudioEnabled && <MutedIndicator />}
      <span className="participant-label">{peerName || "Guest"}</span>
    </div>
  );
};



ParticipantAvatar.propTypes = {
  name: PropTypes.string,
  size: PropTypes.oneOf(["small", "large"]),
};

RemoteParticipantTile.propTypes = {
  peerId: PropTypes.string.isRequired,
  peerName: PropTypes.string,
  remoteVideosRef: PropTypes.shape({
    current: PropTypes.instanceOf(Map),
  }).isRequired,
  isPlaybackReady: PropTypes.bool.isRequired,
  isVideoEnabled: PropTypes.bool.isRequired,
  isAudioEnabled: PropTypes.bool.isRequired,
  connectionState: PropTypes.string,
};
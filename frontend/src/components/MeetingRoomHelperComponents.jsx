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
// RemoteParticipantTile — a single remote peer tile (video or avatar)
// ---------------------------------------------------------------------------

export const RemoteParticipantTile = ({ peerId, peerName, remoteVideosRef }) => {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const stream = remoteVideosRef.current.get(peerId);
    if (!stream || !videoRef.current) return;

    videoRef.current.srcObject = stream;

    const checkVideo = () => {
      const videoTracks = stream.getVideoTracks();
      setHasVideo(videoTracks.length > 0 && videoTracks[0].enabled);
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

  return (
    <div className="participant-card">
      <video
        ref={videoRef}
        className={`participant-video ${!hasVideo ? "participant-video--hidden" : ""}`}
        autoPlay
        playsInline
      />
      {!hasVideo && (
        <ParticipantAvatar name={peerName || "Guest"} size="large" />
      )}
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
};
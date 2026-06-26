import { useRef, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PropTypes from 'prop-types';
import "./MeetingRoom.css";
import createProcessedStream from "../audio/audioWorkletSetup";
import MeetingHeader from "../meeting/MeetingHeader";
import MeetingControls from "../meeting/MeetingControls";
import useMeetingRecording from "../meeting/useMeetingRecording";
import { getAuthToken } from "../auth/authSession";

const WS_URL = import.meta.env.VITE_WS_BASE_URL;
const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;
const WATERMARK_URL = import.meta.env.VITE_WATERMARK_API_URL;
const FRONTEND_URL = `https://convo-frontend-nine.vercel.app/`;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const ParticipantAvatar = ({ name, size = "large" }) => (
  <div className={`participant-avatar participant-avatar--${size}`}>
    <div className="participant-avatar__circle">
      <span className="participant-avatar__initials">{getInitials(name)}</span>
    </div>
    <span className="participant-avatar__name">{name}</span>
  </div>
);

// ---------------------------------------------------------------------------
// RemoteParticipantVideo — a single remote peer tile (video or avatar)
// ---------------------------------------------------------------------------

const RemoteParticipantTile = ({ peerId, peerName, remoteVideosRef }) => {
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

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.addEventListener("mute", checkVideo);
      videoTrack.addEventListener("unmute", checkVideo);
      videoTrack.addEventListener("ended", checkVideo);
    }

    return () => {
      if (videoTrack) {
        videoTrack.removeEventListener("mute", checkVideo);
        videoTrack.removeEventListener("unmute", checkVideo);
        videoTrack.removeEventListener("ended", checkVideo);
      }
    };
  }, [peerId, remoteVideosRef]);

  return (
    <div className="remote-tile">
      <video
        ref={videoRef}
        className={`remote-tile__video ${!hasVideo ? "remote-tile__video--hidden" : ""}`}
        autoPlay
        playsInline
      />
      {!hasVideo && (
        <ParticipantAvatar name={peerName || "Guest"} size="large" />
      )}
      <span className="remote-tile__name-badge">{peerName || "Guest"}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MeetingRoom
// ---------------------------------------------------------------------------

const MeetingRoom = ({ meetingRoomAttributes }) => {
  const { authUser, command, isAudioEnabledPair, isVideoEnabledPair } = meetingRoomAttributes;
  const { isAudioEnabled, setIsAudioEnabled } = isAudioEnabledPair;
  const { isVideoEnabled, setIsVideoEnabled } = isVideoEnabledPair;

  const params = useParams();
  const roomId = params.roomId;
  const userId = authUser.id;
  const roomIdRef = useRef(roomId);
  const commandRef = useRef(command);
  const isAudioEnabledRef = useRef(isAudioEnabled);
  const isVideoEnabledRef = useRef(isVideoEnabled);
  const navigateRef = useRef(null);
  const stopRecordingRef = useRef(null);

  roomIdRef.current = roomId;
  commandRef.current = command;
  isAudioEnabledRef.current = isAudioEnabled;
  isVideoEnabledRef.current = isVideoEnabled;

  const serverRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(new Map());
  const [peerNames, setPeerNames] = useState(new Map());

  const rawStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(new Map());
  const gainNodeRef = useRef(null);
  const watermarkAudioContextRef = useRef(null);
  const watermarkWorkletNodeRef = useRef(null);
  const watermarkReadyPromiseRef = useRef(Promise.resolve());
  const watermarkReadyResolveRef = useRef(null);

  const [peers, setPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const navigate = useNavigate();

  const {
    isRecording,
    hasRecording,
    toggleRecording,
    stopRecording,
    downloadRecording,
  } = useMeetingRecording({
    localVideoRef,
    roomId,
    watermarkAudioContextRef,
    watermarkWorkletNodeRef,
  });

  navigateRef.current = navigate;
  stopRecordingRef.current = stopRecording;

  // ── Clipboard helpers ────────────────────────────────────────────────────

  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy meeting ID:", err);
    }
  };

  const copyMeetingLink = async () => {
    try {
      await navigator.clipboard.writeText(`${FRONTEND_URL}/room/${roomId}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("Failed to copy meeting link:", err);
    }
  };

  // ── WebRTC helpers ───────────────────────────────────────────────────────

  const createPeerConnection = async (peerId) => {
    if (pcRef.current.has(peerId)) {
      return pcRef.current.get(peerId);
    }

    console.log(`Creating peer connection for ${peerId}`);

    const iceServers = serverRef.current;
    const pc = new RTCPeerConnection({ iceServers });

    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject;
      stream.getTracks().forEach(track => {
        console.log(`Adding ${track.kind} track to peer ${peerId}`);
        pc.addTrack(track, stream);
      });
    }

    const remoteStream = new MediaStream();
    remoteVideosRef.current.set(peerId, remoteStream);

    pc.ontrack = e => {
      console.log(`Received ${e.track.kind} track from ${peerId}`);
      e.streams[0].getTracks().forEach(t => {
        if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
      });
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        console.log(`Sending ICE candidate to ${peerId}`);
        wsRef.current.send(JSON.stringify({
          type: "ice", roomId: roomId, to: peerId, payload: e.candidate
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`Removing failed connection for ${peerId}`);
        removePeer(peerId);
      }
    };

    pcRef.current.set(peerId, pc);
    setPeers(prev => {
      if (!prev.includes(peerId)) return [...prev, peerId];
      return prev;
    });

    return pc;
  };

  const handleOffer = async (peerId, peerName, offer) => {
    console.log("Received offer from:", peerId);
    try {
      const pc = await createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      peerNames.set(peerId, peerName);
      setPeerNames(new Map(peerNames));

      wsRef.current.send(JSON.stringify({
        type: "answer", roomId: roomId, to: peerId, payload: { answer, name: authUser.displayName }
      }));
      console.log("Sent answer to:", peerId);
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const sendOffer = async (peerId) => {
    try {
      const pc = await createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: "offer", roomId: roomId, to: peerId, payload: { offer, name: authUser.displayName }
      }));
      console.log("Sent offer to new peer:", peerId);
    } catch (err) {
      console.error("Error sending offer to new peer", peerId, err);
    }
  };

  const removePeer = (peerId) => {
    const pc = pcRef.current.get(peerId);
    if (pc) pc.close();
    pcRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    setPeers(p => p.filter(id => id !== peerId));
  };

  // ── Room actions ─────────────────────────────────────────────────────────

  const leaveRoom = () => {
    stopRecording();

    watermarkAudioContextRef.current?.close?.();
    watermarkAudioContextRef.current = null;
    watermarkWorkletNodeRef.current = null;

    pcRef.current.forEach(pc => pc.close());
    pcRef.current.clear();
    remoteVideosRef.current.clear();
    setPeers([]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    setIsAudioEnabled(true);
    setIsVideoEnabled(true);
    navigate("/home");
    console.log("Left room: " + roomId);
  };

  const toggleAudio = () => {
    const next = !isAudioEnabled;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = next ? 1 : 0;
    } else {
      localVideoRef.current?.srcObject?.getAudioTracks().forEach(t => { t.enabled = next; });
    }
    setIsAudioEnabled(next);
  };

  const toggleVideo = () => {
    const next = !isVideoEnabled;
    localVideoRef.current?.srcObject?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setIsVideoEnabled(next);
  };

  // ── Backend / watermark helpers ──────────────────────────────────────────

  const makeMeetingEntry = async () => {
    const token = getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/backend/meeting-entry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ command, roomId }),
    });

    if (!response.ok) {
      throw new Error(`Meeting entry request failed: ${response.status}`);
    }
  };

  const fetchWatermarkConfig = async () => {
    try {
      console.log("Fetching watermark config for roomId/userId:", roomId, userId);
      const res = await fetch(
        `${WATERMARK_URL}/api/watermark/config?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}`,
        { method: "GET" }
      );
      if (!res.ok) throw new Error(`Watermark config request failed: ${res.status}`);
      const data = await res.json();
      console.log("Received watermark config:", data);
      return data;
    } catch (err) {
      console.error("Failed to fetch watermark config:", err);
      return { seed: 42, alpha: 0.005, frameSize: 256 };
    }
  };

  const applyWatermark = async () => {
    try {
      const config = await fetchWatermarkConfig();

      const result = await Promise.race([
        createProcessedStream(rawStreamRef.current, config),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("createProcessedStream timed out — check DevTools console")),
            8000
          )
        ),
      ]);

      const processedStream = result.stream;
      const audioContext = result.audioContext;
      const workletNode = result.workletNode;

      watermarkAudioContextRef.current = audioContext;
      watermarkWorkletNodeRef.current = workletNode;
      gainNodeRef.current = processedStream._gainNode;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = processedStream;
      }

      const audioTrack = processedStream.getAudioTracks()[0] ?? null;
      const videoTrack = processedStream.getVideoTracks()[0] ?? null;

      if (audioTrack) audioTrack.enabled = isAudioEnabled;
      if (videoTrack) videoTrack.enabled = isVideoEnabled;

      watermarkReadyResolveRef.current?.();
      watermarkReadyResolveRef.current = null;
    } catch (err) {
      console.error("Error applying watermark:", err);
      watermarkReadyResolveRef.current?.();
      watermarkReadyResolveRef.current = null;
    }
  };

  const fetchServerCredentials = async () => {
    try {
      console.log("Fetching server credentials...");
      const token = getAuthToken();
      const response = await fetch(`${BACKEND_URL}/api/backend/credentials`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) throw new Error(`Credentials request failed: ${response.status}`);

      const data = await response.json();
      serverRef.current = data.credentials;
      console.log("Received server credentials:", serverRef.current);
    } catch (err) {
      console.error("Failed to fetch server credentials:", err);
    }
  };

  // ── Initialization effect ────────────────────────────────────────────────

  useEffect(() => {
    const pcs = pcRef.current;

    const initialize = async () => {
      watermarkReadyPromiseRef.current = new Promise((resolve) => {
        watermarkReadyResolveRef.current = resolve;
      });

      const [rawStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        fetchServerCredentials(),
        makeMeetingEntry(),
      ]);

      rawStream.getAudioTracks().forEach((track) => { track.enabled = isAudioEnabled; });
      rawStream.getVideoTracks().forEach((track) => { track.enabled = isVideoEnabled; });

      rawStreamRef.current = rawStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = rawStream;

      applyWatermark();

      const token = getAuthToken();
      const wsUrl = `${WS_URL}/ws` + (token ? `?token=${encodeURIComponent(token)}` : "");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: command, roomId }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "room-not-found":
            alert("Room not found.");
            navigate("/");
            break;

          case "room-already-exists":
            alert("Room already exists.");
            navigate("/");
            break;

          case "peer-joined":
            await watermarkReadyPromiseRef.current;
            await sendOffer(data.peerId);
            break;

          case "offer":
            await handleOffer(data.from, data.payload.name, data.payload.offer);
            break;

          case "answer": {
            const pc = pcRef.current.get(data.from);
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.payload.answer));
            peerNames.set(data.from, data.payload.name);
            setPeerNames(new Map(peerNames));
            console.log("Received answer from:", data.from);
            break;
          }

          case "ice": {
            const pc = pcRef.current.get(data.from);
            if (pc) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(data.payload));
                console.log("Added ICE candidate from:", data.from);
              } catch (err) {
                console.error("ICE error:", err);
              }
            }
            break;
          }

          case "peer-left":
            removePeer(data.peerId);
            break;
        }
      };

      ws.onerror = (e) => console.error("WebSocket error:", e);
      ws.onclose = () => console.log("WebSocket closed");
    };

    initialize();

    return () => {
      stopRecording();
      watermarkAudioContextRef.current?.close?.();
      watermarkAudioContextRef.current = null;
      watermarkWorkletNodeRef.current = null;
      wsRef.current?.close();
      pcs.forEach(pc => pc.close());
      pcs.clear();
      rawStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  // Determine which peer to feature as the primary (first peer in the list).
  // Additional peers fall into a sidebar strip, matching Google Meet's layout.
  const [primaryPeerId, ...secondaryPeerIds] = peers;
  const primaryPeerName = peerNames.get(primaryPeerId) || "Guest";

  return (
    <div className="gmeet-room">

      {/* ── Top bar ── */}
      <header className="gmeet-room__header">
        <MeetingHeader
          roomId={roomId}
          copied={copied}
          copiedLink={copiedLink}
          onCopyMeetingId={copyMeetingId}
          onCopyMeetingLink={copyMeetingLink}
          participantsCount={peers.length + 1}
        />
      </header>

      {/* ── Main stage ── */}
      <main className="gmeet-room__stage">

        {/* Primary video area — remote peer (or waiting state when alone) */}
        <section className="gmeet-room__primary">
          {primaryPeerId ? (
            <RemoteParticipantTile
              key={primaryPeerId}
              peerId={primaryPeerId}
              peerName={primaryPeerName}
              remoteVideosRef={remoteVideosRef}
            />
          ) : (
            /* Waiting for others to join */
            <div className="gmeet-room__waiting">
              <p className="gmeet-room__waiting-text">Waiting for others to join…</p>
            </div>
          )}
        </section>

        {/* Secondary peers strip — visible only when there are 2+ remote peers */}
        {secondaryPeerIds.length > 0 && (
          <aside className="gmeet-room__secondary-strip">
            {secondaryPeerIds.map((peerId) => (
              <RemoteParticipantTile
                key={peerId}
                peerId={peerId}
                peerName={peerNames.get(peerId) || "Guest"}
                remoteVideosRef={remoteVideosRef}
              />
            ))}
          </aside>
        )}

        {/* Self-view pip — bottom-right overlay */}
        <div className="gmeet-room__self-view">
          <div className="self-view__inner">
            {/* Local video — always rendered; hidden via CSS when camera is off */}
            <video
              ref={localVideoRef}
              className={`self-view__video ${!isVideoEnabled ? "self-view__video--hidden" : ""}`}
              autoPlay
              playsInline
              muted
            />

            {/* Avatar shown when local camera is off */}
            {!isVideoEnabled && (
              <ParticipantAvatar name={authUser.displayName} size="small" />
            )}

            {/* Muted indicator badge */}
            {!isAudioEnabled && (
              <span className="self-view__muted-badge" aria-label="Microphone muted">
                🎤
              </span>
            )}

            {/* Name label */}
            <span className="self-view__name-label">
              {authUser.displayName} (You)
            </span>
          </div>
        </div>

      </main>

      {/* ── Bottom control bar ── */}
      <footer className="gmeet-room__controls">
        <MeetingControls
          isAudioEnabled={isAudioEnabled}
          isVideoEnabled={isVideoEnabled}
          isRecording={isRecording}
          hasRecording={hasRecording}
          onToggleAudio={toggleAudio}
          onToggleVideo={toggleVideo}
          onToggleRecording={toggleRecording}
          onDownloadRecording={downloadRecording}
          onLeaveRoom={leaveRoom}
        />
      </footer>

    </div>
  );
};

MeetingRoom.propTypes = {
  meetingRoomAttributes: PropTypes.shape({
    authUser: PropTypes.object.isRequired,
    command: PropTypes.string.isRequired,
    isAudioEnabledPair: PropTypes.shape({
      isAudioEnabled: PropTypes.bool.isRequired,
      setIsAudioEnabled: PropTypes.func.isRequired,
    }).isRequired,
    isVideoEnabledPair: PropTypes.shape({
      isVideoEnabled: PropTypes.bool.isRequired,
      setIsVideoEnabled: PropTypes.func.isRequired,
    }).isRequired,
  }).isRequired,
};

export default MeetingRoom;
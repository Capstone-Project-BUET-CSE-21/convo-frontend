import { useRef, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PropTypes from 'prop-types';
import "./MeetingRoom.css";
import createProcessedStream from "./audio/audioWorkletSetup";
import MeetingHeader from "./meeting/MeetingHeader";
import MeetingVideos from "./meeting/MeetingVideos";
import MeetingControls from "./meeting/MeetingControls";
import useMeetingRecording from "./meeting/useMeetingRecording";

const API_BASE = "localhost:8080"; // Adjust if your backend runs on a different host/port

const MeetingRoom = ({ meetingRoomAttributes }) => {
  const { command, isAudioEnabledPair, isVideoEnabledPair } = meetingRoomAttributes;
  const { isAudioEnabled, setIsAudioEnabled } = isAudioEnabledPair;
  const { isVideoEnabled, setIsVideoEnabled } = isVideoEnabledPair;

  const params = useParams();
  const roomId = params.roomId;

  const serverRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(new Map());

  const rawStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(new Map());
  const gainNodeRef = useRef(null);
  const watermarkAudioContextRef = useRef(null);
  const watermarkWorkletNodeRef = useRef(null);

  const [peers, setPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const [userId, setUserId] = useState("");
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


  const copyMeetingId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy meeting ID:", err);
    }
  };

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

  const handleOffer = async (peerId, offer) => {
    console.log("Received offer from:", peerId);
    try {
      const pc = await createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsRef.current.send(JSON.stringify({
        type: "answer", roomId: roomId, to: peerId, payload: answer
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
        type: "offer", roomId: roomId, to: peerId, payload: offer
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

  const leaveRoom = () => {
    // Cleanly stop any active recording before leaving
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
    navigate("/");
    console.log("Left room: " + roomId);
  };

  const toggleAudio = () => {
    const next = !isAudioEnabled;
    if (gainNodeRef.current) {
      // Watermarked path — mute via gain node, not track.enabled
      gainNodeRef.current.gain.value = next ? 1 : 0;
    } else {
      // Pre-watermark fallback
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

  const fetchWatermarkConfig = async (userId) => {
    try {
      const res = await fetch(`/api/watermark/config?sessionId=${roomId}&userId=${userId}`, {
        method: "GET",
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Failed to fetch watermark config:", err);
      return { seed: 42, alpha: 0.005, frameSize: 256 };
    }
  };

  const applyWatermark = async (userId) => {
    try {
      const config = await fetchWatermarkConfig(userId);

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

      // Apply current toggle state to processed stream
      if (audioTrack) audioTrack.enabled = isAudioEnabled;
      if (videoTrack) videoTrack.enabled = isVideoEnabled;
    } catch (err) {
      console.error("Error applying watermark:", err);
    }
  };

  const fetchServerCredentials = async () => {
    try {
      const response = await fetch(`/api/backend/credentials`, {
        method: "GET",
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      serverRef.current = data.credentials;
    } catch (err) {
      console.error("Failed to fetch server credentials:", err);
    }
  };

  useEffect(() => {
    const pcs = pcRef.current;

    const initialize = async () => {
      // Both must be ready before WebSocket opens
      const [rawStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: true,
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        }),
        fetchServerCredentials()
      ]);

      // Apply persisted toggle state immediately to avoid a brief preview flash
      // (and accidental media send) before watermark processing finishes.
      rawStream.getAudioTracks().forEach((track) => {
        track.enabled = isAudioEnabled;
      });
      rawStream.getVideoTracks().forEach((track) => {
        track.enabled = isVideoEnabled;
      });

      rawStreamRef.current = rawStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = rawStream;

      const ws = new WebSocket(`ws://${API_BASE}/ws`);
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

          case "start-success":
            setUserId(data.peerId);
            await applyWatermark(data.peerId);
            break;

          case "join-success":
            setUserId(data.peerId);
            await applyWatermark(data.peerId);
            ws.send(JSON.stringify({
              type: "ready-for-peers",
              roomId,
              peerId: data.peerId
            }));
            break;

          case "peer-joined":
            // Watermark is guaranteed applied before any peer joins
            // because server sends join-success before any peer-joined
            await sendOffer(data.peerId);
            break;

          case "offer":
            await handleOffer(data.from, data.payload);
            break;

          case "answer": {
            const pc = pcRef.current.get(data.from);
            if (pc) await pc.setRemoteDescription(
              new RTCSessionDescription(data.payload)
            );
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

      ws.onerror = e => console.error("WebSocket error:", e);
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

  return (
    <div className="room-container">
      <MeetingHeader
        roomId={roomId}
        copied={copied}
        onCopyMeetingId={copyMeetingId}
        participantsCount={peers.length + 1}
      />

      <MeetingVideos
        peers={peers}
        userId={userId}
        isVideoEnabled={isVideoEnabled}
        localVideoRef={localVideoRef}
        remoteVideosRef={remoteVideosRef}
      />

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
    </div>
  );
};

MeetingRoom.propTypes = {
  meetingRoomAttributes: PropTypes.shape({
    command: PropTypes.string.isRequired,
    isAudioEnabledPair: PropTypes.shape({
      isAudioEnabled: PropTypes.bool.isRequired,
      setIsAudioEnabled: PropTypes.func.isRequired
    }).isRequired,
    isVideoEnabledPair: PropTypes.shape({
      isVideoEnabled: PropTypes.bool.isRequired,
      setIsVideoEnabled: PropTypes.func.isRequired
    }).isRequired
  }).isRequired
};

export default MeetingRoom;

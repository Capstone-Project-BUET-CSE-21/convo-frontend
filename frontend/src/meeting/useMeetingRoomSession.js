import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createLocalMixBus, createWatermarkedPlaybackStream } from "../audio/audioWatermarkSetup";
import { getAuthToken } from "../auth/authSession";
import useMeetingRecording from "./useMeetingRecording";
import { WS_URL } from "../config/apiConfig";
import { makeMeetingEntry, fetchServerCredentials, fetchWatermarkConfig } from "./meetingApi";
import { createDataChannelTransfer } from "./dataChannelTransfer";
import { createPeerConnectionManager } from "./peerConnectionManager";
import { registerSessionParticipant } from "../identity/traceVerification";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

const useMeetingRoomSession = ({
  roomId,
  command,
  authUser,
  isAudioEnabled,
  isVideoEnabled,
  setIsAudioEnabled,
  setIsVideoEnabled,
  localVideoRef,
  remoteVideosRef,
}) => {
  const navigate = useNavigate();
  const [peers, setPeers] = useState([]);
  const [peerNames, setPeerNames] = useState(new Map());
  const [peerUserIds, setPeerUserIds] = useState(new Map());
  const [peerVideoStates, setPeerVideoStates] = useState(new Map());
  const [peerAudioStates, setPeerAudioStates] = useState(new Map());
  // peerId -> RTCPeerConnection.connectionState, so the UI can show a
  // "connecting / reconnecting / failed" badge instead of a peer just silently
  // being absent or frozen.
  const [peerConnectionStates, setPeerConnectionStates] = useState(new Map());
  const [chatMessages, setChatMessages] = useState([]);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  // Fail-closed gate: video (local + remote) stays hidden until the
  // watermarked playback path is actually live, so a screen recording can
  // never capture video without the traceable watermarked audio alongside
  // it. Only the success path in initPlaybackWatermark sets this true —
  // the unwatermarked fallback path deliberately does not.
  const [isPlaybackReady, setIsPlaybackReady] = useState(false);

  const serverRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(new Map());
  // This client's own signaling peer id (server session id), handed to us by
  // the server on start/join. Needed for the deterministic-initiator rule.
  const selfIdRef = useRef(null);
  // Authoritative roster of who should be in the room: peerId -> userId. Seeded
  // from the join roster / peer-joined events and reconciled against by the
  // retry timer so a lost handshake self-heals instead of leaving a ghost.
  const knownPeersRef = useRef(new Map());
  const reconcileTimerRef = useRef(null);
  const iceCandidatesQueueRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const incomingTransfersRef = useRef(new Map());
  // peerId -> the peer's live session ECDH public key, announced over the data
  // channel when it opens (the "session-key" handshake). This is the exact
  // device key that peer is using in THIS meeting, so encryption targets the
  // device actually present rather than whatever key is newest in the registry.
  const peerSessionKeysRef = useRef(new Map());
  const rawStreamRef = useRef(null);

  const playbackAudioRef = useRef(null);
  const playbackAudioContextRef = useRef(null);
  const playbackWorkletNodeRef = useRef(null);
  const playbackStreamRef = useRef(null);
  const localMixBusRef = useRef(null);
  // Remote audio tracks that arrived before the mix bus existed (or while it
  // was being rebuilt). Held here and flushed into the bus once it's ready, so
  // a track is never silently dropped — the cause of "I can see them but can't
  // hear them" while their video renders fine.
  const pendingAudioTracksRef = useRef(new Map());

  // Live mirrors of reactive values the once-constructed helper modules need to
  // read at event time (not construction time): the latest peer names for file
  // provenance display, and the current mute/camera flags for offer payloads.
  const peerNamesRef = useRef(peerNames);
  const mediaFlagsRef = useRef({ audio: isAudioEnabled, video: isVideoEnabled });
  useEffect(() => { peerNamesRef.current = peerNames; }, [peerNames]);
  useEffect(() => {
    mediaFlagsRef.current = { audio: isAudioEnabled, video: isVideoEnabled };
  }, [isAudioEnabled, isVideoEnabled]);

  const {
    isRecording,
    hasRecording,
    toggleRecording,
    stopRecording,
    downloadRecording,
  } = useMeetingRecording({
    localVideoRef,
    recordingSourceStreamRef: playbackStreamRef,
    playbackWorkletNodeRef,
    roomId,
  });

  // Helper modules, constructed once. They close over stable refs and setters,
  // and read anything reactive through the mirror refs above.
  const transferRef = useRef(null);
  if (!transferRef.current) {
    transferRef.current = createDataChannelTransfer({
      authUser,
      roomId,
      dataChannelsRef,
      incomingTransfersRef,
      peerSessionKeysRef,
      peerNamesRef,
      setChatMessages,
    });
  }
  const { setupDataChannel } = transferRef.current;

  const managerRef = useRef(null);
  if (!managerRef.current) {
    managerRef.current = createPeerConnectionManager({
      roomId,
      authUser,
      wsRef,
      pcRef,
      serverRef,
      localVideoRef,
      remoteVideosRef,
      iceCandidatesQueueRef,
      dataChannelsRef,
      incomingTransfersRef,
      selfIdRef,
      knownPeersRef,
      localMixBusRef,
      pendingAudioTracksRef,
      mediaFlagsRef,
      setupDataChannel,
      setPeers,
      setPeerNames,
      setPeerUserIds,
      setPeerVideoStates,
      setPeerAudioStates,
      setPeerConnectionStates,
    });
  }
  const manager = managerRef.current;

  const closePlaybackOutput = () => {
    playbackAudioContextRef.current?.close?.();
    playbackAudioContextRef.current = null;
    playbackWorkletNodeRef.current = null;
    playbackStreamRef.current = null;
    setIsPlaybackReady(false);

    if (playbackAudioRef.current) {
      playbackAudioRef.current.srcObject = null;
    }
  };

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
      await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("Failed to copy meeting link:", err);
    }
  };

  const initPlaybackWatermark = async () => {
    try {
      const config = await fetchWatermarkConfig({ roomId, userId: authUser.id });
      const result = await createWatermarkedPlaybackStream({
        mixedStream: localMixBusRef.current.mixedStream,
        config,
      });

      playbackAudioContextRef.current = result.audioContext;
      playbackWorkletNodeRef.current = result.workletNode;
      playbackStreamRef.current = result.stream;

      if (playbackAudioRef.current) {
        playbackAudioRef.current.srcObject = result.stream;
        playbackAudioRef.current.play?.().catch(() => { });
      }
      setIsPlaybackReady(true);
    } catch (err) {
      console.error("Error building playback watermark output:", err);
      // Fail closed: fall back to unwatermarked audio so the call isn't
      // silent, but do NOT mark playback ready — video stays hidden since
      // it would otherwise be recordable without the traceable watermark.
      if (playbackAudioRef.current && localMixBusRef.current) {
        playbackAudioRef.current.srcObject = localMixBusRef.current.mixedStream;
        playbackAudioRef.current.play?.().catch(() => { });
      }
    }
  };

  const loadServerCredentials = async () => {
    try {
      serverRef.current = await fetchServerCredentials();
    } catch (err) {
      console.error("Failed to fetch server credentials:", err);
    }
  };

  const handleSendChat = (msg) => {
    setChatMessages((prev) => [
      ...prev,
      { ...msg, id: Date.now() + Math.random(), isMine: true },
    ]);
  };

  const leaveRoom = () => {
    if (reconcileTimerRef.current) {
      clearInterval(reconcileTimerRef.current);
      reconcileTimerRef.current = null;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "leave", roomId }));
    }

    knownPeersRef.current.clear();
    pcRef.current.forEach((pc) => pc.close());
    pcRef.current.clear();
    iceCandidatesQueueRef.current.clear();
    remoteVideosRef.current.clear();
    dataChannelsRef.current.clear();
    incomingTransfersRef.current.clear();
    setPeers([]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    stopRecording();
    closePlaybackOutput();
    localMixBusRef.current?.close();
    localMixBusRef.current = null;

    setIsAudioEnabled(true);
    setIsVideoEnabled(true);
    navigate("/home");
  };

  const toggleAudio = () => {
    const next = !isAudioEnabled;
    rawStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setIsAudioEnabled(next);

    // track.enabled is sender-local only and never crosses the wire, so
    // remote peers can't infer mute state from the media track itself —
    // tell them explicitly over the signaling channel.
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "audio-state",
        roomId,
        payload: { enabled: next },
      }));
    }
  };

  const toggleVideo = () => {
    const next = !isVideoEnabled;
    localVideoRef.current?.srcObject?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setIsVideoEnabled(next);

    // track.enabled is sender-local only and never crosses the wire, so
    // remote peers can't infer camera-off from the media track itself —
    // tell them explicitly over the signaling channel.
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "video-state",
        roomId,
        payload: { enabled: next },
      }));
    }
  };

  useEffect(() => {
    const pcs = pcRef.current;
    const iceQueue = iceCandidatesQueueRef.current;
    const dataChannels = dataChannelsRef.current;
    const incomingTransfers = incomingTransfersRef.current;

    const initialize = async () => {
      const [rawStream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: true,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }),
        loadServerCredentials(),
        makeMeetingEntry({ command, roomId }),
      ]);

      rawStream.getAudioTracks().forEach((track) => {
        track.enabled = isAudioEnabled;
      });
      rawStream.getVideoTracks().forEach((track) => {
        track.enabled = isVideoEnabled;
      });

      rawStreamRef.current = rawStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = rawStream;

      const mixBus = createLocalMixBus();
      localMixBusRef.current = mixBus;

      // Flush any remote audio tracks that arrived before the bus existed.
      pendingAudioTracksRef.current.forEach((track, pid) => manager.attachRemoteAudio(pid, track));

      initPlaybackWatermark();

      // Record real presence in this real session, so the trace/lineage
      // screen's isAuthorizedHop check has something to check hops
      // against later (see identity/traceVerification.js). Best-effort:
      // must never block the meeting itself from loading.
      registerSessionParticipant(roomId, authUser.id, CONFIDENTIALITY_CHAIN_URL).catch((err) => {
        console.error("Failed to register session participant:", err);
      });

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
          case "room-created":
            selfIdRef.current = data.selfId;
            break;
          case "existing-peers": {
            // Authoritative roster from the server: record everyone already
            // here, then (as the deterministic initiator) offer the peers we're
            // responsible for. Non-initiator pairs wait for the other side's
            // offer; the reconcile timer covers anything that goes missing.
            selfIdRef.current = data.selfId;
            for (const peer of data.peers || []) {
              knownPeersRef.current.set(peer.peerId, peer.userId);
              if (peer.userId) {
                setPeerUserIds((prev) => new Map(prev).set(peer.peerId, peer.userId));
              }
              if (manager.isInitiator(peer.peerId)) {
                await manager.sendOffer(peer.peerId);
              }
            }
            break;
          }
          case "peer-joined":
            knownPeersRef.current.set(data.peerId, data.userId);
            if (data.userId) {
              setPeerUserIds((prev) => new Map(prev).set(data.peerId, data.userId));
            }
            // Only the deterministic initiator offers; the other side answers.
            if (manager.isInitiator(data.peerId)) {
              await manager.sendOffer(data.peerId);
            }
            break;
          case "request-offer":
            // The non-initiator side is missing us; (re)offer if we're the
            // initiator and don't already have a working connection.
            if (manager.isInitiator(data.from)) {
              if (!knownPeersRef.current.has(data.from)) {
                knownPeersRef.current.set(data.from, "");
              }
              if (!manager.isConnectionUsable(data.from)) {
                if (pcRef.current.has(data.from)) manager.removePeer(data.from);
                await manager.sendOffer(data.from);
              }
            }
            break;
          case "offer":
            await manager.handleOffer(data.from, data.payload.name, data.payload.offer, data.payload.videoEnabled, data.payload.userId, data.payload.audioEnabled);
            break;
          case "answer": {
            const pc = pcRef.current.get(data.from);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.payload.answer));
              await manager.processQueuedCandidates(data.from);
            }
            setPeerNames((prev) => new Map(prev).set(data.from, data.payload.name));
            setPeerUserIds((prev) => new Map(prev).set(data.from, data.payload.userId));
            setPeerVideoStates((prev) => new Map(prev).set(data.from, data.payload.videoEnabled !== false));
            setPeerAudioStates((prev) => new Map(prev).set(data.from, data.payload.audioEnabled !== false));
            break;
          }
          case "video-state":
            setPeerVideoStates((prev) => new Map(prev).set(data.from, data.payload.enabled));
            break;
          case "audio-state":
            setPeerAudioStates((prev) => new Map(prev).set(data.from, data.payload.enabled));
            break;
          case "ice": {
            const pc = pcRef.current.get(data.from);
            if (pc && pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(data.payload));
              } catch (err) {
                console.error("ICE error:", err);
              }
            } else {
              if (!iceCandidatesQueueRef.current.has(data.from)) {
                iceCandidatesQueueRef.current.set(data.from, []);
              }
              iceCandidatesQueueRef.current.get(data.from).push(data.payload);
            }
            break;
          }
          case "chat":
            setChatMessages((prev) => [
              ...prev,
              {
                id: Date.now() + Math.random(),
                from: data.from,
                fromName: data.fromName,
                to: data.to === "__everyone__" ? "__everyone__" : authUser.id,
                text: data.text,
                time: data.time,
                isMine: false,
              },
            ]);
            break;
          case "peer-left":
            knownPeersRef.current.delete(data.peerId);
            manager.removePeer(data.peerId);
            break;
        }
      };

      ws.onerror = (e) => console.error("WebSocket error:", e);
      ws.onclose = () => console.log("WebSocket closed");

      // Self-healing retry: re-attempt any roster peer we're not connected to.
      reconcileTimerRef.current = setInterval(manager.reconcilePeers, 3000);
    };

    initialize();

    return () => {
      if (reconcileTimerRef.current) {
        clearInterval(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
      stopRecording();
      closePlaybackOutput();
      localMixBusRef.current?.close();
      localMixBusRef.current = null;
      wsRef.current?.close();
      pcs.forEach((pc) => pc.close());
      pcs.clear();
      iceQueue.clear();
      dataChannels.clear();
      incomingTransfers.clear();
      rawStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    peers,
    peerNames,
    peerUserIds,
    peerSessionKeysRef,
    peerVideoStates,
    peerAudioStates,
    peerConnectionStates,
    chatMessages,
    copied,
    copiedLink,
    isChatOpen,
    hasUnreadChat,
    isPlaybackReady,
    wsRef,
    dataChannelsRef,
    localVideoRef,
    remoteVideosRef,
    playbackAudioRef,
    isRecording,
    hasRecording,
    toggleRecording,
    stopRecording,
    downloadRecording,
    copyMeetingId,
    copyMeetingLink,
    toggleAudio,
    toggleVideo,
    leaveRoom,
    setIsChatOpen,
    setHasUnreadChat,
    handleSendChat,
  };
};

export default useMeetingRoomSession;
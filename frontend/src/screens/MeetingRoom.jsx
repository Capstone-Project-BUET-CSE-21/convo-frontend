import { useRef, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PropTypes from 'prop-types';
import "./MeetingRoom.css";
import createProcessedStream from "../audio/audioWorkletSetup";
import useMeetingRecording from "../meeting/useMeetingRecording";
import { getAuthToken } from "../auth/authSession";
import MeetingChat from "../components/MeetingChat";
import { ParticipantAvatar, RemoteParticipantTile } from "../components/MeetingRoomHelperComponents";
import { decodeChunkFrame, reassembleChunkFrames } from "../pipeline/transferFrames";
import { unwrapPayload, createChainStore } from "../pipeline/chainReconstruct";
import { verifyIncomingTransfer } from "../identity/verifyIncomingTransfer";

const WS_URL = import.meta.env.VITE_WS_BASE_URL;
const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;
const WATERMARK_URL = import.meta.env.VITE_WATERMARK_API_URL;

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
  const iceCandidatesQueueRef = useRef(new Map()); // peerId -> array of RTCIceCandidate
  const dataChannelsRef = useRef(new Map()); // peerId -> RTCDataChannel ("file-transfer")
  const incomingTransfersRef = useRef(new Map()); // peerId -> { meta, chunks, chunkCount, receivedBytes }
  const chainStoreRef = useRef(createChainStore()); // fileHash -> signedBlock, shared across all peers in this session
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

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
      await navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("Failed to copy meeting link:", err);
    }
  };

  // ── WebRTC helpers ───────────────────────────────────────────────────────

  // File transfers are chunked into ArrayBuffers and streamed straight over
  // the peer connection's data channel — no backend upload involved. Each
  // transfer is framed as: one "file-meta" JSON message, N binary chunks in
  // order, then one "file-end" JSON message. Because a data channel is
  // ordered by default and only carries one peer's traffic, we only need to
  // track a single in-flight transfer per peer at a time.
  const BUFFERED_AMOUNT_LOW_THRESHOLD = 1024 * 1024; // 1MB — used for backpressure on send

  const setupDataChannel = (peerId, channel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    dataChannelsRef.current.set(peerId, channel);

    channel.onopen = () => console.log(`Data channel open with ${peerId}`);

    channel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
      dataChannelsRef.current.delete(peerId);
      incomingTransfersRef.current.delete(peerId);
    };

    channel.onerror = (err) => {
      const isExpectedAbort =
        err?.error?.message?.includes("User-Initiated Abort") ||
        err?.error?.message?.includes("Close called");

      if (isExpectedAbort) {
        console.log(`Data channel with ${peerId} closed (peer disconnected)`);
        return;
      }

      console.error(`Data channel error with ${peerId}:`, err);
    };

    channel.onmessage = (e) => handleDataChannelMessage(peerId, e.data);
  };

  const handleDataChannelMessage = async (peerId, data) => {
    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.kind === "wrapped-file-meta") {
        incomingTransfersRef.current.set(peerId, {
          meta: msg,
          chunks: new Map(),
          chunkCount: msg.totalChunks,
          receivedBytes: 0,
        });
        return;
      }

      if (msg.kind === "wrapped-file-end") {
        const transfer = incomingTransfersRef.current.get(peerId);
        if (!transfer || transfer.meta.transferId !== msg.transferId) return;

        if (transfer.chunkCount == null) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : userId,
              text: "Could not receive file: missing chunk count.",
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        if (transfer.chunks.size !== transfer.chunkCount) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : userId,
              text: "Could not receive file: incomplete chunk stream.",
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        let wrappedBuffer;
        try {
          const orderedChunks = Array.from({ length: transfer.chunkCount }, (_, index) => {
            const chunk = transfer.chunks.get(index);
            if (!chunk) {
              throw new Error(`Missing chunk ${index}`);
            }
            return chunk;
          });
          wrappedBuffer = reassembleChunkFrames(orderedChunks);
        } catch (err) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : userId,
              text: `Could not receive file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        let signedBlock;
        let fileBytes;
        try {
          ({ signedBlock, fileBytes } = unwrapPayload(wrappedBuffer));
        } catch (err) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : userId,
              text: `Could not receive file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        const blob = new Blob([fileBytes], {
          type: transfer.meta.fileType || "application/octet-stream",
        });
        const fileUrl = URL.createObjectURL(blob);

        // 5.1 (hash + chain check) → 2.4 (signature check) → 5.2 (identity
        // mapping). Only ever attempts identity mapping once every check
        // has passed — see identity/verifyIncomingTransfer.js.
        let provenance;
        try {
          provenance = await verifyIncomingTransfer({
            signedBlock,
            fileBytes,
            chainStore: chainStoreRef.current,
            peerNames,
            fallbackName: peerNames.get(peerId) || transfer.meta.fromName,
            sessionName: roomId,
          });
        } catch (err) {
          console.error("Provenance verification failed unexpectedly:", err);
          provenance = { valid: false, reason: "hash-mismatch", senderName: null, timestamp: null };
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            type: "file",
            from: peerId,
            fromName: peerNames.get(peerId) || transfer.meta.fromName,
            to: transfer.meta.to === "__everyone__" ? "__everyone__" : userId,
            fileId: transfer.meta.transferId,
            fileUrl,
            fileName: transfer.meta.fileName,
            fileType: transfer.meta.fileType,
            fileSize: transfer.meta.fileSize,
            time: transfer.meta.time,
            isMine: false,
            provenance,
          },
        ]);

        incomingTransfersRef.current.delete(peerId);
        return;
      }

      return;
    }

    // Binary chunk for the transfer currently in flight from this peer.
    const transfer = incomingTransfersRef.current.get(peerId);
    if (!transfer) return;

    try {
      const { chunkIndex, payload } = decodeChunkFrame(data);
      transfer.chunks.set(chunkIndex, payload);
      transfer.receivedBytes += payload.byteLength;
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: Date.now() + Math.random(),
          type: "chat",
          from: peerId,
          fromName: peerNames.get(peerId) || "Guest",
          to: userId,
          text: `Could not receive file chunk: ${err.message}`,
          time: Date.now(),
          isMine: false,
          error: true,
        },
      ]);
      incomingTransfersRef.current.delete(peerId);
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
        if (!remoteStream.getTracks().includes(t)) {
          remoteStream.addTrack(t);
          remoteStream.dispatchEvent(new Event("addtrack")); // manually notify listeners
        }
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

    // The peer that sends the offer also creates the data channel (see
    // sendOffer below); whichever side that ends up being, this picks it up.
    pc.ondatachannel = (e) => setupDataChannel(peerId, e.channel);

    pcRef.current.set(peerId, pc);
    setPeers(prev => {
      if (!prev.includes(peerId)) return [...prev, peerId];
      return prev;
    });

    return pc;
  };

  const processQueuedCandidates = async (peerId) => {
    const pc = pcRef.current.get(peerId);
    if (!pc || !pc.remoteDescription) return;
    const queue = iceCandidatesQueueRef.current.get(peerId) || [];
    console.log(`Processing ${queue.length} queued ICE candidates for ${peerId}`);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("Added queued ICE candidate:", candidate);
      } catch (err) {
        console.error("Error adding queued ICE candidate:", err);
      }
    }
    iceCandidatesQueueRef.current.set(peerId, []);
  };

  const handleOffer = async (peerId, peerName, offer) => {
    console.log("Received offer from:", peerId);
    try {
      const pc = await createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await processQueuedCandidates(peerId);
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

      if (!dataChannelsRef.current.has(peerId)) {
        const channel = pc.createDataChannel("file-transfer", { ordered: true });
        setupDataChannel(peerId, channel);
      }

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
    const channel = dataChannelsRef.current.get(peerId);
    if (channel) channel.close();

    const pc = pcRef.current.get(peerId);
    if (pc) pc.close();

    pcRef.current.delete(peerId);
    iceCandidatesQueueRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    incomingTransfersRef.current.delete(peerId);
    setPeers(p => p.filter(id => id !== peerId));
  };

  const handleSendChat = (msg) => {
    setChatMessages((prev) => [
      ...prev,
      { ...msg, id: Date.now() + Math.random(), isMine: true },
    ]);
  };

  // ── Room actions ─────────────────────────────────────────────────────────

  const leaveRoom = () => {
    stopRecording();

    watermarkAudioContextRef.current?.close?.();
    watermarkAudioContextRef.current = null;
    watermarkWorkletNodeRef.current = null;

    pcRef.current.forEach(pc => pc.close());
    pcRef.current.clear();
    iceCandidatesQueueRef.current.clear();
    remoteVideosRef.current.clear();
    dataChannelsRef.current.clear();
    incomingTransfersRef.current.clear();
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
    console.log("Fetching watermark config");
    const res = await fetch(
      `${WATERMARK_URL}/api/watermark/config?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}`,
      { method: "GET" }
    );
    if (!res.ok) {
      throw new Error(`Watermark config request failed: ${res.status}`);
    }
    const config = await res.json();
    console.log("[watermark] resolved config for", userId, "=", {
      seed: config.seed,
      alpha: config.alpha,
      frameSize: config.frameSize,
      analysisWindowSize: config.analysisWindowSize,
      numBands: config.numBands,
    });
    return config;
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
      console.log("Received STUN/TURN server credentials");
    } catch (err) {
      console.error("Failed to fetch server credentials:", err);
    }
  };

  // ── Initialization effect ────────────────────────────────────────────────

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const pcs = pcRef.current;
    const iceQueue = iceCandidatesQueueRef.current;
    const dataChannels = dataChannelsRef.current;
    const incomingTransfers = incomingTransfersRef.current;

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
            await watermarkReadyPromiseRef.current;
            await handleOffer(data.from, data.payload.name, data.payload.offer);
            break;

          case "answer": {
            const pc = pcRef.current.get(data.from);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.payload.answer));
              await processQueuedCandidates(data.from);
            }
            peerNames.set(data.from, data.payload.name);
            setPeerNames(new Map(peerNames));
            console.log("Received answer from:", data.from);
            break;
          }

          case "ice": {
            const pc = pcRef.current.get(data.from);
            if (pc && pc.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(data.payload));
                console.log("Added ICE candidate from:", data.from);
              } catch (err) {
                console.error("ICE error:", err);
              }
            } else {
              console.log("Queueing ICE candidate from:", data.from);
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
                // if it's a DM arriving here, normalize 'to' to our userId
                to: data.to === "__everyone__" ? "__everyone__" : userId,
                text: data.text,
                time: data.time,
                isMine: false,
              },
            ]);
            break;

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
      iceQueue.clear();
      dataChannels.clear();
      incomingTransfers.clear();
      rawStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  // ── Gallery layout helper ────────────────────────────────────────────────

  // Total tile count includes the local user + all remote peers.
  const totalParticipants = peers.length + 1;

  // Expose tile count as a data attribute so CSS can apply grid rules per count.
  const gridDataAttr = { "data-tile-count": totalParticipants };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="meeting-room">

      {/* ── Header ── */}
      <header className="meeting-header">
        <div className="meeting-header__room-info">
          <span className="meeting-header__room-label">Room ID:</span>
          <span className="meeting-header__room-id">{roomId}</span>
        </div>

        <div className="meeting-header__actions">
          {/* Copy Meeting ID */}
          <button
            className={`meeting-header__copy-btn ${copied ? "meeting-header__copy-btn--success" : ""}`}
            onClick={copyMeetingId}
            aria-label="Copy Meeting ID"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
            <span>{copied ? "Copied" : "Copy ID"}</span>
          </button>

          {/* Copy Meeting Link */}
          <button
            className={`meeting-header__copy-btn ${copiedLink ? "meeting-header__copy-btn--success" : ""}`}
            onClick={copyMeetingLink}
            aria-label="Copy Meeting Link"
          >
            {copiedLink ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            )}
            <span>{copiedLink ? "Copied" : "Copy Link"}</span>
          </button>
        </div>
      </header>

      {/* ── Gallery stage ── */}
      <main className="meeting-stage">
        <section className="participants-grid" {...gridDataAttr}>

          {/* Local user tile — always first in the grid */}
          <div className="participant-card participant-card--self">
            <video
              ref={localVideoRef}
              className={`participant-video ${!isVideoEnabled ? "participant-video--hidden" : ""}`}
              autoPlay
              playsInline
              muted
            />

            {!isVideoEnabled && (
              <ParticipantAvatar name={authUser.displayName} size="large" />
            )}

            {/* Muted mic indicator — same mic SVG as Homepage, with the diagonal slash */}
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

          {/* Remote participant tiles */}
          {peers.map((peerId) => (
            <RemoteParticipantTile
              key={peerId}
              peerId={peerId}
              peerName={peerNames.get(peerId) || "Guest"}
              remoteVideosRef={remoteVideosRef}
            />
          ))}

          {/* Waiting state — shown only when the local user is alone */}
          {peers.length === 0 && (
            <div className="participants-grid__waiting">
              <p className="participants-grid__waiting-text">Waiting for others to join…</p>
            </div>
          )}

        </section>
      </main>

      {/* ── Bottom toolbar ── */}
      <footer className="meeting-toolbar">

        {/* 1. Mute / Unmute — mic SVG from Homepage, slash rendered conditionally */}
        <button
          className={`toolbar-btn toolbar-btn--audio ${!isAudioEnabled ? "toolbar-btn--off" : ""}`}
          onClick={toggleAudio}
          aria-label={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
            {!isAudioEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
          </svg>
          <span className="toolbar-btn__label">{isAudioEnabled ? "Mute" : "Unmute"}</span>
        </button>

        {/* 2. Camera On / Off — video SVG from Homepage, slash rendered conditionally */}
        <button
          className={`toolbar-btn toolbar-btn--video ${!isVideoEnabled ? "toolbar-btn--off" : ""}`}
          onClick={toggleVideo}
          aria-label={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            {!isVideoEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
          </svg>
          <span className="toolbar-btn__label">{isVideoEnabled ? "Camera On" : "Camera Off"}</span>
        </button>

        {/* 3. Record Audio */}
        <div className="toolbar-btn-group">
          <button
            className={`toolbar-btn toolbar-btn--record ${isRecording ? "toolbar-btn--active" : ""}`}
            onClick={toggleRecording}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? (
              /* Stop — filled square */
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
            ) : (
              /* Record — filled circle */
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="8"></circle>
              </svg>
            )}
            <span className="toolbar-btn__label">{isRecording ? "Stop Rec" : "Record"}</span>
          </button>

          {hasRecording && !isRecording && (
            <button
              className="toolbar-btn toolbar-btn--download"
              onClick={downloadRecording}
              aria-label="Download recording"
            >
              {/* Download arrow */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span className="toolbar-btn__label">Download</span>
            </button>
          )}
        </div>

        {/* 4. Chat (placeholder — functionality not yet implemented) */}
        <button
          className="toolbar-btn toolbar-btn--chat"
          onClick={() => setIsChatOpen((prev) => !prev)}
          aria-label="Toggle chat"
        >
          <span className="toolbar-btn__icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            {hasUnreadChat && !isChatOpen && (
              <span className="toolbar-btn__unread-dot" aria-hidden="true" />
            )}
          </span>
          <span className="toolbar-btn__label">Chat</span>
        </button>

        {/* 5. Leave Call */}
        <button
          className="toolbar-btn toolbar-btn--leave"
          onClick={leaveRoom}
          aria-label="Leave call"
        >
          {/* Phone with arrow indicating hang-up */}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.34 9.9a16 16 0 0 0 3.34 3.41z"></path>
            <line x1="23" y1="1" x2="17" y2="7"></line>
            <polyline points="17 1 23 1 23 7"></polyline>
          </svg>
          <span className="toolbar-btn__label">Leave</span>
        </button>

      </footer>
      <MeetingChat
        isOpen={isChatOpen}
        onClose={() => setIsChatOpen(false)}
        wsRef={wsRef}
        dataChannelsRef={dataChannelsRef}
        roomId={roomId}
        peers={peers}
        peerNames={peerNames}
        currentUser={{ id: userId, displayName: authUser.displayName }}
        chatMessages={chatMessages}
        onSend={handleSendChat}
        onUnreadChange={setHasUnreadChat}
      />

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
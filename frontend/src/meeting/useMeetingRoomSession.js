import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createLocalMixBus, createWatermarkedPlaybackStream } from "../audio/audioWatermarkSetup";
import { getAuthToken } from "../auth/authSession";
import { decodeChunkFrame, reassembleChunkFrames } from "../pipeline/transferFrames";
// import { unwrapPayload, createChainStore } from "../pipeline/chainReconstruct";
import { unwrapPayload } from "../pipeline/chainReconstruct";
import { verifyIncomingTransfer } from "../identity/verifyIncomingTransfer";
import useMeetingRecording from "./useMeetingRecording";
import { decryptPayload } from "../pipeline/encryptionEnvelope";

const WS_URL = import.meta.env.VITE_WS_BASE_URL;
const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;
const WATERMARK_URL = import.meta.env.VITE_WATERMARK_API_URL;
// by taba
const CONFIDENTIALITY_API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;
const BUFFERED_AMOUNT_LOW_THRESHOLD = 1024 * 1024;

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
  const iceCandidatesQueueRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const incomingTransfersRef = useRef(new Map());
  // by Taba
  // const chainStoreRef = useRef(createChainStore());
  const rawStreamRef = useRef(null);

  const playbackAudioRef = useRef(null);
  const playbackAudioContextRef = useRef(null);
  const playbackWorkletNodeRef = useRef(null);
  const playbackStreamRef = useRef(null);
  const localMixBusRef = useRef(null);

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

  const setupDataChannel = (peerId, channel) => {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    dataChannelsRef.current.set(peerId, channel);

    channel.onclose = () => {
      dataChannelsRef.current.delete(peerId);
      incomingTransfersRef.current.delete(peerId);
    };

    channel.onerror = (err) => {
      const isExpectedAbort =
        err?.error?.message?.includes("User-Initiated Abort") ||
        err?.error?.message?.includes("Close called");

      if (isExpectedAbort) return;
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
        console.log("File metadata received:", transfer.meta.fileName, transfer.meta);
        if (transfer.chunkCount == null || transfer.chunks.size !== transfer.chunkCount) {
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
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
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: `Could not receive file: ${err.message}`,
              time: Date.now(),
              isMine: false,
              error: true,
            },
          ]);
          incomingTransfersRef.current.delete(peerId);
          return;
        }

        // with:
        let decryptedBuffer;
        console.log("Decrypting as authUser.id:", authUser.id);
        try {
          decryptedBuffer = await decryptPayload(wrappedBuffer, { recipientId: authUser.id });
        } catch (err) {
          console.error("Decrypt error:", err.name, err.message, err);
          setChatMessages((prev) => [
            ...prev,

            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
              text: `Could not decrypt file: ${err.message}`,
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
          ({ signedBlock, fileBytes } = unwrapPayload(decryptedBuffer));
        } catch (err) { 
          setChatMessages((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type: "chat",
              from: peerId,
              fromName: peerNames.get(peerId) || transfer.meta.fromName,
              to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
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

        let provenance;
        try {
          // provenance = await verifyIncomingTransfer({
          //   signedBlock,
          //   fileBytes,
          //   chainStore: chainStoreRef.current,
          //   peerNames,
          //   fallbackName: peerNames.get(peerId) || transfer.meta.fromName,
          //   sessionName: roomId,
          // });
          // added by taba
            provenance = await verifyIncomingTransfer({
            signedBlock,
            fileBytes,
            baseUrl: CONFIDENTIALITY_API_BASE_URL,   // NOT BACKEND_URL — this is the
                                                      // service that owns /api/transfer/metadata,
                                                      // same one provenancePipeline.js posts to
            peerNames,
            fallbackName: peerNames.get(peerId) || transfer.meta.fromName,
            sessionName: roomId,
          });
        } catch (err) {
          console.error("Provenance verification failed unexpectedly:", err);
          provenance = { valid: false, reason: "verification error", senderName: null, timestamp: null };
        }

        setChatMessages((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            type: "file",
            from: peerId,
            fromName: peerNames.get(peerId) || transfer.meta.fromName,
            to: transfer.meta.to === "__everyone__" ? "__everyone__" : authUser.id,
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
          to: authUser.id,
          text: `Could not receive file chunk: ${err.message}`,
          time: Date.now(),
          isMine: false,
          error: true,
        },
      ]);
      incomingTransfersRef.current.delete(peerId);
    }
  };

  const removePeer = (peerId) => {
    console.log(`[LEAVE-DEBUG] removePeer(${peerId}) executing at ${Date.now()}`);
    const channel = dataChannelsRef.current.get(peerId);
    if (channel) channel.close();

    const pc = pcRef.current.get(peerId);
    if (pc) pc.close();

    localMixBusRef.current?.removeSource(peerId);

    pcRef.current.delete(peerId);
    iceCandidatesQueueRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    incomingTransfersRef.current.delete(peerId);
    setPeers((prev) => prev.filter((id) => id !== peerId));
  };

  const createPeerConnection = async (peerId) => {
    if (pcRef.current.has(peerId)) {
      return pcRef.current.get(peerId);
    }

    const pc = new RTCPeerConnection({ iceServers: serverRef.current });

    if (localVideoRef.current?.srcObject) {
      const stream = localVideoRef.current.srcObject;
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    }

    const remoteStream = new MediaStream();
    remoteVideosRef.current.set(peerId, remoteStream);

    pc.ontrack = (e) => {
      const track = e.track;

      if (track.kind === "audio") {
        localMixBusRef.current?.addSource(peerId, track);
        track.addEventListener("ended", () => {
          localMixBusRef.current?.removeSource(peerId);
        });
      }

      e.streams[0].getTracks().forEach((t) => {
        if (!remoteStream.getTracks().includes(t)) {
          remoteStream.addTrack(t);
          remoteStream.dispatchEvent(new Event("addtrack"));
        }
      });
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        wsRef.current.send(JSON.stringify({
          type: "ice",
          roomId,
          to: peerId,
          payload: e.candidate,
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[LEAVE-DEBUG] pc.connectionState for ${peerId} -> ${pc.connectionState} at ${Date.now()}`);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        removePeer(peerId);
      }
    };

    pc.ondatachannel = (e) => setupDataChannel(peerId, e.channel);

    pcRef.current.set(peerId, pc);
    setPeers((prev) => (prev.includes(peerId) ? prev : [...prev, peerId]));
    return pc;
  };

  const processQueuedCandidates = async (peerId) => {
    const pc = pcRef.current.get(peerId);
    if (!pc || !pc.remoteDescription) return;

    const queue = iceCandidatesQueueRef.current.get(peerId) || [];
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("Error adding queued ICE candidate:", err);
      }
    }
    iceCandidatesQueueRef.current.set(peerId, []);
  };

  const handleOffer = async (peerId, peerName, offer, peerVideoEnabled, peerUserId) => {
    try {
      const pc = await createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await processQueuedCandidates(peerId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setPeerNames((prev) => new Map(prev).set(peerId, peerName));
      setPeerUserIds((prev) => new Map(prev).set(peerId, peerUserId));
      setPeerVideoStates((prev) => new Map(prev).set(peerId, peerVideoEnabled !== false));

      wsRef.current.send(JSON.stringify({
        type: "answer",
        roomId,
        to: peerId,
        payload: { answer, name: authUser.displayName, videoEnabled: isVideoEnabled, userId: authUser.id },
      }));
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
        type: "offer",
        roomId,
        to: peerId,
        payload: { offer, name: authUser.displayName, videoEnabled: isVideoEnabled, userId: authUser.id },
      }));
    } catch (err) {
      console.error("Error sending offer to new peer", peerId, err);
    }
  };

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
    const res = await fetch(
      `${WATERMARK_URL}/api/watermark/config?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(authUser.id)}`,
      { method: "GET" }
    );
    if (!res.ok) {
      throw new Error(`Watermark config request failed: ${res.status}`);
    }
    return res.json();
  };

  const initPlaybackWatermark = async () => {
    try {
      const config = await fetchWatermarkConfig();
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

  const fetchServerCredentials = async () => {
    try {
      const token = getAuthToken();
      const response = await fetch(`${BACKEND_URL}/api/backend/credentials`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Credentials request failed: ${response.status}`);
      }

      const data = await response.json();
      serverRef.current = data.credentials;
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
    console.log(`[LEAVE-DEBUG] leaveRoom() invoked at ${Date.now()}`);

    // Send an explicit "leave" message FIRST, while the socket is still
    // open — this is what actually tells other participants we've left.
    // Waiting on afterConnectionClosed (TCP teardown detection) instead
    // depends on the hosting platform's proxy propagating the close, which
    // can lag by several seconds. stopRecording() below does a synchronous,
    // potentially multi-second WAV encode of the whole recording buffer;
    // running it before this would block the leave signal behind it,
    // leaving our tile frozen on everyone else's screen until it finishes.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`[LEAVE-DEBUG] sending leave message at ${Date.now()}`);
      wsRef.current.send(JSON.stringify({ type: "leave", roomId }));
    }

    pcRef.current.forEach((pc) => pc.close());
    pcRef.current.clear();
    iceCandidatesQueueRef.current.clear();
    remoteVideosRef.current.clear();
    dataChannelsRef.current.clear();
    incomingTransfersRef.current.clear();
    setPeers([]);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`[LEAVE-DEBUG] calling ws.close() at ${Date.now()}`);
      wsRef.current.close();
    } else {
      console.log(`[LEAVE-DEBUG] ws not OPEN at leave time, readyState=${wsRef.current?.readyState}`);
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
        fetchServerCredentials(),
        makeMeetingEntry(),
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

      initPlaybackWatermark();

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
            await sendOffer(data.peerId);
            break;
          case "offer":
            await handleOffer(data.from, data.payload.name, data.payload.offer, data.payload.videoEnabled,  data.payload.userId);
            break;
          case "answer": {
            const pc = pcRef.current.get(data.from);
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.payload.answer));
              await processQueuedCandidates(data.from);
            }
            setPeerNames((prev) => new Map(prev).set(data.from, data.payload.name));
            setPeerUserIds((prev) => new Map(prev).set(data.from, data.payload.userId));
            setPeerVideoStates((prev) => new Map(prev).set(data.from, data.payload.videoEnabled !== false));
            break;
          }
          case "video-state":
            setPeerVideoStates((prev) => new Map(prev).set(data.from, data.payload.enabled));
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
            console.log(`[LEAVE-DEBUG] peer-left received for ${data.peerId} at ${Date.now()}`);
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
    peerVideoStates,
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
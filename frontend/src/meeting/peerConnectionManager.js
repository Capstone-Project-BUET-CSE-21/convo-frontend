// WebRTC full-mesh peer management: building peer connections, the
// offer/answer/ICE exchange, routing remote audio into the mix bus, and the
// self-healing reconciliation pass. Factored out of the session hook as a
// factory closing over the refs and state setters it drives.

export const createPeerConnectionManager = ({
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
  // A ref holding { audio, video } — the current local mute/camera flags, read
  // live so an offer/answer advertises the state at negotiation time.
  mediaFlagsRef,
  setupDataChannel,
  setPeers,
  setPeerNames,
  setPeerUserIds,
  setPeerVideoStates,
  setPeerAudioStates,
  setPeerConnectionStates,
}) => {
  // Deterministic initiator rule: for any pair, exactly the peer with the
  // lexicographically smaller id creates the offer. This guarantees a single
  // offerer per pair (no glare) regardless of join order, and gives the
  // reconciliation timer an unambiguous "should I offer, or nudge the other
  // side?" answer.
  const isInitiator = (peerId) =>
    selfIdRef.current != null && selfIdRef.current < peerId;

  // A connection we should leave alone rather than rebuild. failed/closed are
  // terminal (onconnectionstatechange tears those down); "disconnected" is
  // often transient and recovers on its own, so we don't yank it early.
  const isConnectionUsable = (peerId) => {
    const pc = pcRef.current.get(peerId);
    if (!pc) return false;
    const s = pc.connectionState;
    return s === "new" || s === "connecting" || s === "connected" || s === "disconnected";
  };

  // Route a remote peer's audio track into the shared mix bus so it's audible.
  // The old code did `localMixBusRef.current?.addSource(...)`, which silently
  // dropped the track whenever the bus wasn't ready at that instant — the cause
  // of "I can see them but can't hear them" while their video renders. Here we
  // (1) queue the track if the bus isn't up yet and flush it later, and
  // (2) treat any failure as a queue-and-retry rather than a silent no-op, so a
  // single peer's audio can never vanish without a trace.
  const attachRemoteAudio = (peerId, track) => {
    const mixBus = localMixBusRef.current;
    if (!mixBus) {
      pendingAudioTracksRef.current.set(peerId, track);
      return;
    }
    try {
      // A suspended AudioContext produces no sound; nudge it awake (best effort).
      mixBus.audioContext?.resume?.().catch(() => { });
      mixBus.addSource(peerId, track);
      pendingAudioTracksRef.current.delete(peerId);
    } catch (err) {
      console.error(`Failed to attach remote audio for ${peerId}, will retry:`, err);
      pendingAudioTracksRef.current.set(peerId, track);
    }
  };

  const removePeer = (peerId) => {
    const channel = dataChannelsRef.current.get(peerId);
    if (channel) channel.close();

    const pc = pcRef.current.get(peerId);
    if (pc) pc.close();

    localMixBusRef.current?.removeSource(peerId);
    pendingAudioTracksRef.current.delete(peerId);

    pcRef.current.delete(peerId);
    iceCandidatesQueueRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    dataChannelsRef.current.delete(peerId);
    incomingTransfersRef.current.delete(peerId);
    setPeers((prev) => prev.filter((id) => id !== peerId));
    setPeerConnectionStates((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
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
        attachRemoteAudio(peerId, track);
        track.addEventListener("ended", () => {
          localMixBusRef.current?.removeSource(peerId);
          pendingAudioTracksRef.current.delete(peerId);
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
      const state = pc.connectionState;
      console.log(`[peer ${peerId}] connectionState=${state}`);
      setPeerConnectionStates((prev) => new Map(prev).set(peerId, state));
      if (state === "failed" || state === "closed") {
        // The reconcile timer will re-establish this peer if it's still in the
        // roster; removePeer just clears the dead handle and its tile.
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

  const handleOffer = async (peerId, peerName, offer, peerVideoEnabled, peerUserId, peerAudioEnabled) => {
    try {
      // Keep the roster in sync even if we never got a peer-joined/roster entry
      // for this peer (e.g. that message was lost) — so our reconcile timer
      // will maintain this connection too.
      knownPeersRef.current.set(peerId, peerUserId || knownPeersRef.current.get(peerId) || "");

      const pc = await createPeerConnection(peerId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await processQueuedCandidates(peerId);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      setPeerNames((prev) => new Map(prev).set(peerId, peerName));
      setPeerUserIds((prev) => new Map(prev).set(peerId, peerUserId));
      setPeerVideoStates((prev) => new Map(prev).set(peerId, peerVideoEnabled !== false));
      setPeerAudioStates((prev) => new Map(prev).set(peerId, peerAudioEnabled !== false));

      const { audio, video } = mediaFlagsRef.current;
      wsRef.current.send(JSON.stringify({
        type: "answer",
        roomId,
        to: peerId,
        payload: { answer, name: authUser.displayName, videoEnabled: video, audioEnabled: audio, userId: authUser.id },
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

      const { audio, video } = mediaFlagsRef.current;
      wsRef.current.send(JSON.stringify({
        type: "offer",
        roomId,
        to: peerId,
        payload: { offer, name: authUser.displayName, videoEnabled: video, audioEnabled: audio, userId: authUser.id },
      }));
    } catch (err) {
      console.error("Error sending offer to new peer", peerId, err);
    }
  };

  // Periodic self-healing pass over the roster. For every peer we're supposed
  // to be connected to but aren't (missed peer-joined, dropped offer, ICE that
  // never completed, a connection that failed): the initiator re-offers, the
  // other side nudges the initiator with a request-offer. Idempotent — a
  // healthy or in-progress connection is skipped, so this never disturbs a good
  // link, and it keeps trying until the connection sticks.
  const reconcilePeers = () => {
    if (!selfIdRef.current) return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    // Retry any remote audio track that couldn't be attached earlier, so a peer
    // whose audio was momentarily dropped becomes audible without a reconnect.
    if (localMixBusRef.current && pendingAudioTracksRef.current.size > 0) {
      pendingAudioTracksRef.current.forEach((track, pid) => attachRemoteAudio(pid, track));
    }

    for (const peerId of knownPeersRef.current.keys()) {
      if (peerId === selfIdRef.current) continue;
      if (isConnectionUsable(peerId)) continue;

      // Tear down any terminal (failed/closed) connection so createPeerConnection
      // builds a fresh one instead of returning the dead handle.
      if (pcRef.current.has(peerId)) {
        removePeer(peerId);
      }

      if (isInitiator(peerId)) {
        sendOffer(peerId);
      } else {
        wsRef.current.send(JSON.stringify({
          type: "request-offer",
          roomId,
          to: peerId,
        }));
      }
    }
  };

  return {
    isInitiator,
    isConnectionUsable,
    attachRemoteAudio,
    removePeer,
    createPeerConnection,
    processQueuedCandidates,
    handleOffer,
    sendOffer,
    reconcilePeers,
  };
};

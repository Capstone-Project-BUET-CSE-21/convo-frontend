import React, { useRef, useEffect, useState } from "react";

const ROOM_ID = "room1";
const WS_BASE = import.meta.env.VITE_FARIHA_API_BASE;

const SingleRoom = () => {
  const localVideoRef = useRef();
  const wsRef = useRef(null);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // peerId -> RTCPeerConnection
  const remoteStreamsRef = useRef(new Map());   // peerId -> MediaStream

  const [peers, setPeers] = useState([]);

  useEffect(() => {
    wsRef.current = new WebSocket(`wss://${WS_BASE}/ws`);

    wsRef.current.onopen = () => {
      wsRef.current.send(JSON.stringify({
        type: "join",
        roomId: ROOM_ID
      }));
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const { type, peerId, from, payload, peers } = data;

      switch (type) {
        case "existing-peers":
          // Just store the existing peers without creating connections yet
          // User must click "Start Call / Join" to initiate
          setPeers(peers);
          break;

        case "peer-joined":
          // When a new peer joins, add them to the list but don't create connection yet
          setPeers(prev => [...new Set([...prev, peerId])]);
          break;

        case "offer":
          await handleOffer(from, payload);
          break;

        case "answer":
          await peerConnectionsRef.current
            .get(from)
            ?.setRemoteDescription(new RTCSessionDescription(payload));
          break;

        case "ice":
          await peerConnectionsRef.current
            .get(from)
            ?.addIceCandidate(new RTCIceCandidate(payload));
          break;

        case "peer-left":
          removePeer(peerId);
          break;
      }
    };

    initMedia();

    return () => {
      wsRef.current?.close();
      peerConnectionsRef.current.forEach(pc => pc.close());
    };
  }, []);

  const initMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    localVideoRef.current.srcObject = stream;
  };

  const createPeerConnection = async (peerId) => {
    if (peerConnectionsRef.current.has(peerId)) return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    localStreamRef.current.getTracks().forEach(track =>
      pc.addTrack(track, localStreamRef.current)
    );

    const remoteStream = new MediaStream();
    remoteStreamsRef.current.set(peerId, remoteStream);

    pc.ontrack = e => {
      e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        wsRef.current.send(JSON.stringify({
          type: "ice",
          roomId: ROOM_ID,
          to: peerId,
          payload: e.candidate
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
    };

    peerConnectionsRef.current.set(peerId, pc);
    setPeers(prev => [...new Set([...prev, peerId])]);
  };

  const startCall = async () => {
    console.log("Starting call with peers:", peers);
    
    // First, create peer connections for all existing peers
    for (const peerId of peers) {
      await createPeerConnection(peerId);
    }

    // Then send offers to all peers
    for (const peerId of peerConnectionsRef.current.keys()) {
      try {
        const pc = peerConnectionsRef.current.get(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        wsRef.current.send(JSON.stringify({
          type: "offer",
          roomId: ROOM_ID,
          to: peerId,
          payload: offer
        }));
        console.log("Sent offer to:", peerId);
      } catch (err) {
        console.error("Error sending offer:", err);
      }
    }
  };

  const handleOffer = async (peerId, offer) => {
    console.log("Received offer from:", peerId);
    await createPeerConnection(peerId);
    const pc = peerConnectionsRef.current.get(peerId);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsRef.current.send(JSON.stringify({
        type: "answer",
        roomId: ROOM_ID,
        to: peerId,
        payload: answer
      }));
      console.log("Sent answer to:", peerId);
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const removePeer = (peerId) => {
    peerConnectionsRef.current.get(peerId)?.close();
    peerConnectionsRef.current.delete(peerId);
    remoteStreamsRef.current.delete(peerId);
    setPeers(p => p.filter(id => id !== peerId));
  };

  const leaveRoom = () => {
    // Close all peer connections
    peerConnectionsRef.current.forEach(pc => pc.close());
    peerConnectionsRef.current.clear();
    remoteStreamsRef.current.clear();
    setPeers([]);

    // Stop all local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }

    // Close WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    console.log("Left room: " + ROOM_ID);
  };

  return (
    <div>
      <h2>Room: {ROOM_ID}</h2>

      <video ref={localVideoRef} autoPlay muted playsInline width={300} />

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {peers.map(pid => (
          <video
            key={pid}
            autoPlay
            playsInline
            width={300}
            ref={el => {
              if (el) el.srcObject = remoteStreamsRef.current.get(pid);
            }}
          />
        ))}
      </div>

      <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
        <button onClick={startCall}>Start Call / Join</button>
        <button onClick={leaveRoom} style={{ backgroundColor: "#ff4444", color: "white", padding: "10px 20px", border: "none", borderRadius: "4px", cursor: "pointer" }}>Leave Room</button>
      </div>
    </div>
  );
};

export default SingleRoom;

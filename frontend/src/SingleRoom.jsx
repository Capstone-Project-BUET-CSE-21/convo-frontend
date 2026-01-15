import React, { useRef, useEffect, useState } from "react";

const ROOM_ID = "room1";
const WS_BASE = import.meta.env.VITE_API_BASE;

const SingleRoom = () => {
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // 1️⃣ Connect to signaling server
    wsRef.current = new WebSocket(`wss://${WS_BASE}/ws`);

    wsRef.current.onopen = () => {
      console.log("Connected to signaling server");
      wsRef.current.send(JSON.stringify({
        type: "join",
        roomId: ROOM_ID
      }));
      setConnected(true);
    };

    wsRef.current.onclose = () => {
      console.log("Disconnected from signaling server");
      setConnected(false);
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      const { type, payload } = data;

      if (!pcRef.current) return;

      switch (type) {
        case "offer": {
          await pcRef.current.setRemoteDescription(payload);
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          wsRef.current.send(JSON.stringify({
            type: "answer",
            roomId: ROOM_ID,
            payload: answer
          }));
          break;
        }

        case "answer":
          await pcRef.current.setRemoteDescription(payload);
          break;

        case "ice":
          try {
            await pcRef.current.addIceCandidate(payload);
          } catch (e) {
            console.error("Error adding received ice candidate", e);
          }
          break;

        default:
          break;
      }
    };

    // 2️⃣ Get local media
    const init = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideoRef.current.srcObject = stream;

      // 3️⃣ Create PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          {
            urls: "stun:stun.relay.metered.ca:80",
          },
          {
            urls: "turn:global.relay.metered.ca:80",
            username: "587fae9b9e261459032795cc",
            credential: "V1AMbjxp0ByH3JVr",
          },
          {
            urls: "turn:global.relay.metered.ca:80?transport=tcp",
            username: "587fae9b9e261459032795cc",
            credential: "V1AMbjxp0ByH3JVr",
          },
          {
            urls: "turn:global.relay.metered.ca:443",
            username: "587fae9b9e261459032795cc",
            credential: "V1AMbjxp0ByH3JVr",
          },
          {
            urls: "turns:global.relay.metered.ca:443?transport=tcp",
            username: "587fae9b9e261459032795cc",
            credential: "V1AMbjxp0ByH3JVr",
          },
        ],
      });
      pcRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote tracks
      const remoteStream = new MediaStream();
      remoteVideoRef.current.srcObject = remoteStream;

      pc.ontrack = (event) => {
        event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
      };

      // ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("ICE:", event.candidate.candidate);

          wsRef.current.send(JSON.stringify({
            type: "ice",
            roomId: ROOM_ID,
            payload: event.candidate
          }));
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE state:", pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.log("PC state:", pc.connectionState);
      };
    };

    init();

    return () => {
      wsRef.current.close();
      pcRef.current?.close();
    };
  }, []);

  const createOffer = async () => {
    if (!pcRef.current || !connected) return;
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    wsRef.current.send(JSON.stringify({
      type: "offer",
      roomId: ROOM_ID,
      payload: offer
    }));
  };

  return (
    <div>
      <h2>Single Room</h2>
      <video ref={localVideoRef} autoPlay muted playsInline style={{ width: "400px" }} />
      <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "400px" }} />
      <button onClick={createOffer}>Start Call / Join</button>
    </div>
  );
}

export default SingleRoom;

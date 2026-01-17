import { useRef, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PropTypes from 'prop-types';

const WS_BASE = import.meta.env.VITE_API_BASE_MONA;

const SingleRoom = ({ localStream }) => {
  const params = useParams();
  const roomId = params.roomId;
  const wsRef = useRef(null);
  const pcRef = useRef(new Map());

  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(new Map());

  const [peers, setPeers] = useState([]);
  const [isRecentlyJoined, setIsRecentlyJoined] = useState(true);
  const navigate = useNavigate();


  const createPeerConnection = async (peerId) => {
    if (pcRef.current.has(peerId)) return;

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

    const stream = localVideoRef.current.srcObject;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));

    const remoteStream = new MediaStream();
    remoteVideosRef.current.set(peerId, remoteStream);

    pc.ontrack = e => {
      e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        wsRef.current.send(JSON.stringify({
          type: "ice",
          roomId: roomId,
          to: peerId,
          payload: e.candidate
        }));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
    };

    pcRef.current.set(peerId, pc);
    setPeers(prev => [...new Set([...prev, peerId])]);
  };

  const handleOffer = async (peerId, offer) => {
    console.log("Received offer from:", peerId);
    await createPeerConnection(peerId);
    const pc = pcRef.current.get(peerId);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsRef.current.send(JSON.stringify({
        type: "answer",
        roomId: roomId,
        to: peerId,
        payload: answer
      }));
      console.log("Sent answer to:", peerId);
    } catch (err) {
      console.error("Error handling offer:", err);
    }
  };

  const removePeer = (peerId) => {
    pcRef.current.get(peerId)?.close();
    pcRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    setPeers(p => p.filter(id => id !== peerId));
  };

  const leaveRoom = () => {
    // Close all peer connections
    pcRef.current.forEach(pc => pc.close());
    pcRef.current.clear();
    remoteVideosRef.current.clear();
    setPeers([]);

    // Close WebSocket
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    navigate("/");

    console.log("Left room: " + roomId);
  };

  useEffect(() => {
    wsRef.current = new WebSocket(`wss://${WS_BASE}/ws`);

    wsRef.current.onopen = () => {
      wsRef.current.send(JSON.stringify({
        type: "join",
        roomId: roomId
      }));
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "existing-peers":
          // Just store the existing peers without creating connections yet
          // User must click "Start Call / Join" to initiate
          setPeers(data.peers);
          break;

        case "peer-joined":
          // When a new peer joins, add them to the list but don't create connection yet
          setPeers(prev => [...new Set([...prev, data.peerId])]);
          setIsRecentlyJoined(false);
          break;

        case "offer":
          await handleOffer(data.from, data.payload);
          break;

        case "answer":
          await pcRef.current
            .get(data.from)
            ?.setRemoteDescription(new RTCSessionDescription(data.payload));
          break;

        case "ice":
          await pcRef.current
            .get(data.from)
            ?.addIceCandidate(new RTCIceCandidate(data.payload));
          break;

        case "peer-left":
          removePeer(data.peerId);
          break;
      }
    };

    localVideoRef.current.srcObject = localStream;

    // startCall
    

    return () => {
      wsRef.current?.close();
      pcRef.current.forEach(pc => pc.close());
    };
  }, []);

  useEffect(() => {
    console.log("Current peers:", peers);

    if (isRecentlyJoined && peers.length > 0) {
      const startCall = async () => {
        setIsRecentlyJoined(false);
        for (const peerId of peers) {
          await createPeerConnection(peerId);
        }

        // Then send offers to all peers
        for (const peerId of peers) {
          try {
            const pc = pcRef.current.get(peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            wsRef.current.send(JSON.stringify({
              type: "offer",
              roomId: roomId,
              to: peerId,
              payload: offer
            }));
            console.log("Sent offer to:", peerId);
          } catch (err) {
            console.error("Error sending offer:", err);
          }
        }
      };

      startCall();
    }
  }, [peers]);



  return (
    <div>
      <h2>Room: {roomId}</h2>

      <video ref={localVideoRef} autoPlay muted playsInline width={300} style={{transform: "scaleX(-1)"}} />

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        {peers.map(pid => (
          <video
            key={pid}
            autoPlay
            playsInline
            width={300}
            ref={el => {
              if (el) el.srcObject = remoteVideosRef.current.get(pid);
            }}
          />
        ))}
      </div>

      <div style={{ marginTop: "20px", display: "flex", flexDirection: "row", justifyContent: "center" ,gap: "10px" }}>
        <button onClick={leaveRoom} style={{ backgroundColor: "#ff4444", color: "white", padding: "10px 20px", border: "none", borderRadius: "4px", cursor: "pointer" }}>Leave Room</button>
      </div>
    </div>
  );
};

SingleRoom.propTypes = {
  localStream: PropTypes.object.isRequired,
};

export default SingleRoom;

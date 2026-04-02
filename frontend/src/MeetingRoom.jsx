import { useRef, useEffect, useState} from "react";
import { useNavigate, useParams } from "react-router-dom";
import PropTypes from 'prop-types';
import "./MeetingRoom.css";
import createProcessedStream from "./audio/audioWorkletSetup";

const API_BASE = "localhost:8080"; // Adjust if your backend runs on a different host/port

const MeetingRoom = ({ meetingRoomAttributes }) => {
  const { command, isAudioEnabledPair, isVideoEnabledPair, toggleAudio, toggleVideo } = meetingRoomAttributes;
  const { isAudioEnabled, setIsAudioEnabled } = isAudioEnabledPair;
  const { isVideoEnabled, setIsVideoEnabled } = isVideoEnabledPair;

  const params = useParams();
  const roomId = params.roomId;

  const serverRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(new Map());

  const rawStreamRef = useRef(null); // Store raw media stream for later processing and track replacement
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef(new Map());
  const gainNodeRef = useRef(null);

  const [peers, setPeers] = useState([]);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const [userId, setUserId] = useState("");


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
      console.log(`Peer connection already exists for ${peerId}`);
      return pcRef.current.get(peerId);
    }

    console.log(`Creating peer connection for ${peerId}`);

    const iceServers = serverRef.current;
    const pc = new RTCPeerConnection({iceServers});

    // Add local stream tracks
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject;
      stream.getTracks().forEach(track => {
        console.log(`Adding ${track.kind} track to peer ${peerId}`);
        pc.addTrack(track, stream);
      });
    }

    // Create remote stream
    const remoteStream = new MediaStream();
    remoteVideosRef.current.set(peerId, remoteStream);

    pc.ontrack = e => {
      console.log(`Received ${e.track.kind} track from ${peerId}`);
      e.streams[0].getTracks().forEach(t => {
        if (!remoteStream.getTracks().includes(t)) {
          remoteStream.addTrack(t);
        }
      });
    };

    pc.onicecandidate = e => {
      if (e.candidate) {
        console.log(`Sending ICE candidate to ${peerId}`);
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
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        console.log(`Removing failed connection for ${peerId}`);
        removePeer(peerId);
      }
    };

    pcRef.current.set(peerId, pc);
    setPeers(prev => {
      if (!prev.includes(peerId)) {
        return [...prev, peerId];
      }
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

  const sendOffer = async (peerId) => {
    console.log("New peer joined:", peerId);
    try {
      const pc = await createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: "offer",
        roomId: roomId,
        to: peerId,
        payload: offer
      }));
      console.log("Sent offer to new peer:", peerId);
    } catch (err) {
      console.error("Error sending offer to new peer", peerId, err);
    }
  };

  const removePeer = (peerId) => {
    const pc = pcRef.current.get(peerId);
    if (pc) {
      pc.close();
    }
    pcRef.current.delete(peerId);
    remoteVideosRef.current.delete(peerId);
    setPeers(p => p.filter(id => id !== peerId));
  };

  const leaveRoom = () => {
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

  const fetchServerCredentials = async () => {
    try {
      const response = await fetch(`/api/backend/credentials`, {
        method: "GET",
        headers: {
          'Content-Type': 'application/json',
          // 'ngrok-skip-browser-warning': 'true',  // ← Add this header
        },
      });

      const data = await response.json();
      serverRef.current = data.credentials;
    } catch (err) {
      console.error("Failed to fetch server credentials:", err);
    }
  }

  useEffect(() => {
    fetchServerCredentials();

    console.log("Setting up WebSocket connection");
    wsRef.current = new WebSocket(`ws://${API_BASE}/ws`);

    wsRef.current.onopen = () => {
      console.log("WebSocket connected, sending", command, "for room", roomId);
      wsRef.current.send(JSON.stringify({
        type: command,
        roomId: roomId
      }));
    };

    wsRef.current.onmessage = async (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "room-not-found":
          alert("Room not found. Please check the Meeting ID.");
          navigate("/");
          break;

        case "room-already-exists":
          alert("Room already exists. Please use a different Meeting ID.");
          navigate("/");
          break;

        case "peer-joined":
          await sendOffer(data.peerId);
          break;

        case "start-success" :
        case "join-success" :
          console.log("Received user ID from server:", data.peerId);
          setUserId(data.peerId);
          break;

        case "offer":
          await handleOffer(data.from, data.payload);
          break;

        case "answer": {
          console.log("Received answer from:", data.from);
          const pc = pcRef.current.get(data.from);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.payload));
          }
          break;
        }

        case "ice": {
          console.log("Received ICE candidate from:", data.from);
          const peerConnection = pcRef.current.get(data.from);
          if (peerConnection) {
            try {
              await peerConnection.addIceCandidate(new RTCIceCandidate(data.payload));
            } catch (err) {
              console.error("Error adding ICE candidate:", err);
            }
          }
          break;
        }

        case "peer-left":
          console.log("Peer left:", data.peerId);
          removePeer(data.peerId);
          break;
      }
    };

    wsRef.current.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    wsRef.current.onclose = () => {
      console.log("WebSocket closed");
    };

    const ws = wsRef.current;
    const pcs = pcRef.current;

    return () => {
      console.log("Cleaning up WebSocket and peer connections");
      if (ws) {
        ws.close();
      }
      
      pcs.forEach(pc => pc.close());
      pcs.clear();
    };
  }, []); // Added dependencies

  useEffect(() => {
    const initMedia = async () => {
      const rawStream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });

      if (localVideoRef.current) 
        localVideoRef.current.srcObject = rawStream;

      // store rawStream in a ref for later
      rawStreamRef.current = rawStream;
    };

    initMedia();
  }, []);


  const fetchWatermarkConfig = async () => {
    try {
      const res = await fetch( `/api/watermark/config?sessionId=${roomId}&userId=${userId}`, {
        method: "GET",
        headers: {
          'Content-Type': 'application/json',
          // 'ngrok-skip-browser-warning': 'true',  // ← Add this header
        }
      });

      const data = await res.json();
      console.log("Fetched watermark config:", data);
      return data;
    } catch (err) {
      console.error("Failed to fetch watermark config:", err);

      // fallback (important)
      return {
        seed: 42,
        alpha: 0.005,
        frameSize: 256
      };
    }
  };

  useEffect(() => {
    if (!userId) return;  // guard

    let localStream = null; // for cleanup
    let audioContext = null;

    const applyWatermark = async () => {
      try{
        const config = await fetchWatermarkConfig();
        const { stream: processedStream, audioContext: ctx } = await createProcessedStream(rawStreamRef.current, config);
        localStream = processedStream; // save for cleanup
        audioContext = ctx;

        // 4️⃣ Save GainNode in ref
        gainNodeRef.current = processedStream._gainNode;

        // 5️⃣ Assign to video element
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = processedStream;
        }

        // 6️⃣ Extract tracks
        const audioTrack = processedStream.getAudioTracks()[0] || null;
        const videoTrack = processedStream.getVideoTracks()[0] || null;

        // 7️⃣ Audio track handling
        if (audioTrack) {
          audioTrack.enabled = isAudioEnabled;

          audioTrack.onmute = () => setIsAudioEnabled(false);
          audioTrack.onunmute = () => setIsAudioEnabled(true);
          audioTrack.onended = () => {
            setIsAudioEnabled(false);
            console.warn("Audio track ended");
          };
        }

        // 8️⃣ Video track handling
        if (videoTrack) {
          videoTrack.enabled = isVideoEnabled;

          videoTrack.onmute = () => setIsVideoEnabled(false);
          videoTrack.onunmute = () => setIsVideoEnabled(true);
          videoTrack.onended = () => {
            setIsVideoEnabled(false);
            console.warn("Video track ended");
          };
        }

        // 9️⃣ Replace tracks in all RTCPeerConnections
        pcRef.current.forEach(pc => {
          pc.getSenders().forEach(sender => {
            if (sender.track?.kind === "audio" && audioTrack) {
              sender.replaceTrack(audioTrack);
            }
            if (sender.track?.kind === "video" && videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          });
        });
      } catch (err) {
        console.error("Error applying watermark:", err);
      }
    };

    applyWatermark();

    //  🔟 Cleanup function on component unmount
    return () => {
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (audioContext) {
        audioContext.close();
      }
    };
  }, [userId]); // fires when userId is set after WS handshake

  
  // Show max 5 remote participants (when more than 6 total)
  const visiblePeers = peers.length > 5 ? peers.slice(0, 5) : peers;
  const hiddenPeersCount = peers.length > 5 ? peers.length - 5 : 0;

  return (
    <div className="room-container">
      <div className="room-header">
        <div className="room-info">
          <h2 className="room-title">Meeting Room</h2>
          <div className="room-id-container">
            <span className="room-id">ID: {roomId}</span>
            <button 
              className="copy-id-btn"
              onClick={copyMeetingId}
              title="Copy meeting ID"
            >
              {copied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="participants-count">
          <span className="participant-icon"></span>
          <span>{peers.length + 1} Participant{peers.length !== 0 ? 's' : ''}</span>
        </div>
      </div>

      <div className="videos-container" data-participant-count={Math.min(peers.length + 1, 6)}>
        {/* Local video */}
        <div className="video-wrapper local-video-wrapper">
          <video 
            ref={localVideoRef} 
            autoPlay 
            muted 
            playsInline 
            className="video"
          />
          {!isVideoEnabled && (
            <div className="video-overlay">Camera is off</div>
          )}
          <div className="video-label">You</div>
        </div>

        {/* Remote videos */}
        {visiblePeers.map(pid => (
          <div key={pid} className="video-wrapper remote-video-wrapper">
            <video
              autoPlay
              playsInline
              className="video"
              ref={el => {
                if (el) el.srcObject = remoteVideosRef.current.get(pid);
              }}
            />
            <div className="video-label">Participant</div>
          </div>
        ))}

        {/* Hidden participants indicator */}
        {hiddenPeersCount > 0 && (
          <div className="hidden-participants">
            +{hiddenPeersCount} more participant{hiddenPeersCount > 1 ? 's' : ''}
          </div>
        )}
      </div>

      <div className="controls-bar">
        <button 
          className={`btn-control ${!isAudioEnabled ? 'disabled' : ''}`}
          onClick={() => toggleAudio(localVideoRef.current?.srcObject, gainNodeRef)} // Pass gainNodeRef
          title={isAudioEnabled ? "Mute microphone" : "Unmute microphone"}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
            {!isAudioEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
          </svg>
        </button>

        <button 
          className={`btn-control ${!isVideoEnabled ? 'disabled' : ''}`}
          onClick={() => toggleVideo(localVideoRef.current?.srcObject)}
          title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"></polygon>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            {!isVideoEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
          </svg>
        </button>

        <button 
          className="btn-control"
          onClick={() => {/* File upload functionality will be added later */}}
          title="Upload file"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </button>

        <button 
          className="btn-leave"
          onClick={leaveRoom}
          title="Leave call"
        >
          <svg 
            width="24" 
            height="24" 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            <path d="M21 15.46l-5.27-1.61a1 1 0 0 0-1 .27l-2.2 2.2a15.05 15.05 0 0 1-6.32-6.32l2.2-2.2a1 1 0 0 0 .27-1L8.54 3a1 1 0 0 0-1-.7H3a1 1 0 0 0-1 1 19 19 0 0 0 19 19 1 1 0 0 0 1-1v-4.54a1 1 0 0 0-.7-1z"/>
          </svg>
        </button>
      </div>
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
    }).isRequired,
    toggleAudio: PropTypes.func.isRequired,
    toggleVideo: PropTypes.func.isRequired
  }).isRequired
};

export default MeetingRoom;
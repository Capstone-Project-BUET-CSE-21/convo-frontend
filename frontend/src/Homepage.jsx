import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import "./Homepage.css"; // Import your CSS file

const Homepage = ({ localStream, command, setCommand }) => {
    const [isEnteringMeetingId, setIsEnteringMeetingId] = useState(false);
    const [meetingId, setMeetingId] = useState("");
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [copied, setCopied] = useState(false);

    const localVideoRef = useRef(null);
    const navigate = useNavigate();

    const generateMeetingId = () => {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    };

    const startMeeting = () => {
        const newMeetingId = generateMeetingId();
        setMeetingId(newMeetingId);
        setCommand("Start");
        setIsEnteringMeetingId(true);
    };

    const joinMeeting = () => {
        setCommand("Join");
        setIsEnteringMeetingId(true);
    };

    const goBack = () => {
        setIsEnteringMeetingId(false);
        setMeetingId("");
        setCommand("");
        setCopied(false);
    };

    const copyMeetingId = async () => {
        try {
            await navigator.clipboard.writeText(meetingId);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy meeting ID:", err);
        }
    };

    const handleJoinOrStart = () => {
        if (meetingId.trim()) {
            navigate(`room/${meetingId}`);
        }
    };

    useEffect(() => {
        if (!localStream) return;
        localVideoRef.current.srcObject = localStream;
    }, [localVideoRef, localStream]);

    const toggleAudio = () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsAudioEnabled(audioTrack.enabled);
            }
        }
    };

    const toggleVideo = () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsVideoEnabled(videoTrack.enabled);
            }
        }
    };

    return (
        <div className="homepage-container">
            <div className="video-container">
                <video 
                    ref={localVideoRef} 
                    autoPlay 
                    muted 
                    className="local-video"
                />
                {!isVideoEnabled && (
                    <div className="video-overlay">
                        Camera is off
                    </div>
                )}

                
                {/* Media controls */}
                <div className="media-controls">
                    <button 
                        className={`btn-control ${!isAudioEnabled ? 'disabled' : ''}`}
                        onClick={toggleAudio}
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
                        onClick={toggleVideo}
                        title={isVideoEnabled ? "Turn off camera" : "Turn on camera"}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                            {!isVideoEnabled && <line x1="1" y1="1" x2="23" y2="23"></line>}
                        </svg>
                    </button>
                </div>
            </div>

            {!isEnteringMeetingId ? (
                <div className="card">
                    <div className="welcome-text">
                        <div className="welcome-line">Welcome to</div>
                        <div className="app-name">Convay Mini</div>
                    </div>

                    <img 
                        src="convay_logo.png" 
                        alt="Convay Mini Logo" 
                        className="card-logo"
                    />
                    <button 
                        className="btn btn-primary"
                        onClick={startMeeting}
                    >
                        Start a meeting
                    </button>
                    <button 
                        className="btn btn-primary"
                        onClick={joinMeeting}
                    >
                        Join a meeting
                    </button>
                </div>
            ) : (
                <div className="card">
                    {/* Back button */}
                    <button 
                        className="btn-back"
                        onClick={goBack}
                        title="Go back"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                        <span style={{ marginLeft: '8px' }}></span>
                    </button>

                    {command === "Start" ? (
                        <>
                            <div className="meeting-id-display">
                                <span className="meeting-id-label">Meeting ID</span>
                                <span className="meeting-id-value">{meetingId}</span>
                            </div>
                            <button 
                                className="btn btn-copy"
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
                                <span style={{ marginLeft: '6px' }}>{copied ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button 
                                className="btn btn-primary"
                                onClick={handleJoinOrStart}
                            >
                                Start
                            </button>
                        </>
                    ) : (
                        <>
                            <input 
                                type="text" 
                                placeholder="Enter Meeting ID" 
                                value={meetingId} 
                                onChange={(e) => setMeetingId(e.target.value)}
                                className="meeting-input"
                            />
                            <button 
                                className="btn btn-primary"
                                onClick={handleJoinOrStart}
                            >
                                Join
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

Homepage.propTypes = {
    localStream: PropTypes.object.isRequired,
    command: PropTypes.string.isRequired,
    setCommand: PropTypes.func.isRequired
};

export default Homepage;
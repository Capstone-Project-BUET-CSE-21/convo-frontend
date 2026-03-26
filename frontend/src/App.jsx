import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import MeetingRoom from './MeetingRoom'
import Homepage from './Homepage'
import { createProcessedStream } from './audio/audioWorkletSetup'

const App = () => {
  const [localStream, setLocalStream] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("");

  // In App.jsx, temporarily add this after setLocalStream(processedStream):
useEffect(() => {
  const fetchLocalMedia = async () => {
    const rawStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    const processedStream = await createProcessedStream(rawStream);
    setLocalStream(processedStream);

    // TEMPORARY: expose for console testing, remove after testing
    // window.__processedStream = processedStream;
    // window.__gainNode = processedStream._gainNode;
  };
  fetchLocalMedia();
}, []);
  // Toggle audio via GainNode (controls volume inside the pipeline)
  const toggleAudio = () => {
    if (localStream) {
      const newEnabled = !isAudioEnabled;
      if (localStream._gainNode) {
        // Mute/unmute at pipeline level — before worklet processes it
        localStream._gainNode.gain.value = newEnabled ? 1 : 0;
      } else {
        // Fallback if gainNode not available
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = newEnabled;
      }
      setIsAudioEnabled(newEnabled);
    }
  };

  // Video toggle stays the same — video doesn't go through AudioWorklet
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const homepageAttributes = {
    localStream,
    commandPair: { command, setCommand },
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
    toggleAudio,
    toggleVideo
  };

  const meetingRoomAttributes = {
    localStream,
    command: command.toLowerCase(),
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
    toggleAudio,
    toggleVideo
  };

  return (
    <>
      <Routes>
        <Route path="" element={<Homepage homepageAttributes={homepageAttributes} />} />
        <Route path="room/:roomId" element={<MeetingRoom meetingRoomAttributes={meetingRoomAttributes} />} />
      </Routes>
    </>
  )
}

export default App
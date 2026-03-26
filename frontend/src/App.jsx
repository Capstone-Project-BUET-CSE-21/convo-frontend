import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import MeetingRoom from './MeetingRoom'
import Homepage from './Homepage'
import WatermarkTestPage from './WatermarkTestPage'

const App = () => {
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("");

  // In App.jsx, temporarily add this after setLocalStream(processedStream):
  

  // Toggle audio via GainNode (controls volume inside the pipeline)
  const toggleAudio = (localStream, gainNodeRef = null) => {
    if (localStream) {
      const newEnabled = !isAudioEnabled;

      if (gainNodeRef && gainNodeRef.current) {
        // Safe: mutating the ref, not React state
        gainNodeRef.current.gain.value = newEnabled ? 1 : 0;
      } else {
        // fallback
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = newEnabled;
      }

      setIsAudioEnabled(newEnabled);
    }
  };

  // Video toggle stays the same — video doesn't go through AudioWorklet
  const toggleVideo = (localStream) => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !isVideoEnabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const homepageAttributes = {
    commandPair: { command, setCommand },
    isAudioEnabled: isAudioEnabled,
    isVideoEnabled: isVideoEnabled,
    toggleAudio,
    toggleVideo
  };

  const meetingRoomAttributes = {
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
        <Route path="watermark-test" element={<WatermarkTestPage />} />
      </Routes>
    </>
  )
}

export default App
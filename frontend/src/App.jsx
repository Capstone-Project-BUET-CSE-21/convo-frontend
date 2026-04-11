import { useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import MeetingRoom from './screens/MeetingRoom'
import Homepage from './screens/Homepage'
// import WatermarkTestPage from './screens/WatermarkTestPage'

const App = () => {
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("");

  const homepageAttributes = {
    commandPair: { command, setCommand },
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
  };

  const meetingRoomAttributes = {
    command: command.toLowerCase(),
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
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
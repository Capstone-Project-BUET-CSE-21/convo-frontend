import { useEffect, useState} from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import MeetingRoom from './MeetingRoom'
import Homepage from './Homepage'

const App = () => {
  const [localStream, setLocalStream] = useState(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("");

  useEffect(() => {
    const fetchLocalMedia = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
    };

    fetchLocalMedia();
  }, []);

  const homepageAttributes = {
    localStream,
    commandPair: { command, setCommand },
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled }
  };

  const meetingRoomAttributes = {
    localStream,
    command: command.toLowerCase(),
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled }
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

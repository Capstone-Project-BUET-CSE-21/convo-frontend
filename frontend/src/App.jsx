import { useEffect, useState} from 'react'
import { Routes, Route } from 'react-router-dom'
import './App.css'
import SingleRoom from './SingleRoom'
import Homepage from './Homepage'

const API_BASE = import.meta.env.VITE_API_BASE_MONA

const App = () => {
  const [localStream, setLocalStream] = useState(null);

  useEffect(() => {
    const fetchLocalMedia = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
    }

    fetchLocalMedia();
  }, []);

  return (
    <>
      <Routes>
        <Route path="" element={<Homepage localStream={localStream} />} />
        <Route path="room/:roomId" element={<SingleRoom localStream={localStream} />} />
      </Routes>
    </>
  )
}

export default App

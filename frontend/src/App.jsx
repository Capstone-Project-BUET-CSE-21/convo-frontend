import { useEffect, useState } from 'react'
import { Navigate, Routes, Route, useNavigate } from 'react-router-dom'
import './App.css'
import MeetingRoom from './screens/MeetingRoom'
import Homepage from './screens/Homepage'
import AuthPage from './screens/AuthPage'
import WatermarkTestPage from './screens/WatermarkTestPage'
import PipelineTestPage from './screens/PipelineTestPage'
import FileSharingTestPage from './screens/FileSharingTestPage'
import { clearAuthSession, getAuthToken, getAuthUser, saveAuthSession } from './auth/authSession'
import CryptoUnitTestPage from './crypto/CryptoUnitTestPage'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
import { ensureUserHasKeys } from './crypto/keypair';

const App = () => {
  const navigate = useNavigate();
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("Join");
  const [authUser, setAuthUser] = useState(getAuthUser());
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();

    if (!token) {
      setAuthUser(null);
      setIsAuthLoading(false);
      return;
    }

    const bootstrapSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw new Error('Session expired');
          }

          throw new Error('Session temporarily unavailable');
        }

        const profile = await response.json();
        saveAuthSession({ token, user: profile });
        await ensureUserHasKeys(profile.id);
        setAuthUser(profile);
      } catch (error) {
        if (error?.message === 'Session expired') {
          clearAuthSession();
          setAuthUser(null);
        }
      } finally {
        setIsAuthLoading(false);
      }
    };

    bootstrapSession();
  }, []);

  const handleLogout = () => {
    clearAuthSession();
    setAuthUser(null);
    setCommand("Join");
    setIsAudioEnabled(true);
    setIsVideoEnabled(true);
    navigate('/auth', { replace: true });
  };

  const homepageAttributes = {
    authUser,
    commandPair: { command, setCommand },
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
    handleLogout
  };

  const meetingRoomAttributes = {
    authUser,
    command: command.toLowerCase(),
    isAudioEnabledPair: { isAudioEnabled, setIsAudioEnabled },
    isVideoEnabledPair: { isVideoEnabled, setIsVideoEnabled },
  };

  if (isAuthLoading) {
    return null;
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to={authUser ? '/home' : '/auth'} replace />} />
        <Route path="/auth" element={authUser ? <Navigate to="/home" replace /> : <AuthPage onAuthSuccess={setAuthUser} />} />
        <Route path="/home" element={authUser ? <Homepage homepageAttributes={homepageAttributes} /> : <Navigate to="/auth" replace />} />
        <Route path="/room/:roomId" element={authUser ? <MeetingRoom meetingRoomAttributes={meetingRoomAttributes} /> : <Navigate to="/auth" replace />} />
        <Route path="/watermark-test" element={authUser ? <WatermarkTestPage /> : <Navigate to="/auth" replace />} />
        <Route path="/pipeline-test" element={authUser ? <PipelineTestPage /> : <Navigate to="/auth" replace />} />
        <Route path="/file-sharing-test" element={authUser ? <FileSharingTestPage /> : <Navigate to="/auth" replace />} />

        <Route path="/crypto-test" element={<CryptoUnitTestPage />} />
      </Routes>
    </>
  )
}

export default App
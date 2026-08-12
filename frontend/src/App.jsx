import { useEffect, useState } from 'react'
import { Navigate, Routes, Route, useNavigate } from 'react-router-dom'
import './App.css'
import MeetingRoom from './screens/MeetingRoom'
import Homepage from './screens/Homepage'
import AuthPage from './screens/AuthPage'
import WatermarkTestPage from './screens/WatermarkTestPage'
// import PipelineTestPage from './screens/PipelineTestPage'
import FileSharingTestPage from './screens/FileSharingTestPage'
import { clearAuthSession, getAuthToken, getAuthUser, saveAuthSession } from './auth/authSession'
// import CryptoUnitTestPage from './crypto/CryptoUnitTestPage'
import { BACKEND_URL } from './config/apiConfig'
import { ensureUserHasKeys } from './crypto/keypair';

const App = () => {
  const navigate = useNavigate();
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [command, setCommand] = useState("Join");
  const [authUser, setAuthUser] = useState(getAuthUser());
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  // Set when this browser was freshly provisioned as a new device on an account
  // that already had keys elsewhere (see ensureUserHasKeys). Non-blocking — the
  // device works normally; this is just a "new device added" awareness notice.
  const [newDeviceNotice, setNewDeviceNotice] = useState(false);

  useEffect(() => {
    const token = getAuthToken();

    if (!token) {
      setAuthUser(null);
      setIsAuthLoading(false);
      return;
    }

    const bootstrapSession = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/auth/me`, {
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
        const keyStatus = await ensureUserHasKeys(profile.id);
        setNewDeviceNotice(keyStatus?.status === 'new-device');
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
      {newDeviceNotice && (
        <div role="status" style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 16px', background: '#1f5f4a', color: '#fff',
          fontSize: '14px', lineHeight: 1.4,
        }}>
          <span style={{ flex: 1 }}>
            This browser has been set up as a new device on your account. You can
            send and receive files from here as usual. If this wasn&apos;t you,
            change your password.
          </span>
          <button
            type="button"
            onClick={() => setNewDeviceNotice(false)}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.6)',
              color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <Routes>
        <Route path="/" element={<Navigate to={authUser ? '/home' : '/auth'} replace />} />
        <Route path="/auth" element={authUser ? <Navigate to="/home" replace /> : <AuthPage onAuthSuccess={setAuthUser} onNewDevice={() => setNewDeviceNotice(true)} />} />
        <Route path="/home" element={authUser ? <Homepage homepageAttributes={homepageAttributes} /> : <Navigate to="/auth" replace />} />
        <Route path="/room/:roomId" element={authUser ? <MeetingRoom meetingRoomAttributes={meetingRoomAttributes} /> : <Navigate to="/auth" replace />} />
        <Route path="/watermark-test" element={<WatermarkTestPage/>} />
        {/* <Route path="/pipeline-test" element={authUser ? <PipelineTestPage /> : <Navigate to="/auth" replace />} /> */}
        <Route path="/file-sharing-test" element={authUser ? <FileSharingTestPage /> : <Navigate to="/auth" replace />} />
        {/* <Route path="/crypto-test" element={authUser ? <FileSharingTestPage /> : <CryptoUnitTestPage />} /> */}
      </Routes>
    </>
  )
}

export default App
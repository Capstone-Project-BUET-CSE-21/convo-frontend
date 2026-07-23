import PropTypes from "prop-types";
import { useRef } from "react";
import { useParams } from "react-router-dom";
import "./MeetingRoom.css";
import MeetingChat from "../components/MeetingChat";
import MeetingRoomScene from "../meeting/room/MeetingRoomScene";
import MeetingRoomToolbar from "../meeting/room/MeetingRoomToolbar";
import useMeetingRoomSession from "../meeting/useMeetingRoomSession";

const MeetingRoom = ({ meetingRoomAttributes }) => {
    const { authUser, command, isAudioEnabledPair, isVideoEnabledPair } = meetingRoomAttributes;
    const { isAudioEnabled, setIsAudioEnabled } = isAudioEnabledPair;
    const { isVideoEnabled, setIsVideoEnabled } = isVideoEnabledPair;

    const { roomId } = useParams();
    const localVideoRef = useRef(null);
    const remoteVideosRef = useRef(new Map());

    const {
        peers,
        peerNames,
        copied,
        copiedLink,
        isChatOpen,
        hasUnreadChat,
        chatMessages,
        localVideoRef: sessionLocalVideoRef,
        remoteVideosRef: sessionRemoteVideosRef,
        playbackAudioRef,
        isRecording,
        hasRecording,
        toggleRecording,
        downloadRecording,
        copyMeetingId,
        copyMeetingLink,
        toggleAudio,
        toggleVideo,
        leaveRoom,
        setIsChatOpen,
        handleSendChat,
        setHasUnreadChat,
        dataChannelsRef,
        wsRef,
    } = useMeetingRoomSession({
        roomId,
        command,
        authUser,
        isAudioEnabled,
        isVideoEnabled,
        setIsAudioEnabled,
        setIsVideoEnabled,
        localVideoRef,
        remoteVideosRef,
    });

    return (
        <div className="meeting-room">
            <audio ref={playbackAudioRef} autoPlay hidden />

            <header className="meeting-header">
                <div className="meeting-header__room-info">
                    <span className="meeting-header__room-label">Room ID:</span>
                    <span className="meeting-header__room-id">{roomId}</span>
                </div>

                <div className="meeting-header__actions">
                    <button
                        className={`meeting-header__copy-btn ${copied ? "meeting-header__copy-btn--success" : ""}`}
                        onClick={copyMeetingId}
                        aria-label="Copy Meeting ID"
                    >
                        {copied ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        )}
                        <span>{copied ? "Copied" : "Copy ID"}</span>
                    </button>

                    <button
                        className={`meeting-header__copy-btn ${copiedLink ? "meeting-header__copy-btn--success" : ""}`}
                        onClick={copyMeetingLink}
                        aria-label="Copy Meeting Link"
                    >
                        {copiedLink ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                            </svg>
                        )}
                        <span>{copiedLink ? "Copied" : "Copy Link"}</span>
                    </button>
                </div>
            </header>

            <MeetingRoomScene
                authUser={authUser}
                peers={peers}
                peerNames={peerNames}
                isAudioEnabled={isAudioEnabled}
                isVideoEnabled={isVideoEnabled}
                localVideoRef={sessionLocalVideoRef}
                remoteVideosRef={sessionRemoteVideosRef}
            />

            <MeetingRoomToolbar
                isAudioEnabled={isAudioEnabled}
                isVideoEnabled={isVideoEnabled}
                isRecording={isRecording}
                hasRecording={hasRecording}
                isChatOpen={isChatOpen}
                hasUnreadChat={hasUnreadChat}
                onToggleAudio={toggleAudio}
                onToggleVideo={toggleVideo}
                onToggleRecording={toggleRecording}
                onDownloadRecording={downloadRecording}
                onToggleChat={() => setIsChatOpen((prev) => !prev)}
                onLeaveRoom={leaveRoom}
            />

            <MeetingChat
                isOpen={isChatOpen}
                onClose={() => setIsChatOpen(false)}
                wsRef={wsRef}
                dataChannelsRef={dataChannelsRef}
                roomId={roomId}
                peers={peers}
                peerNames={peerNames}
                currentUser={{ id: authUser.id, displayName: authUser.displayName }}
                chatMessages={chatMessages}
                onSend={handleSendChat}
                onUnreadChange={setHasUnreadChat}
            />
        </div>
    );
};

MeetingRoom.propTypes = {
    meetingRoomAttributes: PropTypes.shape({
        authUser: PropTypes.object.isRequired,
        command: PropTypes.string.isRequired,
        isAudioEnabledPair: PropTypes.shape({
            isAudioEnabled: PropTypes.bool.isRequired,
            setIsAudioEnabled: PropTypes.func.isRequired,
        }).isRequired,
        isVideoEnabledPair: PropTypes.shape({
            isVideoEnabled: PropTypes.bool.isRequired,
            setIsVideoEnabled: PropTypes.func.isRequired,
        }).isRequired,
    }).isRequired,
};

export default MeetingRoom;
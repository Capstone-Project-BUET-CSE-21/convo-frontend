import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import "./MeetingChat.css";
import ChatFileShare from "./ChatFileShare";
import ChatFileBubble from "./ChatFileBubble";

const EVERYONE = "__everyone__";

const MeetingChat = ({ isOpen, onClose, wsRef, dataChannelsRef, roomId, peers, peerNames, currentUser, chatMessages, onSend, onUnreadChange }) => {
  const [activeThread, setActiveThread] = useState(EVERYONE);
  const [activeView, setActiveView] = useState("chat");
  const [draft, setDraft] = useState("");
  const [readUpTo, setReadUpTo] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Mark thread as read ───────────────────────────────────────────────────

  const markRead = (threadId) => {
    const latest = chatMessages
      .filter(m => !m.isMine && (
        threadId === EVERYONE ? m.to === EVERYONE : m.from === threadId
      ))
      .at(-1)?.time ?? 0;

    setReadUpTo(prev => ({ ...prev, [threadId]: Math.max(prev[threadId] ?? 0, latest) }));
  };

  // ── Unread check across ALL threads (everyone + every peer DM) ───────────

  const isThreadUnread = (threadId, watermarks) => {
    const watermark = watermarks[threadId] ?? 0;
    return chatMessages.some((m) => {
      if (m.isMine) return false;
      if (m.time <= watermark) return false;
      if (threadId === EVERYONE) return m.to === EVERYONE;
      return m.from === threadId && m.to === currentUser.id;
    });
  };

  // ── Report "any unread" up to parent whenever messages or watermarks change ──

  useEffect(() => {
    if (!onUnreadChange) return;
    const threadIds = [EVERYONE, ...peers];
    const anyUnread = threadIds.some((id) => isThreadUnread(id, readUpTo));
    onUnreadChange(anyUnread);
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  }, [chatMessages, readUpTo, peers]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeThread]);

  // ── Focus input when panel opens ─────────────────────────────────────────

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen, activeThread]);

  // ── Mark thread as read ───────────────────────────────────────────────────
  // Triggered when switching threads (click handlers below) and whenever
  // new messages arrive for the open thread while the panel is visible.
  // This is the "subscribe to an external system and react to its updates"
  // case React's docs call out as a valid use of setState-in-effect, so we
  // suppress the lint rule here rather than work around it artificially.

  useEffect(() => {
    if (isOpen) markRead(activeThread);
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [chatMessages, activeThread, isOpen]);

  // ── Send ─────────────────────────────────────────────────────────────────

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;

    const msg = {
      type: "chat",
      roomId,
      from: currentUser.id,
      fromName: currentUser.displayName,
      to: activeThread,
      text,
      time: Date.now(),
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }

    onSend(msg);
    setDraft("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ── Derived: unread counts ───────────────────────────────────────────────

  const unreadCount = (threadId) => {
    const watermark = readUpTo[threadId] ?? 0;
    return chatMessages.filter((m) => {
      if (m.isMine) return false;
      if (m.time <= watermark) return false;
      if (threadId === EVERYONE) return m.to === EVERYONE;
      return m.from === threadId && m.to === currentUser.id;
    }).length;
  };

  // ── Derived: visible messages ────────────────────────────────────────────

  const visibleMessages = chatMessages.filter((m) => {
    if (activeThread === EVERYONE) return m.to === EVERYONE;
    if (m.isMine) return m.to === activeThread;
    return m.from === activeThread && m.to === currentUser.id;
  });

  const visibleChatMessages = visibleMessages.filter((m) => m.type !== "file");
  const visibleMediaMessages = visibleMessages.filter((m) => m.type === "file");

  // ── Thread display name ───────────────────────────────────────────────────

  const threadLabel = (threadId) => {
    if (threadId === EVERYONE) return "Everyone";
    return peerNames.get(threadId) || "Guest";
  };

  const activeLabel = threadLabel(activeThread);
  const showEveryone = peers.length > 0;
  const activeMessages = activeView === "media" ? visibleMediaMessages : visibleChatMessages;

  // ── Render ───────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  return (
    <aside className="chat-panel" role="complementary" aria-label="Meeting chat">

      {/* Header */}
      <div className="chat-panel__header">
        <span className="chat-panel__title">Chat</span>
        <button className="chat-panel__close" onClick={onClose} aria-label="Close chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="chat-panel__body">

        {/* Thread sidebar */}
        <nav className="chat-threads" aria-label="Chat threads">
          {showEveryone && (
            <button
              className={`chat-thread ${activeThread === EVERYONE ? "chat-thread--active" : ""}`}
              onClick={() => { setActiveThread(EVERYONE); markRead(EVERYONE); }}
            >
              <span className="chat-thread__avatar chat-thread__avatar--everyone">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </span>
              <span className="chat-thread__name">Everyone</span>
              {unreadCount(EVERYONE) > 0 && (
                <span className="chat-thread__badge">{unreadCount(EVERYONE)}</span>
              )}
            </button>
          )}

          {peers.map((peerId) => {
            const name = peerNames.get(peerId) || "Guest";
            const initials = name.trim().split(/\s+/).map(p => p[0].toUpperCase()).join("").slice(0, 2);
            const count = unreadCount(peerId);
            return (
              <button
                key={peerId}
                className={`chat-thread ${activeThread === peerId ? "chat-thread--active" : ""}`}
                onClick={() => { setActiveThread(peerId); markRead(peerId); }}
              >
                <span className="chat-thread__avatar">{initials}</span>
                <span className="chat-thread__name">{name}</span>
                {count > 0 && <span className="chat-thread__badge">{count}</span>}
              </button>
            );
          })}

          {peers.length === 0 && (
            <p className="chat-threads__empty">Waiting for others to join…</p>
          )}
        </nav>

        {/* Message pane */}
        <div className="chat-messages" aria-label={`Messages with ${activeLabel}`}>

          <div className="chat-messages__label">
            {activeThread === EVERYONE ? "Message everyone" : `Direct message · ${activeLabel}`}
          </div>

          <div className="chat-view-switch" role="tablist" aria-label="Chat and media views">
            <button
              type="button"
              className={`chat-view-switch__tab ${activeView === "chat" ? "chat-view-switch__tab--active" : ""}`}
              onClick={() => setActiveView("chat")}
              role="tab"
              aria-selected={activeView === "chat"}
            >
              Chats <span className="chat-view-switch__count">{visibleChatMessages.length}</span>
            </button>
            <button
              type="button"
              className={`chat-view-switch__tab ${activeView === "media" ? "chat-view-switch__tab--active" : ""}`}
              onClick={() => setActiveView("media")}
              role="tab"
              aria-selected={activeView === "media"}
            >
              Media <span className="chat-view-switch__count">{visibleMediaMessages.length}</span>
            </button>
          </div>

          <div className="chat-messages__list">
            {activeMessages.length === 0 ? (
              <p className="chat-messages__empty">
                {activeView === "media" ? "No shared media yet." : "No messages yet."}
              </p>
            ) : (
              activeMessages.map((m) => (
                <div
                  key={m.id}
                  className={`chat-bubble ${m.isMine ? "chat-bubble--mine" : "chat-bubble--theirs"}`}
                >
                  {!m.isMine && (
                    <span className="chat-bubble__sender">{m.fromName || "Guest"}</span>
                  )}

                  {m.type === "file" ? (
                    <div className="chat-media-card">
                      <ChatFileBubble
                        fileUrl={m.fileUrl}
                        fileName={m.fileName}
                        fileType={m.fileType}
                        fileSize={m.fileSize}
                      />
                      <div className="chat-media-card__meta">
                        <span className="chat-media-card__name">{m.fileName}</span>
                        <span className="chat-media-card__detail">
                          {m.fromName || "Guest"} · {new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-bubble__text">{m.text}</div>
                  )}

                  <span className="chat-bubble__time">
                    {new Date(m.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="chat-input-row">
            <ChatFileShare
              roomId={roomId}
              currentUser={currentUser}
              activeThread={activeThread}
              peers={peers}
              peerNames={peerNames}
              dataChannelsRef={dataChannelsRef}
              onFileSent={(msg) => onSend(msg)}
            />

            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              placeholder={`Message ${activeLabel}…`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Type a message"
            />
            <button
              className="chat-send-btn"
              onClick={sendMessage}
              disabled={!draft.trim()}
              aria-label="Send message"
            >
              <img src="/send.png" alt="Send" width="16" height="16" />
            </button>
          </div>
        </div>

      </div>
    </aside>
  );
};

MeetingChat.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  wsRef: PropTypes.shape({ current: PropTypes.object }).isRequired,
  dataChannelsRef: PropTypes.shape({ current: PropTypes.object }).isRequired,
  roomId: PropTypes.string.isRequired,
  peers: PropTypes.arrayOf(PropTypes.string).isRequired,
  peerNames: PropTypes.instanceOf(Map).isRequired,
  currentUser: PropTypes.shape({
    id: PropTypes.string.isRequired,
    displayName: PropTypes.string.isRequired,
  }).isRequired,
  chatMessages: PropTypes.array.isRequired,
  onSend: PropTypes.func.isRequired,
  onUnreadChange: PropTypes.func,
};

export default MeetingChat;
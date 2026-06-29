import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import "./MeetingChat.css";

const EVERYONE = "__everyone__";

const MeetingChat = ({ isOpen, onClose, wsRef, roomId, peers, peerNames, currentUser, chatMessages, onSend }) => {
  const [activeThread, setActiveThread] = useState(EVERYONE);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeThread]);

  // ── Focus input when panel opens ─────────────────────────────────────────

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isOpen, activeThread]);

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

    onSend(msg); // optimistic append via parent
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
    return chatMessages.filter((m) => {
      if (m.isMine) return false;
      if (threadId === EVERYONE) return m.to === EVERYONE && activeThread !== EVERYONE;
      return m.from === threadId && m.to === currentUser.id && activeThread !== threadId;
    }).length;
  };

  // ── Derived: visible messages ────────────────────────────────────────────

  const visibleMessages = chatMessages.filter((m) => {
    if (activeThread === EVERYONE) return m.to === EVERYONE;
    if (m.isMine) return m.to === activeThread;
    return m.from === activeThread && m.to === currentUser.id;
  });

  // ── Thread display name ───────────────────────────────────────────────────

  const threadLabel = (threadId) => {
    if (threadId === EVERYONE) return "Everyone";
    return peerNames.get(threadId) || "Guest";
  };

  const activeLabel = threadLabel(activeThread);
  const showEveryone = peers.length > 0;

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
              onClick={() => setActiveThread(EVERYONE)}
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
                onClick={() => setActiveThread(peerId)}
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

          <div className="chat-messages__list">
            {visibleMessages.length === 0 ? (
              <p className="chat-messages__empty">No messages yet. Say hi 👋</p>
            ) : (
              visibleMessages.map((m) => (
                <div
                  key={m.id}
                  className={`chat-bubble ${m.isMine ? "chat-bubble--mine" : "chat-bubble--theirs"}`}
                >
                  {!m.isMine && (
                    <span className="chat-bubble__sender">{m.fromName || "Guest"}</span>
                  )}
                  <div className="chat-bubble__text">{m.text}</div>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
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
  roomId: PropTypes.string.isRequired,
  peers: PropTypes.arrayOf(PropTypes.string).isRequired,
  peerNames: PropTypes.instanceOf(Map).isRequired,
  currentUser: PropTypes.shape({
    id: PropTypes.string.isRequired,
    displayName: PropTypes.string.isRequired,
  }).isRequired,
  chatMessages: PropTypes.array.isRequired,
  onSend: PropTypes.func.isRequired,
};

export default MeetingChat;
// 5.2 — Identity mapping.
//
// Convo doesn't have a separate "user profile" microservice yet — the
// meeting already resolves peerId -> display name locally via signaling
// (see peerNames in screens/MeetingRoom.jsx, populated from the join/
// signal payloads). That map IS the existing lookup source referenced in
// manual §5.2 Task 1. If a name isn't in it yet (e.g. it arrived slightly
// after the file did), we fall back to the fromName carried in the
// transfer's own metadata, then finally to a generic label.

const RELATIVE_UNITS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

// 5.2 Task 3: turn an ISO timestamp into a short relative string, e.g. "2m ago".
export const formatRelativeTime = (timestamp) => {
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) return "";

  const diffSeconds = Math.round((Date.now() - then) / 1000);
  if (diffSeconds < 45) return "just now";

  for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
    const value = Math.floor(diffSeconds / secondsInUnit);
    if (value >= 1) {
      return `${value} ${unit}${value > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
};

// 5.2 Task 1: senderId -> human-readable name.
export const resolveSenderName = (senderId, { peerNames, fallbackName } = {}) => {
  return peerNames?.get?.(senderId) || fallbackName || "Unknown sender";
};

// 5.2 Task 3: the readable line for the transfer timeline, e.g.
// "Sent 2m ago by Fariha in Team Standup". sessionName is optional —
// Convo currently identifies sessions by roomId, so callers typically pass
// that (or a friendlier room label if one exists) as sessionName.
export const formatTransferTimelineLabel = ({ senderName, sessionName, timestamp }) => {
  const when = formatRelativeTime(timestamp);
  const where = sessionName ? ` in ${sessionName}` : "";
  return `Sent ${when} by ${senderName}${where}`;
};
// Records a download event against convo-file-sharing's
// POST /api/sessions/{sessionId}/downloads (see FileDownloadController),
// mirroring fetchSessionParticipants in identity/traceVerification.js —
// same authHeaders() pattern, same "caller supplies baseUrl" shape.
//
// Fire-and-forget by design: the caller (ChatFileBubble's download button)
// must not have the user's actual file save blocked or delayed by this
// network call, so this always resolves/rejects independently of the save.

import { authHeaders } from "../auth/authFetch";

/**
 * @param {object} params
 * @param {string} params.sessionId the meeting/session the download happened in
 * @param {string} params.userId    the downloading user's id (must match the caller's own JWT identity — see FileDownloadService)
 * @param {string} params.contentHash the content hash of the file being downloaded
 * @param {string} params.baseUrl   confidentiality service base URL
 */
export const recordFileDownload = async ({ sessionId, userId, contentHash, baseUrl }) => {
  const res = await fetch(`${baseUrl}/api/sessions/${sessionId}/downloads`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ userId, contentHash }),
  });
  if (!res.ok) {
    throw new Error(`Recording download failed: ${res.status}`);
  }
  return res.json();
};

/**
 * GET /api/downloads/{contentHash} — every recorded download event for a
 * given file, oldest first (see FileDownloadController.listDownloads).
 * Used by the Downloads tab of screens/FileSharingTestPage.jsx to verify a
 * recorded download actually shows up; nothing in the real meeting UI
 * reads this back yet.
 *
 * @param {string} contentHash
 * @param {string} baseUrl confidentiality service base URL
 */
export const fetchDownloadHistory = async (contentHash, baseUrl) => {
  const res = await fetch(`${baseUrl}/api/downloads/${contentHash}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Fetching download history failed: ${res.status}`);
  }
  return res.json();
};

// REST calls the meeting room session makes at join time. Kept as plain async
// functions (no React state) so they're trivially testable and reusable; the
// hook owns where the results land.

import { getAuthToken } from "../auth/authSession";
import { BACKEND_URL, WATERMARK_URL } from "../config/apiConfig";

// Registers this user's entry into the meeting (creates/records the row the
// lifecycle service tracks). Throws on non-2xx so the caller can surface it.
export const makeMeetingEntry = async ({ command, roomId }) => {
  const token = getAuthToken();
  const response = await fetch(`${BACKEND_URL}/api/backend/meeting-entry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ command, roomId }),
  });

  if (!response.ok) {
    throw new Error(`Meeting entry request failed: ${response.status}`);
  }
};

// Fetches the ICE server credentials (STUN/TURN) used for peer connections.
// Returns the credentials array; throws on non-2xx.
export const fetchServerCredentials = async () => {
  const token = getAuthToken();
  const response = await fetch(`${BACKEND_URL}/api/backend/credentials`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Credentials request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.credentials;
};

// Fetches this user's per-room audio watermark configuration.
export const fetchWatermarkConfig = async ({ roomId, userId }) => {
  const res = await fetch(
    `${WATERMARK_URL}/api/watermark/config?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}`,
    { method: "GET" }
  );
  if (!res.ok) {
    throw new Error(`Watermark config request failed: ${res.status}`);
  }
  return res.json();
};

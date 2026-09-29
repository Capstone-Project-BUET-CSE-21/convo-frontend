// REST calls the meeting room session makes at join time. Kept as plain async
// functions (no React state) so they're trivially testable and reusable; the
// hook owns where the results land.

import { authHeaders } from "../auth/authFetch";
import { BACKEND_URL, WATERMARK_URL } from "../config/apiConfig";

// Registers this user's entry into the meeting (creates/records the row the
// lifecycle service tracks). Throws on non-2xx so the caller can surface it.
export const makeMeetingEntry = async ({ command, roomId }) => {
  const response = await fetch(`${BACKEND_URL}/api/backend/meeting-entry`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ command, roomId }),
  });

  if (!response.ok) {
    throw new Error(`Meeting entry request failed: ${response.status}`);
  }
};

// Fetches the ICE server credentials (STUN/TURN) used for peer connections.
// Returns the credentials array; throws on non-2xx.
export const fetchServerCredentials = async () => {
  const response = await fetch(`${BACKEND_URL}/api/backend/credentials`, {
    method: "GET",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Credentials request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.credentials;
};

// Fetches this user's per-room audio watermark configuration, reporting the
// sample rate the embedder will run at so detection can match it. The
// watermark service identifies the user from the bearer token; userId is
// still sent only because older deployments of that service require it.
export const fetchWatermarkConfig = async ({ roomId, userId, sampleRate }) => {
  const res = await fetch(
    `${WATERMARK_URL}/api/audio-watermark/config?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}&sampleRate=${encodeURIComponent(Math.round(sampleRate))}`,
    {
      method: "GET",
      headers: authHeaders(),
    }
  );
  if (!res.ok) {
    throw new Error(`Watermark config request failed: ${res.status}`);
  }
  return res.json();
};

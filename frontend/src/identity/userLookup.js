// Cross-user display-name resolution — backs FileTraceScreen's "which two
// people shared this" requirement.
//
// senderIdentity.js's resolveSenderName only ever had one name source:
// peerNames, populated from live meeting signaling (see MeetingRoom.jsx).
// That works for hops from a meeting the viewer personally sat in, but a
// chain can span meetings the viewer was never part of — those hops fell
// back to "Unknown sender" / a truncated UUID with no way to fix it.
//
// This calls convo-backend's GET /api/users/{id} and POST /api/users/batch
// (UserController) to resolve any senderId to its real display_name,
// regardless of whether the viewer ever shared a meeting with that sender.

import { authHeaders } from "../auth/authFetch";
import { BACKEND_URL } from "../config/apiConfig";

const stripTrailingSlash = (url) => url.replace(/\/+$/, "");

// Resolves many ids in one round trip. Silently omits ids the backend
// couldn't resolve (deleted/unknown user) rather than failing the whole
// batch — callers should already have a fallback label for a missing id.
export const fetchUserDisplayNames = async (userIds, baseUrl = BACKEND_URL) => {
  const uniqueIds = [...new Set((userIds ?? []).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const res = await fetch(`${stripTrailingSlash(baseUrl)}/api/users/batch`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ids: uniqueIds }),
  });

  if (!res.ok) {
    throw new Error(`User lookup failed: ${res.status} ${res.statusText}`);
  }

  const rows = await res.json();
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.id && row?.displayName)
      .map((row) => [row.id, row.displayName])
  );
};

// Single-id convenience wrapper, for call sites that only need one name
// (e.g. ProvenanceBadge's live single-hop receipt) and don't want to build
// a one-element array at the call site.
export const fetchUserDisplayName = async (userId, baseUrl = BACKEND_URL) => {
  if (!userId) return null;
  const names = await fetchUserDisplayNames([userId], baseUrl);
  return names.get(userId) ?? null;
};
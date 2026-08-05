import { getAuthToken } from "./authSession";

// The confidentiality service now requires every request to carry the same
// bearer token convo-backend issues (see JwtAuthenticationFilter on that
// service) — it verifies the "uid" claim server-side instead of trusting
// whatever userId/senderId a request body claims.
export const authHeaders = (extra = {}) => {
  const token = getAuthToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
};

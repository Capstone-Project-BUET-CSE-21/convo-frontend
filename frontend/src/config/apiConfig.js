// Environment-derived configuration for the meeting room session. Centralised
// here so the session hook and its helper modules share one source of truth.

export const WS_URL = import.meta.env.VITE_WS_BASE_URL;
export const BACKEND_URL = import.meta.env.VITE_API_BASE_URL;
export const WATERMARK_URL = import.meta.env.VITE_WATERMARK_API_URL;
export const CONFIDENTIALITY_CHAIN_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;



import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import "./FileSharingTestPage.css";

import { computeContentHash } from "../crypto/hashing";
import { fetchChainHistory } from "../pipeline/chainReconstruct";
import FileTraceScreen from "./FileTraceScreen";
import { CONFIDENTIALITY_CHAIN_URL, BACKEND_URL } from "../config/apiConfig";
import { fetchDownloadHistory } from "../identity/fileDownloadTracking";
import { fetchUserDisplayNames } from "../identity/userLookup";

// Two real, backend-backed lookups for a file you actually have a copy of —
// no fabricated identities, no simulated hops, no new records created by
// this page:
//
// SHARE CHAIN tab — hashes the uploaded file and asks the backend for any
// real share/forward history recorded under that hash (GET
// /api/transfer/metadata/history/{contentHash}), then traces it via
// FileTraceScreen, the same trace/lineage component the real app uses.
//
// DOWNLOADS tab — hashes the uploaded file and asks the backend for every
// real download event recorded under that hash (GET
// /api/downloads/{contentHash}) — the same rows components/ChatFileBubble.jsx's
// real Download button creates via recordFileDownload. Pure lookup, same
// shape as the Share Chain tab: upload a file you already downloaded
// through Convo, see who's on record as having downloaded it and when.
//
// If nothing comes back in either tab, that just means this exact file
// content has no matching record yet — this page never invents one.

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="fst-arrow">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const Row = ({ label, value }) => (
  <div className="fst-row">
    <span className="fst-row-label">{label}</span>
    <span className="fst-row-value">{value}</span>
  </div>
);
Row.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.node };

const FileSharingTestPage = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [mode, setMode] = useState("share"); // "share" | "downloads"
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Share-chain tab state
  const [notFound, setNotFound] = useState(false);
  const [chain, setChain] = useState(null); // { contentHash, startFileHash, hopCount }

  // Downloads tab state
  const [downloadHash, setDownloadHash] = useState(null);
  const [downloads, setDownloads] = useState(null);
  // userId -> display name, resolved after a lookup — same approach as
  // FileTraceScreen's resolvedNames, since download rows only carry raw
  // userIds (identity/fileDownloadTracking.js's DownloadRecordDto has no
  // name field).
  const [downloaderNames, setDownloaderNames] = useState(new Map());

  const resetResults = () => {
    setError(null);
    setNotFound(false);
    setChain(null);
    setDownloadHash(null);
    setDownloads(null);
    setDownloaderNames(new Map());
  };

  const selectFile = (f) => {
    setFile(f);
    resetResults();
  };

  const selectMode = (next) => {
    setMode(next);
    resetResults();
  };

  const runTrace = async () => {
    if (!file) return;
    setLoading(true);
    resetResults();

    try {
      const fileBuffer = await file.arrayBuffer();
      const contentHash = await computeContentHash(fileBuffer);

      // findByContentHashOrderByTimestampAsc on the server (see
      // pipeline/chainReconstruct.js's fetchChainHistory) — entries come
      // back oldest first, so the last element is the most recent real
      // share/forward of this exact file content.
      const entries = await fetchChainHistory(contentHash, CONFIDENTIALITY_CHAIN_URL);

      if (!entries || entries.length === 0) {
        setNotFound(true);
        return;
      }

      const latest = entries[entries.length - 1];
      setChain({
        contentHash,
        startFileHash: latest.fileHash,
        hopCount: entries.length,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const checkDownloads = async () => {
    if (!file) return;
    setLoading(true);
    resetResults();

    try {
      const fileBuffer = await file.arrayBuffer();
      const hash = await computeContentHash(fileBuffer);
      setDownloadHash(hash);

      const history = await fetchDownloadHistory(hash, CONFIDENTIALITY_CHAIN_URL);
      setDownloads(history);

      // Best-effort: a failed name lookup shouldn't hide the download
      // records themselves — rows just fall back to a truncated id.
      const userIds = (history ?? []).map((d) => d.userId).filter(Boolean);
      if (userIds.length > 0) {
        try {
          const names = await fetchUserDisplayNames(userIds, BACKEND_URL);
          setDownloaderNames(names);
        } catch (err) {
          console.error("Resolving downloader names failed:", err);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fst-page">
      <div className="fst-header">
        <button className="fst-back" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <div className="fst-brand">
          <img src="/convo-logo-1.png" alt="Convo" className="fst-brand-logo" />
          <span className="fst-brand-name">Convo</span>
        </div>
      </div>

      <main className="fst-card">
        <div className="fst-card-header">
          <h1 className="fst-title">File Sharing &amp; Trace Test</h1>
          <p className="fst-subtitle">
            {mode === "share"
              ? "Upload a file you actually sent or received through Convo. This looks up its real transfer history — the real users and real sessions it actually passed through — and traces the chain back to its original share."
              : "Upload a file you downloaded through Convo. This looks up every real download event recorded for that exact file — who downloaded it, and when."}
          </p>
        </div>

        <div className="fst-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "share"}
            className={`fst-tab ${mode === "share" ? "fst-tab--active" : ""}`}
            onClick={() => selectMode("share")}
          >
            Share Chain
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "downloads"}
            className={`fst-tab ${mode === "downloads" ? "fst-tab--active" : ""}`}
            onClick={() => selectMode("downloads")}
          >
            Downloads
          </button>
        </div>

        <div className="fst-fields">
          <div className="fst-field">
            <label className="fst-label">File</label>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => selectFile(e.target.files[0] || null)}
            />
            <button className="fst-file-btn" onClick={() => fileRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {file ? file.name : "Choose a file"}
            </button>
          </div>
        </div>

        <button
          className="fst-btn"
          onClick={mode === "share" ? runTrace : checkDownloads}
          disabled={loading || !file}
        >
          {loading
            ? "Checking…"
            : (mode === "share" ? "Trace this file's history" : "Check download history")}
          {!loading && <ArrowIcon />}
        </button>

        {error && (
          <div className="fst-result failed">
            <div className="fst-result-title">❌ Request failed</div>
            <p className="fst-result-error">{error}</p>
          </div>
        )}

        {mode === "share" && notFound && !error && (
          <div className="fst-result">
            <div className="fst-result-title">No history found</div>
            <p className="fst-result-error" style={{ color: "var(--ink-muted, #6b6a7a)" }}>
              This exact file content has no record in Convo&apos;s file-sharing history yet.
              Share or forward it through a real meeting first, then trace it here.
            </p>
          </div>
        )}

        {mode === "share" && chain && (
          <div className="fst-chain-summary">
            <div className="fst-divider" />
            <div className="fst-scores-label">Real history found</div>
            <Row label="Hops on record" value={chain.hopCount} />
            <Row label="Content hash" value={`${chain.contentHash.slice(0, 16)}…`} />

            <div className="fst-divider" />
            <FileTraceScreen
              contentHash={chain.contentHash}
              startFileHash={chain.startFileHash}
            />
          </div>
        )}

        {mode === "downloads" && downloadHash && !error && (
          <div className="fst-chain-summary">
            <div className="fst-divider" />
            <Row label="Content hash" value={`${downloadHash.slice(0, 16)}…`} />

            <div className="fst-divider" />
            <div className="fst-scores-label">Recorded downloads for this file</div>
            {downloads && downloads.length > 0 ? (
              downloads.map((d) => (
                <div key={d.id} className="fst-download-entry">
                  <Row
                    label="Downloaded by"
                    value={downloaderNames.get(d.userId) || `User ${String(d.userId).slice(0, 8)}`}
                  />
                  <Row label="Session" value={d.sessionId} />
                  <Row label="At" value={new Date(d.downloadedAt).toLocaleString()} />
                </div>
              ))
            ) : (
              <p className="fst-empty">
                No download events recorded for this file yet. Download it through a
                real meeting&apos;s chat first, then check here.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default FileSharingTestPage;

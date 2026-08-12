import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import "./FileSharingTestPage.css";

import { computeContentHash } from "../crypto/hashing";
import { fetchChainHistory } from "../pipeline/chainReconstruct";
import FileTraceScreen from "./FileTraceScreen";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

// Real trace lookup for a file that was actually shared/forwarded through
// real meetings (real users, real senderIds, real sessions) — as opposed to
// this page's old behaviour of fabricating a brand-new fake two-hop chain
// under random senderIds on every run.
//
// That fabrication is gone. This page now:
//   1. hashes the uploaded file the same way real transfers do
//      (computeContentHash — content bytes only, so it matches regardless
//      of which real transfer produced this exact file)
//   2. asks the backend for any real history recorded under that hash
//      (GET /api/transfer/metadata/history/{contentHash} — a read, no
//      identity/ownership check, so it works for any authenticated caller
//      tracing a file they legitimately have a copy of)
//   3. hands the most recent real entry to FileTraceScreen, the same
//      trace/lineage component used before — but now without fabricated
//      peerNames, so it resolves real display names via
//      identity/userLookup.fetchUserDisplayNames instead of always
//      showing "User A (original sender)" / "User B (forwarded it)".
//
// If nothing comes back, that just means this exact file content has never
// been shared through Convo's real file-sharing flow — there's no history
// to trace, and this page no longer invents one to fill the gap.

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

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [chain, setChain] = useState(null); // { contentHash, startFileHash, hopCount }

  const runTrace = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setChain(null);

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
            Upload a file you actually sent or received through Convo. This looks up its
            real transfer history — the real users and real sessions it actually passed
            through — and traces the chain back to its original share.
          </p>
        </div>

        <div className="fst-fields">
          <div className="fst-field">
            <label className="fst-label">File</label>
            <input
              ref={fileRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files[0] || null)}
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

        <button className="fst-btn" onClick={runTrace} disabled={loading || !file}>
          {loading ? "Tracing…" : "Trace this file's history"}
          {!loading && <ArrowIcon />}
        </button>

        {error && (
          <div className="fst-result failed">
            <div className="fst-result-title">❌ Request failed</div>
            <p className="fst-result-error">{error}</p>
          </div>
        )}

        {notFound && !error && (
          <div className="fst-result">
            <div className="fst-result-title">No history found</div>
            <p className="fst-result-error" style={{ color: "var(--ink-muted, #6b6a7a)" }}>
              This exact file content has no record in Convo&apos;s file-sharing history yet.
              Share or forward it through a real meeting first, then trace it here.
            </p>
          </div>
        )}

        {chain && (
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
      </main>
    </div>
  );
};

export default FileSharingTestPage;

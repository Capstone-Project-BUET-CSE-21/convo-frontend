import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PropTypes from "prop-types";
import "./FileSharingTestPage.css";

import { generateAndStoreKeypair } from "../crypto/keypair";
import { computeFileHash, computeContentHash } from "../crypto/hashing";
import { signBlock } from "../crypto/signing";
import { authHeaders } from "../auth/authFetch";
import FileTraceScreen from "./FileTraceScreen";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

// This exercises the real backend + real frontend modules end to end —
// nothing here is mocked the way PipelineTestPage.jsx's
// contentHash: "some-content-hash" stub was:
//   1. registers two real ECDSA keypairs (Anisa's 2.2/2.4)
//   2. shares the uploaded file as "User A" in Session 1 (root of chain)
//   3. forwards the SAME file content as "User B" in Session 2,
//      previousHash pointing at User A's fileHash
//   4. optionally registers User B as an authorized participant of
//      Session 2 (session_participants) — skip this to see the
//      "unauthorized hop" flag actually fire
//   5. renders FileTraceScreen — the real trace/lineage component — against
//      the live GET /api/transfer/metadata/history/{contentHash} endpoint
//
// KNOWN LIMITATION: the confidentiality service now requires every
// register-key/create-metadata/attach-hash/add-participant call to come
// from the same authenticated user it's claiming to act as (senderId/
// userId must match the caller's JWT "uid"). This harness fabricates a
// fresh random senderId per simulated "user" per run, which can never
// match the one real logged-in tester's token — so shareOrForward() and
// registerParticipant() will now get 403s from the real backend. Attaching
// the current session's token (below) is still correct/harmless, but
// simulating multiple distinct senders this way is no longer possible
// without a redesign of this harness (e.g. driving it from multiple real
// logged-in sessions instead of synthesizing identities).

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

// One user's full share/forward step: register key -> POST metadata ->
// hash + contentHash -> sign -> PATCH.
async function shareOrForward({ file, fileBuffer, sessionId, previousHash }) {
  const senderId = crypto.randomUUID();
  const { privateKey, publicKeyBase64 } = await generateAndStoreKeypair(senderId);

  const keyRes = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/keys`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ userId: senderId, publicKey: publicKeyBase64, algorithm: "ECDSA-P256" }),
  });
  if (!keyRes.ok) throw new Error(`Key registration failed: ${keyRes.status}`);

  const metaRes = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/transfer/metadata`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      sessionId,
      senderId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      previousHash: previousHash ?? null,
    }),
  });
  if (!metaRes.ok) throw new Error(`Metadata request failed: ${metaRes.status}`);
  const metadata = await metaRes.json();

  const fileHash = await computeFileHash(fileBuffer, metadata);
  const contentHash = await computeContentHash(fileBuffer);
  const signature = await signBlock(fileHash, metadata, privateKey);

  const patchRes = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/transfer/metadata/${metadata.transferId}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ fileHash, signature, contentHash }),
  });
  if (!patchRes.ok) throw new Error(`Attaching hash/signature failed: ${patchRes.status}`);

  return { senderId, sessionId, fileHash, contentHash, transferId: metadata.transferId };
}

async function registerParticipant(sessionId, userId) {
  const res = await fetch(`${CONFIDENTIALITY_CHAIN_URL}/api/sessions/${sessionId}/participants`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`Registering participant failed: ${res.status}`);
  return res.json();
}

const FileSharingTestPage = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [file, setFile] = useState(null);
  const [authorizeForward, setAuthorizeForward] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [chain, setChain] = useState(null); // { contentHash, startFileHash, peerNames, sessions }

  const runSimulation = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setChain(null);

    try {
      const fileBuffer = await file.arrayBuffer();
      const sessionA = crypto.randomUUID();
      const sessionB = crypto.randomUUID();

      const hopA = await shareOrForward({ file, fileBuffer, sessionId: sessionA, previousHash: null });
      const hopB = await shareOrForward({
        file,
        fileBuffer,
        sessionId: sessionB,
        previousHash: hopA.fileHash,
      });

      if (authorizeForward) {
        await registerParticipant(sessionB, hopB.senderId);
      }
      // User A is always registered as a participant of their own session
      // so the root hop shows as authorized regardless of the checkbox.
      await registerParticipant(sessionA, hopA.senderId);

      const peerNames = new Map([
        [hopA.senderId, "User A (original sender)"],
        [hopB.senderId, "User B (forwarded it)"],
      ]);

      setChain({
        contentHash: hopA.contentHash,
        startFileHash: hopB.fileHash,
        peerNames,
        sessions: [
          { label: "Session 1 (origin)", id: sessionA, senderId: hopA.senderId },
          { label: "Session 2 (forward)", id: sessionB, senderId: hopB.senderId },
        ],
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
            Upload a file. This simulates it being shared by one user and then forwarded by a
            second user into a different session, then traces the real chain history back
            through every user it passed through.
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

          <label className="fst-checkbox">
            <input
              type="checkbox"
              checked={authorizeForward}
              onChange={(e) => setAuthorizeForward(e.target.checked)}
            />
            Register User B as an authorized participant of Session 2
            <span className="fst-checkbox-hint">
              (uncheck to see the &quot;unauthorized hop&quot; flag fire instead)
            </span>
          </label>
        </div>

        <button className="fst-btn" onClick={runSimulation} disabled={loading || !file}>
          {loading ? "Running…" : "Share, forward, and trace"}
          {!loading && <ArrowIcon />}
        </button>

        {error && (
          <div className="fst-result failed">
            <div className="fst-result-title">❌ Request failed</div>
            <p className="fst-result-error">{error}</p>
          </div>
        )}

        {chain && (
          <div className="fst-chain-summary">
            <div className="fst-divider" />
            <div className="fst-scores-label">Simulated hops</div>
            {chain.sessions.map((s) => (
              <div key={s.id} className="fst-row">
                <span className="fst-row-label">{s.label}</span>
                <span className="fst-row-value">{s.id.slice(0, 8)}…</span>
              </div>
            ))}
            <Row label="Content hash" value={`${chain.contentHash.slice(0, 16)}…`} />

            <div className="fst-divider" />
            <FileTraceScreen
              contentHash={chain.contentHash}
              startFileHash={chain.startFileHash}
              peerNames={chain.peerNames}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default FileSharingTestPage;

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import "./FileTraceScreen.css";

import { traceChain } from "../pipeline/chainReconstruct";
import { makeVerifyHop, makeIsAuthorizedHop } from "../identity/traceVerification";
import { formatRelativeTime } from "../identity/senderIdentity";

const CONFIDENTIALITY_API_BASE_URL = import.meta.env.VITE_CONFIDENTIALITY_CHAIN_API_URL;

// 5.3 — The trace/lineage screen: meeting-by-meeting, person-by-person,
// with "chain broken here" and "unauthorized person here" rendered as
// visually distinct states (matching Suchi's walkChain stopReason split
// and Debashri's REJECTION_COPY additions in ProvenanceBadge).
//
// @param {string} contentHash   content hash of the file being traced
// @param {string} startFileHash fileHash of the hop the user opened this from
// @param {Map}    [peerNames]   peerId -> display name, if the caller has one handy
const FileTraceScreen = ({ contentHash, startFileHash, peerNames }) => {
  const [state, setState] = useState({ status: "loading", hops: [], stopReason: null, error: null });

  const verifyHop = useMemo(() => makeVerifyHop(contentHash), [contentHash]);
  const isAuthorizedHop = useMemo(() => makeIsAuthorizedHop(CONFIDENTIALITY_API_BASE_URL), []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState({ status: "loading", hops: [], stopReason: null, error: null });
      try {
        const { hops, stopReason } = await traceChain(
          contentHash,
          startFileHash,
          CONFIDENTIALITY_API_BASE_URL,
          { verifyHop, isAuthorizedHop }
        );
        if (!cancelled) {
          setState({ status: "done", hops, stopReason, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ status: "error", hops: [], stopReason: null, error: err.message });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contentHash, startFileHash, verifyHop, isAuthorizedHop]);

  const nameFor = (userId) => peerNames?.get?.(userId) || `User ${String(userId).slice(0, 8)}`;

  if (state.status === "loading") {
    return <div className="file-trace-screen file-trace-screen--loading">Tracing file history…</div>;
  }

  if (state.status === "error") {
    return (
      <div className="file-trace-screen file-trace-screen--error" role="alert">
        Couldn’t load this file’s history: {state.error}
      </div>
    );
  }

  // Walk order is most-recent-hop-first (walkChain follows previousHash
  // backwards); reverse so the timeline reads chronologically, oldest
  // (origin) meeting first.
  const chronologicalHops = [...state.hops].reverse();

  return (
    <div className="file-trace-screen">
      <h2 className="file-trace-screen__title">File history</h2>

      <ol className="file-trace-screen__timeline">
        {chronologicalHops.map((hop, idx) => {
          const entry = hop.entry;
          const isBroken = hop.status === "broken";
          const isUnauthorized = hop.status === "unauthorized";

          return (
            <li
              key={entry ? `${entry.sessionId}-${entry.transferId ?? idx}` : `broken-${idx}`}
              className={`file-trace-hop file-trace-hop--${hop.status}`}
            >
              {entry ? (
                <>
                  <div className="file-trace-hop__meeting">
                    Session {entry.sessionId}
                    {entry.originSessionId && entry.originSessionId !== entry.sessionId && (
                      <span className="file-trace-hop__origin-note">
                        {" "}
                        (originally signed in session {entry.originSessionId})
                      </span>
                    )}
                  </div>
                  <div className="file-trace-hop__person">
                    Shared by <strong>{nameFor(entry.senderId)}</strong>
                    {entry.timestamp && (
                      <span className="file-trace-hop__time"> · {formatRelativeTime(entry.timestamp)}</span>
                    )}
                  </div>
                  <div className="file-trace-hop__file">{entry.fileName}</div>
                </>
              ) : (
                <div className="file-trace-hop__meeting">Earlier hop</div>
              )}

              {isBroken && (
                <div className="file-trace-hop__flag file-trace-hop__flag--broken" role="alert">
                  ⚠ Chain broken here — {hop.reason === "missing-link"
                    ? "the previous link in the chain couldn't be found."
                    : "this hop failed verification (tampered or corrupted)."}
                </div>
              )}

              {isUnauthorized && (
                <div className="file-trace-hop__flag file-trace-hop__flag--unauthorized" role="alert">
                  ⚠ Unauthorized person here — {nameFor(entry?.senderId)} wasn’t a permitted
                  participant of that session when this file was shared.
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {state.stopReason === "root" && (
        <p className="file-trace-screen__footnote">Traced back to the file’s original share.</p>
      )}
    </div>
  );
};

FileTraceScreen.propTypes = {
  contentHash: PropTypes.string.isRequired,
  startFileHash: PropTypes.string.isRequired,
  peerNames: PropTypes.instanceOf(Map),
};

FileTraceScreen.defaultProps = {
  peerNames: null,
};

export default FileTraceScreen;

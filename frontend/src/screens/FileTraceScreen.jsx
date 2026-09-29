import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import "./FileTraceScreen.css";

import { buildSharePaths, fetchChainHistory } from "../pipeline/chainReconstruct";
import { makeVerifyHop } from "../identity/traceVerification";
import { formatRelativeTime } from "../identity/senderIdentity";
import { CONFIDENTIALITY_CHAIN_URL } from "../config/apiConfig";

// The file's full share history as paths of real hand-offs, e.g.
//   Charlie → Alice → Dave
//   Charlie → Bob
// Every share is re-verified (content hash + signature against the sender's
// key history); a share that fails is flagged on every path it appears in.
// Names come from convo-file-sharing's response (resolved server-side).
//
// A path started by someone other than whoever first brought the file into
// Convo gets a neutral note: that person had the file with no Convo record
// of receiving it. It's deliberately not a warning — they may well have got
// it legitimately by email or USB, and Convo can't tell.
//
// @param {string} contentHash content hash of the file being traced
const EMPTY = { status: "loading", paths: [], failures: new Map(), introducerId: null, error: null };

const FileTraceScreen = ({ contentHash }) => {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setState(EMPTY);
      try {
        const entries = await fetchChainHistory(contentHash, CONFIDENTIALITY_CHAIN_URL);
        const verifyHop = makeVerifyHop(contentHash);
        const results = await Promise.all(entries.map((entry) => verifyHop(entry)));
        const failures = new Map();
        entries.forEach((entry, i) => {
          if (!results[i].valid) failures.set(entry.fileHash, results[i].reason ?? "verification-failed");
        });

        const paths = buildSharePaths(entries)
          .sort((a, b) => new Date(a[0].share.timestamp) - new Date(b[0].share.timestamp));

        // History comes back oldest first, and the oldest share can't have
        // a parent, so its sender is whoever first brought the file in.
        const introducerId = entries[0]?.senderId ?? null;

        if (!cancelled) {
          setState({ status: "done", paths, failures, introducerId, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ ...EMPTY, status: "error", error: err.message });
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contentHash]);

  const nameOf = (userId, displayName) => displayName || `User ${String(userId).slice(0, 8)}`;
  const senderName = (share) => nameOf(share.senderId, share.senderDisplayName);
  const recipientName = (recipient) => (recipient ? nameOf(recipient.userId, recipient.displayName) : "—");

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

  return (
    <div className="file-trace-screen">
      <h2 className="file-trace-screen__title">File history</h2>

      <ol className="file-trace-screen__timeline">
        {state.paths.map((path) => {
          const route = [senderName(path[0].share), ...path.map((step) => recipientName(step.recipient))];
          const key = path.map((step) => `${step.share.fileHash}:${step.recipient?.userId}`).join("|");
          const noConvoRecord = path[0].share.senderId !== state.introducerId;

          return (
            <li key={key} className="file-trace-path">
              <div className="file-trace-path__route">{route.join(" → ")}</div>
              {noConvoRecord && (
                <div className="file-trace-path__note">
                  {senderName(path[0].share)} had this file with no Convo record of receiving it —
                  it may have come from outside Convo.
                </div>
              )}
              <ol className="file-trace-path__steps">
                {path.map((step) => {
                  const failure = state.failures.get(step.share.fileHash);
                  return (
                    <li
                      key={`${step.share.fileHash}:${step.recipient?.userId}`}
                      className={`file-trace-hop${failure ? " file-trace-hop--broken" : ""}`}
                    >
                      <div className="file-trace-hop__person">
                        <strong>{senderName(step.share)}</strong> shared with{" "}
                        <strong>{recipientName(step.recipient)}</strong>
                        {step.share.timestamp && (
                          <span className="file-trace-hop__time"> · {formatRelativeTime(step.share.timestamp)}</span>
                        )}
                      </div>
                      <div className="file-trace-hop__file">
                        Session {step.share.sessionId} · {step.share.fileName}
                      </div>
                      {failure && (
                        <div className="file-trace-hop__flag file-trace-hop__flag--broken" role="alert">
                          ⚠ This share failed verification (tampered or corrupted): {failure}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

FileTraceScreen.propTypes = {
  contentHash: PropTypes.string.isRequired,
};

export default FileTraceScreen;

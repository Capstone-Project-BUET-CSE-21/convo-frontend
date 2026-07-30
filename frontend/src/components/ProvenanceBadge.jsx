import PropTypes from "prop-types";
import "./ProvenanceBadge.css";
import { formatTransferTimelineLabel } from "../identity/senderIdentity";

// 5.2 Task 4: rejection copy, keyed by the reason codes produced by
// identity/verifyIncomingTransfer.js (single-hop, live-receipt path) and
// identity/traceVerification.js (multi-hop, trace-screen path — Suchi's
// walkChain stop conditions).
//
// "unauthorized-hop" is new: it's Suchi's second, separately-surfaced stop
// condition (chain intact, but the sender at that hop wasn't a permitted
// session participant) — must read as visually/copy-distinct from
// "chain-broken" (tampering), per the plan.
const REJECTION_COPY = {
  "hash-mismatch": "This file's contents don't match what the sender signed.",
  "chain-broken": "This file breaks the provenance chain for this session.",
  "invalid-signature": "The signature doesn't match the claimed sender.",
  "key-not-found": "The sender's public key couldn't be found.",
  "unauthorized-hop": "This file was shared by someone who wasn't an authorized participant at that point in its history.",
  "content-hash-mismatch": "This entry doesn't match the file being traced.",
};

// Data-mapping half of the provenance display lives in
// identity/verifyIncomingTransfer.js — this component is purely
// presentational (per manual §5.2 Task 2, coordinated with Anisa, who owns
// the surrounding visual container this renders inside of, ChatFileBubble.jsx).
const ProvenanceBadge = ({ senderName, sessionName, timestamp, verified, reason }) => {
  if (!verified) {
    // "unauthorized-hop" gets its own modifier class so the trace screen
    // and any badge reusing this component can style it distinctly from
    // outright tampering (amber/"needs review" vs. red/"broken"), matching
    // Suchi's broken-vs-unauthorized split.
    const isUnauthorized = reason === "unauthorized-hop";
    return (
      <div
        className={`provenance-badge ${
          isUnauthorized ? "provenance-badge--unauthorized" : "provenance-badge--tampered"
        }`}
        role="alert"
      >
        <span className="provenance-badge__icon" aria-hidden="true">
          {isUnauthorized ? "\u26A0" : "!"}
        </span>
        <span className="provenance-badge__text">
          Unverified file — {REJECTION_COPY[reason] || "its origin couldn't be confirmed."}
        </span>
      </div>
    );
  }

  const label = formatTransferTimelineLabel({ senderName, sessionName, timestamp });
  const fullTimestamp = timestamp ? new Date(timestamp).toLocaleString() : undefined;

  return (
    <div className="provenance-badge provenance-badge--verified" title={fullTimestamp}>
      <span className="provenance-badge__icon" aria-hidden="true">
        ✓
      </span>
      <span className="provenance-badge__text">{label}</span>
    </div>
  );
};

ProvenanceBadge.propTypes = {
  senderName: PropTypes.string,
  sessionName: PropTypes.string,
  timestamp: PropTypes.string,
  verified: PropTypes.bool.isRequired,
  reason: PropTypes.string,
};

ProvenanceBadge.defaultProps = {
  senderName: null,
  sessionName: null,
  timestamp: null,
  reason: null,
};

export default ProvenanceBadge;

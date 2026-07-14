import PropTypes from "prop-types";
import "./ProvenanceBadge.css";
import { formatTransferTimelineLabel } from "../identity/senderIdentity";

// 5.2 Task 4: rejection copy, keyed by the reason codes produced by
// identity/verifyIncomingTransfer.js (which in turn come from Debashri's
// hashVerify.js and Anisa's crypto/verify.js).
const REJECTION_COPY = {
  "hash-mismatch": "This file's contents don't match what the sender signed.",
  "chain-broken": "This file breaks the provenance chain for this session.",
  "invalid-signature": "The signature doesn't match the claimed sender.",
  "key-not-found": "The sender's public key couldn't be found.",
};

// Data-mapping half of the provenance display lives in
// identity/verifyIncomingTransfer.js — this component is purely
// presentational (per manual §5.2 Task 2, coordinated with Anisa, who owns
// the surrounding visual container this renders inside of, ChatFileBubble.jsx).
const ProvenanceBadge = ({ senderName, sessionName, timestamp, verified, reason }) => {
  if (!verified) {
    return (
      <div className="provenance-badge provenance-badge--tampered" role="alert">
        <span className="provenance-badge__icon" aria-hidden="true">
          !
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

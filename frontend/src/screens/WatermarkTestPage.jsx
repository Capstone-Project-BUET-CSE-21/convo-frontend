import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./WatermarkTestPage.css";
import PropTypes from "prop-types";

const WATERMARK_URL = import.meta.env.VITE_WATERMARK_API_URL;

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="wt-arrow">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const Row = ({ label, value, highlight }) => (
  <div className="wt-row">
    <span className="wt-row-label">{label}</span>
    <span className={`wt-row-value${highlight ? " wt-row-highlight" : ""}`}>{value}</span>
  </div>
);

Row.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  highlight: PropTypes.bool,
};

const WatermarkTestPage = () => {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [sessionId, setSessionId] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  async function runDetection() {
    if (!file || !sessionId.trim()) return;
    setLoading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("audio", file);
      formData.append("sessionId", sessionId.trim());

      const res = await fetch(`${WATERMARK_URL}/api/watermark/detect`, {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (!res.ok) {
        setResult({ ok: false, error: json.error || `Server error ${res.status}` });
      } else {
        setResult({ ok: true, ...json });
      }
    } catch (err) {
      setResult({ ok: false, error: `Network error: ${err.message}` });
    } finally {
      setLoading(false);
    }
  }

  const detected = result?.ok && result?.watermarkDetected;
  const statusClass = result
    ? result.ok ? (detected ? "passed" : "failed") : "failed"
    : "";

  return (
    <div className="wt-page">
      {/* Header */}
      <div className="wt-header">
        <button className="wt-back" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Back
        </button>
        <div className="wt-brand">
          <img src="/convo-logo-1.png" alt="Convo" className="wt-brand-logo" />
          <span className="wt-brand-name">Convo</span>
        </div>
      </div>

      {/* Card */}
      <main className="wt-card">
        <div className="wt-card-header">
          <h1 className="wt-title">Watermark Detection</h1>
          <p className="wt-subtitle">
            Upload a recorded audio file (WAV, MP3, AAC, M4A, or Opus) and enter the session ID to identify which participant has recorded the audio.
          </p>
        </div>

        {/* Inputs */}
        <div className="wt-fields">
          <div className="wt-field">
            <label className="wt-label">Meeting Room ID</label>
            <input
              className="wt-input"
              type="text"
              placeholder="e.g. abc123"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>

          <div className="wt-field">
            <label className="wt-label">Audio file</label>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files[0] || null)}
            />
            <button className="wt-file-btn" onClick={() => fileRef.current?.click()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
                strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {file ? file.name : "Choose audio file"}
            </button>
          </div>
        </div>

        <button
          className="wt-btn"
          onClick={runDetection}
          disabled={loading || !file || !sessionId.trim()}
        >
          {loading ? "Detecting…" : "Detect watermark"}
          {!loading && <ArrowIcon />}
        </button>

        {/* Result */}
        {result && (
          <div className={`wt-result ${statusClass}`}>
            {!result.ok ? (
              <>
                <div className="wt-result-title">❌ Request failed</div>
                <p className="wt-result-error">{result.error}</p>
              </>
            ) : (
              <>
                <div className="wt-result-title">
                  {detected ? "✅ Watermark detected" : "❌ No watermark detected"}
                </div>

                {detected && result.detectedUserDisplayName && (
                  <div className="wt-detected-name">
                    {result.detectedUserDisplayName}
                  </div>
                )}

                <div className="wt-divider" />

                <div className="wt-rows">
                  <Row label="Session" value={result.sessionId} />
                  <Row label="Correlation score" value={result.correlationScore} highlight />
                  <Row label="Frames analyzed" value={result.totalFramesAnalyzed} />
                  <Row label="Users checked" value={result.totalUsersChecked} />
                </div>

                {result.allUserScores && Object.keys(result.allUserScores).length > 0 && (
                  <>
                    <div className="wt-divider" />
                    <div className="wt-scores-label">All user scores</div>
                    <div className="wt-scores">
                      {Object.entries(result.allUserScores).map(([uid, score]) => {
                        const name = result.userDisplayNames?.[uid] || uid;
                        const isWinner = uid === result.detectedUser;
                        return (
                          <div key={uid} className={`wt-score-row${isWinner ? " winner" : ""}`}>
                            <span className="wt-score-name">
                              {isWinner && <span className="wt-winner-dot" />}
                              {name}
                            </span>
                            <span className="wt-score-val">{score}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {result.message && (
                  <p className="wt-message">{result.message}</p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default WatermarkTestPage;
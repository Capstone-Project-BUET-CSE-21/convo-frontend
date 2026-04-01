import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

// ─── Self-contained helpers — same logic as audio-worklet-processor.js ────────

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) + hash) + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function generatePN(seed, length) {
  const numericSeed = typeof seed === "string" ? hashString(seed) : (seed >>> 0);
  const rand = mulberry32(numericSeed);
  const pn = new Float32Array(length);
  for (let i = 0; i < length; i++) pn[i] = rand() * 2 - 1;
  return pn;
}

function correlate(frame, pn) {
  let c = 0;
  for (let i = 0; i < frame.length; i++) c += frame[i] * pn[i];
  return c;
}

function embedSilence(pn, alpha, frameSize) {
  const out = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    let s = alpha * pn[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    out[i] = s;
  }
  return out;
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE"); str(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const SEED = 42;
const ALPHA = 0.005;
const FRAME = 256;

const MOCK_BACKEND_RESPONSE = {
  seed: "A7F3K9",
  alpha: 0.02,
  frameSize: 256,
};

// ─────────────────────────────────────────────────────────────────────────────

export default function WatermarkTestPage() {
  const navigate = useNavigate();

  const [algoResult, setAlgoResult] = useState(null);

  const [recStatus, setRecStatus] = useState("idle");
  const [recError, setRecError] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const [wmUrl, setWmUrl] = useState(null);
  const [origUrl, setOrigUrl] = useState(null);
  const timerRef = useRef(null);
  const samplesRef = useRef([]);

  const [detection, setDetection] = useState(null);
  const fileRef = useRef(null);

  const [configResult, setConfigResult] = useState(null);
  const [configRunning, setConfigRunning] = useState(false);
  const [backendSessionId, setBackendSessionId] = useState("");
  const [backendFile, setBackendFile] = useState(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendResult, setBackendResult] = useState(null);
  const backendFileRef = useRef(null);

  // ─── TEST 1 ───────────────────────────────────────────────────────────────
  function runAlgoTest() {
    const pn = generatePN(SEED, FRAME);
    const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
    const threshold = ALPHA * FRAME * pnPower * 0.5;

    const silence = new Float32Array(FRAME);
    const watermarked = embedSilence(pn, ALPHA, FRAME);

    const origCorr = correlate(silence, pn);
    const wmCorr = correlate(watermarked, pn);
    const passed = Math.abs(origCorr) < threshold && wmCorr > threshold;

    setAlgoResult({
      origCorr: origCorr.toFixed(4),
      wmCorr: wmCorr.toFixed(4),
      threshold: threshold.toFixed(4),
      expected: (ALPHA * FRAME * pnPower).toFixed(4),
      passed,
    });
  }

  // ─── TEST 2 ───────────────────────────────────────────────────────────────
  async function startRecording() {
    // Reset state immediately so UI updates before any async work
    setRecStatus("recording");
    setRecError(null);
    setWmUrl(null);
    setOrigUrl(null);
    setCountdown(5);
    samplesRef.current = [];

    let micStream = null;
    let audioContext = null;
    let workletNode = null;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      const { default: createProcessedStream } =
        await import("./audio/audioWorkletSetup.js");

      const result = await Promise.race([
        createProcessedStream(micStream),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("createProcessedStream timed out — check DevTools console")),
            8000
          )
        ),
      ]);

      audioContext = result.audioContext;
      workletNode = result.workletNode;

      if (!workletNode) {
        throw new Error("workletNode missing from createProcessedStream return value — add it to the return object in audioWorkletSetup.js");
      }
    } catch (err) {
      console.error("[Test 2]", err);
      setRecError(err.message);
      setRecStatus("idle");
      micStream?.getTracks().forEach((t) => t.stop());
      return;
    }

    // ── Capture lossless WAV from worklet output ──────────────────────────
    const scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

    scriptNode.onaudioprocess = (e) => {
      samplesRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };

    // Connect to silent destination — NOT audioContext.destination (causes echo)
    const silentDest = audioContext.createMediaStreamDestination();
    workletNode.connect(scriptNode);
    scriptNode.connect(silentDest);

    // ── Record original mic for comparison ────────────────────────────────
    const origRecorder = new MediaRecorder(micStream);
    const origChunks = [];
    origRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) origChunks.push(e.data);
    };
    origRecorder.onstop = () =>
      setOrigUrl(
        URL.createObjectURL(new Blob(origChunks, { type: "audio/webm" }))
      );
    origRecorder.start(100);

    // ── Countdown ─────────────────────────────────────────────────────────
    let remaining = 5;

    timerRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);

      if (remaining <= 0) {
        clearInterval(timerRef.current);
        origRecorder.stop();
        scriptNode.disconnect();

        // Encode captured PCM as lossless WAV
        const all = samplesRef.current;
        const total = all.reduce((s, c) => s + c.length, 0);
        const pcm = new Float32Array(total);
        let offset = 0;
        for (const chunk of all) {
          pcm.set(chunk, offset);
          offset += chunk.length;
        }

        const wav = encodeWAV(pcm, audioContext.sampleRate);
        setWmUrl(URL.createObjectURL(wav));
        setRecStatus("done");

        audioContext.close();
        micStream.getTracks().forEach((t) => t.stop());
      }
    }, 1000);
  }

  // ─── TEST 3 ───────────────────────────────────────────────────────────────
  async function analyzeFile(file) {
    setDetection({ status: "analyzing" });

    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    ctx.close();

    const pn = generatePN(SEED, FRAME);
    const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
    const isWav = file.name.endsWith(".wav");
    const threshold = ALPHA * FRAME * pnPower * (isWav ? 0.5 : 0.1);

    const numFrames = Math.floor(data.length / FRAME);
    let detected = 0;
    const correlations = [];

    for (let i = 0; i < numFrames; i++) {
      const frame = data.slice(i * FRAME, (i + 1) * FRAME);
      const c = correlate(frame, pn);
      correlations.push(c);
      if (c > threshold) detected++;
    }

    const mean = correlations.reduce((s, v) => s + v, 0) / correlations.length;
    const rate = detected / numFrames;

    setDetection({
      status: "done",
      numFrames,
      detected,
      rate: (rate * 100).toFixed(1),
      mean: mean.toFixed(4),
      threshold: threshold.toFixed(4),
      expected: (ALPHA * FRAME * pnPower).toFixed(4),
      isWav,
      passed: rate > 0.5,
    });
  }

  // ─── TEST 4 ───────────────────────────────────────────────────────────────
  async function runConfigTest() {
    setConfigRunning(true);
    setConfigResult(null);

    try {
      // REAL — uncomment when backend is ready:
      // const res = await fetch(
      //   `/api/watermark/config?sessionId=test-session&userId=test-user`
      // );
      // if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      // const config = await res.json();

      // MOCK — remove once backend is ready:
      await new Promise((r) => setTimeout(r, 400));
      const config = { ...MOCK_BACKEND_RESPONSE };

      const { seed, alpha, frameSize } = config;

      if (seed === undefined || alpha === undefined || frameSize === undefined) {
        throw new Error(`Missing fields. Got: ${JSON.stringify(config)}`);
      }

      const pn = generatePN(seed, frameSize);
      const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
      const threshold = alpha * frameSize * pnPower * 0.5;

      const watermarked = embedSilence(pn, alpha, frameSize);
      const wmCorr = correlate(watermarked, pn);
      const passed = wmCorr > threshold;
      const seedIsDynamic = String(seed) !== String(SEED);

      setConfigResult({
        passed,
        isMocked: true,
        seed,
        alpha,
        frameSize,
        wmCorr: wmCorr.toFixed(4),
        threshold: threshold.toFixed(4),
        expected: (alpha * frameSize * pnPower).toFixed(4),
        seedIsDynamic,
        error: null,
      });
    } catch (err) {
      setConfigResult({
        passed: false,
        isMocked: true,
        seed: "—", alpha: "—", frameSize: "—",
        wmCorr: "—", threshold: "—", expected: "—",
        seedIsDynamic: false,
        error: err.message,
      });
    } finally {
      setConfigRunning(false);
    }
  }


  // ─── TEST 5 ───────────────────────────────────────────────────────────────
  async function runBackendDetection() {
    if (!backendFile || !backendSessionId.trim()) return;
    setBackendLoading(true);
    setBackendResult(null);

    try {
      const formData = new FormData();
      formData.append("audio", backendFile);
      formData.append("sessionId", backendSessionId.trim());

      const res = await fetch(`/api/watermark/detect`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setBackendResult({ error: json.error || `Server error ${res.status}` });
      } else {
        setBackendResult(json);
      }
    } catch (err) {
      setBackendResult({ error: `Network error: ${err.message}` });
    } finally {
      setBackendLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px", fontFamily: "monospace" }}>
      <button onClick={() => navigate("/")} style={{ marginBottom: 24, cursor: "pointer" }}>
        ← Back
      </button>

      <h1 style={{ fontSize: 22, marginBottom: 8 }}>🔊 Watermark Test</h1>
      <p style={{ color: "#888", marginBottom: 32, fontSize: 13 }}>
        seed={SEED} · α={ALPHA} · frameSize={FRAME}
      </p>

      {/* ── TEST 1 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 1 — Algorithm Check (no mic)</h2>
        <p style={descStyle}>
          Embeds watermark into a silence frame and checks correlation.
          No microphone needed. Verifies the core math is correct.
        </p>
        <button style={btnStyle} onClick={runAlgoTest}>▶ Run</button>
        {algoResult && (
          <div style={resultBox(algoResult.passed)}>
            <div>{algoResult.passed ? "✅ PASSED" : "❌ FAILED"}</div>
            <div>Orig corr:  {algoResult.origCorr}  (want ≈ 0)</div>
            <div>WM corr:    {algoResult.wmCorr}  (want &gt; {algoResult.threshold})</div>
            <div>Expected:   {algoResult.expected}</div>
            <div>Threshold:  {algoResult.threshold}</div>
          </div>
        )}
      </section>

      {/* ── TEST 2 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 2 — Live Mic Recording</h2>
        <p style={descStyle}>
          Records 5 seconds through the watermark pipeline. Captures lossless
          WAV directly from AudioWorklet output. Speak while recording.
        </p>

        {recError && (
          <div style={{ ...resultBox(false), marginBottom: 12 }}>
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>❌ Error</div>
            <div style={{ color: "#f44336" }}>{recError}</div>
          </div>
        )}

        {recStatus === "idle" && (
          <button style={btnStyle} onClick={startRecording}>
            🎤 Record 5 Seconds
          </button>
        )}

        {recStatus === "recording" && (
          <div style={{ marginTop: 12, color: "#ff9800" }}>
            ⏺ Recording… {countdown}s remaining
          </div>
        )}

        {recStatus === "done" && (
          <>
            <button
              style={{ ...btnStyle, background: "#555", marginTop: 8 }}
              onClick={startRecording}
            >
              ↺ Record Again
            </button>
            <div
              style={{
                marginTop: 16,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: "#aaa" }}>
                  🎙 Original
                </div>
                {origUrl && (
                  <audio controls src={origUrl} style={{ width: "100%" }} />
                )}
                {origUrl && (
                  <a href={origUrl} download="original.webm" style={linkStyle}>
                    ⬇ original.webm
                  </a>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: "#aaa" }}>
                  💧 Watermarked (WAV)
                </div>
                {wmUrl && (
                  <audio controls src={wmUrl} style={{ width: "100%" }} />
                )}
                {wmUrl && (
                  <a
                    href={wmUrl}
                    download="watermarked.wav"
                    style={linkStyle}
                  >
                    ⬇ watermarked.wav
                  </a>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
              Both should sound identical. Upload watermarked.wav to Test 3.
            </p>
          </>
        )}
      </section>

      {/* ── TEST 3 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 3 — Detection on Recorded File</h2>
        <p style={descStyle}>
          Upload watermarked.wav from Test 2. WAV uses full threshold,
          compressed files use 10% to account for Opus codec loss.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files[0]) analyzeFile(e.target.files[0]);
          }}
        />
        <button style={btnStyle} onClick={() => fileRef.current?.click()}>
          📂 Upload Audio File
        </button>
        {detection?.status === "analyzing" && (
          <div style={{ marginTop: 12, color: "#888" }}>Analyzing…</div>
        )}
        {detection?.status === "done" && (
          <div style={resultBox(detection.passed)}>
            <div style={{ fontWeight: "bold", marginBottom: 8 }}>
              {detection.passed ? "✅ WATERMARK DETECTED" : "❌ NOT DETECTED"}{" "}
              ({detection.isWav ? "lossless WAV" : "compressed"})
            </div>
            <div>Frames analyzed:  {detection.numFrames}</div>
            <div>
              Detected frames:  {detection.detected} ({detection.rate}%)
            </div>
            <div>
              Mean correlation: {detection.mean} (expected:{" "}
              {detection.expected})
            </div>
            <div>Threshold used:   {detection.threshold}</div>
            {!detection.passed && (
              <div style={{ marginTop: 8, color: "#ff9800" }}>
                💡 If mean correlation is near 0, _processChunk is not
                embedding. Check audio-worklet-processor.js.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── TEST 4 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 4 — Dynamic Config from Backend</h2>
        <p style={descStyle}>
          Tests watermark embedding with values from the backend API. Currently
          using a <strong>mock response</strong> — swap for a real fetch once
          your teammate's endpoint is ready (see comment in code).
        </p>

        <div
          style={{
            background: "#111",
            border: "1px solid #444",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: "#aaa",
          }}
        >
          <div style={{ color: "#888", marginBottom: 4 }}>
            Mock response (from{" "}
            <code style={{ color: "#60a5fa" }}>
              GET /api/watermark/config?sessionId=XYZ&amp;userId=123
            </code>
            ):
          </div>
          <pre style={{ margin: 0, color: "#e5e7eb" }}>
            {JSON.stringify(MOCK_BACKEND_RESPONSE, null, 2)}
          </pre>
        </div>

        <button
          style={btnStyle}
          onClick={runConfigTest}
          disabled={configRunning}
        >
          {configRunning ? "Fetching…" : "▶ Run Config Test"}
        </button>

        {configResult && (
          <div style={resultBox(configResult.passed)}>
            {configResult.error ? (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8 }}>
                  ❌ FAILED
                </div>
                <div style={{ color: "#f44336" }}>
                  Error: {configResult.error}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8 }}>
                  {configResult.passed ? "✅ PASSED" : "❌ FAILED"}
                  {configResult.isMocked && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        background: "#ff980033",
                        color: "#ff9800",
                        padding: "2px 6px",
                        borderRadius: 3,
                      }}
                    >
                      MOCKED
                    </span>
                  )}
                </div>
                <div>
                  Seed: <strong>{String(configResult.seed)}</strong>
                  {configResult.seedIsDynamic ? (
                    <span style={{ color: "#4caf50" }}>
                      {" "}✅ different from hardcoded default ({SEED})
                    </span>
                  ) : (
                    <span style={{ color: "#ff9800" }}>
                      {" "}⚠️ same as hardcoded default — backend may not be
                      dynamic yet
                    </span>
                  )}
                </div>
                <div>Alpha:     {configResult.alpha}</div>
                <div>FrameSize: {configResult.frameSize}</div>
                <div>
                  WM corr:   {configResult.wmCorr} (want &gt;{" "}
                  {configResult.threshold})
                </div>
                <div>Expected:  {configResult.expected}</div>
                {configResult.passed && configResult.isMocked && (
                  <div style={{ marginTop: 8, color: "#ff9800" }}>
                    💡 Mock passed. To test the real backend, uncomment the
                    fetch() block in runConfigTest() and remove the mock.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </section>
      {/* ── TEST 5 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 5 — Backend Detection API</h2>
        <p style={descStyle}>
          Upload a WAV file and enter a session ID to call the real
          <code style={{ color: "#60a5fa", margin: "0 4px" }}>POST /api/watermark/detect</code>
          endpoint. The session must have users registered via
          <code style={{ color: "#60a5fa", margin: "0 4px" }}>GET /api/watermark/config</code> first.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Session ID (e.g. abc123)"
            value={backendSessionId}
            onChange={(e) => setBackendSessionId(e.target.value)}
            style={{
              background: "#111", border: "1px solid #444", borderRadius: 6,
              padding: "8px 12px", color: "#fff", fontSize: 13, fontFamily: "monospace",
            }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              ref={backendFileRef}
              type="file"
              accept="audio/wav,audio/*"
              style={{ display: "none" }}
              onChange={(e) => setBackendFile(e.target.files[0] || null)}
            />
            <button style={btnStyle} onClick={() => backendFileRef.current?.click()}>
              📂 Choose Audio File
            </button>
            {backendFile && (
              <span style={{ fontSize: 12, color: "#aaa" }}>{backendFile.name}</span>
            )}
          </div>
          <button
            style={{ ...btnStyle, background: backendLoading ? "#555" : "#16a34a" }}
            onClick={runBackendDetection}
            disabled={backendLoading || !backendFile || !backendSessionId.trim()}
          >
            {backendLoading ? "Detecting…" : "🔍 Detect Watermark"}
          </button>
        </div>

        {backendResult && (
          <div style={resultBox(backendResult.watermarkDetected)}>
            {backendResult.error ? (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 6 }}>❌ Request Failed</div>
                <div style={{ color: "#f44336" }}>{backendResult.error}</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8, fontSize: 15 }}>
                  {backendResult.watermarkDetected ? "✅ WATERMARK DETECTED" : "❌ NO WATERMARK DETECTED"}
                </div>
                {backendResult.detectedUser && (
                  <div>Detected User: <strong style={{ color: "#4caf50" }}>{backendResult.detectedUser}</strong></div>
                )}
                <div>Session ID: {backendResult.sessionId}</div>
                <div>Correlation Score: <strong>{backendResult.correlationScore}</strong></div>
                <div>Frames Analyzed: {backendResult.totalFramesAnalyzed}</div>
                <div>Users Checked: {backendResult.totalUsersChecked}</div>
                {backendResult.allUserScores && Object.keys(backendResult.allUserScores).length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: "#aaa", marginBottom: 4, fontSize: 12 }}>All User Scores:</div>
                    <div style={{
                      background: "#0d0d0d", borderRadius: 4, padding: "8px 12px",
                      fontSize: 12, fontFamily: "monospace",
                    }}>
                      {Object.entries(backendResult.allUserScores).map(([uid, score]) => (
                        <div key={uid} style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
                          <span style={{ color: uid === backendResult.detectedUser ? "#4caf50" : "#aaa" }}>
                            {uid === backendResult.detectedUser ? "▶ " : "  "}{uid}
                          </span>
                          <span>{score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 10, color: "#888", fontSize: 12 }}>{backendResult.message}</div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const sectionStyle = {
  background: "#1a1a1a",
  border: "1px solid #333",
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
};

const headingStyle = {
  fontSize: 16,
  marginTop: 0,
  marginBottom: 6,
};

const descStyle = {
  fontSize: 13,
  color: "#888",
  marginBottom: 14,
  marginTop: 0,
};

const btnStyle = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "8px 18px",
  cursor: "pointer",
  fontSize: 14,
};

const linkStyle = {
  display: "block",
  fontSize: 12,
  color: "#60a5fa",
  marginTop: 6,
  textDecoration: "none",
};

const resultBox = (passed) => ({
  marginTop: 14,
  padding: 14,
  borderRadius: 6,
  background: passed ? "rgba(76,175,80,0.1)" : "rgba(244,67,54,0.1)",
  border: `1px solid ${passed ? "#4caf50" : "#f44336"}`,
  fontSize: 13,
  lineHeight: 1.8,
});

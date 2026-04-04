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

// ─── Fallback defaults (used only for Test 1) ─────────────────────────────────
// Tests 2–5 always fetch the real config from the backend.
const DEFAULT_SEED = "42";
const DEFAULT_ALPHA = 0.005;
const DEFAULT_FRAME = 256;

// ─────────────────────────────────────────────────────────────────────────────

export default function WatermarkTestPage() {
  const navigate = useNavigate();

  // ── Test 1 ──
  const [algoResult, setAlgoResult] = useState(null);

  // ── Test 2 ──
  const [recStatus, setRecStatus] = useState("idle");
  const [recError, setRecError] = useState(null);
  const [countdown, setCountdown] = useState(5);
  const [wmUrl, setWmUrl] = useState(null);
  const [origUrl, setOrigUrl] = useState(null);
  // Config used during the last recording — needed by Test 3
  const [recConfig, setRecConfig] = useState(null);
  const [recConfigLoading, setRecConfigLoading] = useState(false);
  const [recSessionId, setRecSessionId] = useState("");
  const [recUserId, setRecUserId] = useState("");
  const timerRef = useRef(null);
  const samplesRef = useRef([]);
  const fileRef = useRef(null);

  // ── Test 3 ──
  const [detection, setDetection] = useState(null);
  const det3FileRef = useRef(null);

  // ── Test 4 ──
  const [configResult, setConfigResult] = useState(null);
  const [configRunning, setConfigRunning] = useState(false);
  const [configSessionId, setConfigSessionId] = useState("");
  const [configUserId, setConfigUserId] = useState("");

  // ── Test 5 ──
  const [backendSessionId, setBackendSessionId] = useState("");
  const [backendFile, setBackendFile] = useState(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [backendResult, setBackendResult] = useState(null);
  const backendFileRef = useRef(null);

  // ─── Shared: fetch config from backend ──────────────────────────────────────
  async function fetchConfig(sessionId, userId) {
    const res = await fetch(
      `/api/watermark/config?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}`
    );
    if (!res.ok) throw new Error(`Backend returned ${res.status}`);
    const config = await res.json();
    const { seed, alpha, frameSize } = config;
    if (seed === undefined || alpha === undefined || frameSize === undefined) {
      throw new Error(`Missing fields in config response: ${JSON.stringify(config)}`);
    }
    return { seed, alpha, frameSize };
  }

  // ─── TEST 1 ─────────────────────────────────────────────────────────────────
  // Pure math check with hardcoded defaults — no backend needed.
  function runAlgoTest() {
    const pn = generatePN(DEFAULT_SEED, DEFAULT_FRAME);
    const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
    const threshold = DEFAULT_ALPHA * DEFAULT_FRAME * pnPower * 0.5;

    const silence = new Float32Array(DEFAULT_FRAME);
    const watermarked = embedSilence(pn, DEFAULT_ALPHA, DEFAULT_FRAME);

    const origCorr = correlate(silence, pn);
    const wmCorr = correlate(watermarked, pn);
    const passed = Math.abs(origCorr) < threshold && wmCorr > threshold;

    setAlgoResult({
      origCorr: origCorr.toFixed(4),
      wmCorr: wmCorr.toFixed(4),
      threshold: threshold.toFixed(4),
      expected: (DEFAULT_ALPHA * DEFAULT_FRAME * pnPower).toFixed(4),
      passed,
    });
  }

  // ─── TEST 2 ─────────────────────────────────────────────────────────────────
  // Fetches real config for the given user/session, then records through the
  // worklet using that seed/alpha/frameSize.
  async function startRecording() {
    if (!recSessionId.trim() || !recUserId.trim()) return;

    setRecStatus("fetching");
    setRecError(null);
    setWmUrl(null);
    setOrigUrl(null);
    setRecConfig(null);
    setCountdown(5);
    samplesRef.current = [];

    // ── 1. Fetch real config ────────────────────────────────────────────────
    let cfg;
    try {
      setRecConfigLoading(true);
      cfg = await fetchConfig(recSessionId.trim(), recUserId.trim());
      setRecConfig(cfg);
    } catch (err) {
      setRecError(`Config fetch failed: ${err.message}`);
      setRecStatus("idle");
      setRecConfigLoading(false);
      return;
    } finally {
      setRecConfigLoading(false);
    }

    setRecStatus("recording");

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

      // Pass the real seed, alpha, frameSize into the worklet
      const result = await Promise.race([
        createProcessedStream(micStream, {
          seed: cfg.seed,
          alpha: cfg.alpha,
          frameSize: cfg.frameSize,
        }),
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
        throw new Error(
          "workletNode missing from createProcessedStream return value — add it to the return object in audioWorkletSetup.js"
        );
      }
    } catch (err) {
      console.error("[Test 2]", err);
      setRecError(err.message);
      setRecStatus("idle");
      micStream?.getTracks().forEach((t) => t.stop());
      return;
    }

    // ── Capture lossless WAV from worklet output ────────────────────────────
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
      setOrigUrl(URL.createObjectURL(new Blob(origChunks, { type: "audio/webm" })));
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

  // ─── TEST 3 ─────────────────────────────────────────────────────────────────
  // Uses the config that was active during the last Test 2 recording.
  // Falls back to prompting the user if they upload a file without recording first.
  async function analyzeFile(file) {
    setDetection({ status: "analyzing" });

    const arrayBuffer = await file.arrayBuffer();
    const ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    ctx.close();

    // Use the config from the last recording, or fall back to defaults with a warning
    const cfg = recConfig ?? { seed: DEFAULT_SEED, alpha: DEFAULT_ALPHA, frameSize: DEFAULT_FRAME };
    const usedFallback = !recConfig;

    const { seed, alpha, frameSize } = cfg;
    const pn = generatePN(seed, frameSize);
    const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
    const isWav = file.name.endsWith(".wav");
    const threshold = alpha * frameSize * pnPower * (isWav ? 0.5 : 0.1);

    const numFrames = Math.floor(data.length / frameSize);
    let detected = 0;
    const correlations = [];

    for (let i = 0; i < numFrames; i++) {
      const frame = data.slice(i * frameSize, (i + 1) * frameSize);
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
      expected: (alpha * frameSize * pnPower).toFixed(4),
      isWav,
      passed: rate > 0.5,
      seed,
      alpha,
      frameSize,
      usedFallback,
    });
  }

  // ─── TEST 4 ─────────────────────────────────────────────────────────────────
  async function runConfigTest() {
    if (!configSessionId.trim() || !configUserId.trim()) return;
    setConfigRunning(true);
    setConfigResult(null);

    try {
      const { seed, alpha, frameSize } = await fetchConfig(
        configSessionId.trim(),
        configUserId.trim()
      );

      const pn = generatePN(seed, frameSize);
      const pnPower = pn.reduce((s, v) => s + v * v, 0) / pn.length;
      const threshold = alpha * frameSize * pnPower * 0.5;

      const watermarked = embedSilence(pn, alpha, frameSize);
      const wmCorr = correlate(watermarked, pn);
      const passed = wmCorr > threshold;
      const seedIsDynamic = String(seed) !== String(DEFAULT_SEED);

      setConfigResult({
        passed,
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
        seed: "—", alpha: "—", frameSize: "—",
        wmCorr: "—", threshold: "—", expected: "—",
        seedIsDynamic: false,
        error: err.message,
      });
    } finally {
      setConfigRunning(false);
    }
  }

  // ─── TEST 5 ─────────────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px", fontFamily: "monospace" }}>
      <button onClick={() => navigate("/")} style={{ marginBottom: 24, cursor: "pointer" }}>
        ← Back
      </button>

      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Watermark Test</h1>
      <p style={{ color: "#888", marginBottom: 32, fontSize: 13 }}>
        Tests 2–5 use live config from the backend. Test 1 uses hardcoded defaults (seed={DEFAULT_SEED}, α={DEFAULT_ALPHA}, frame={DEFAULT_FRAME}).
      </p>

      {/* ── TEST 1 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 1 — Algorithm check (no mic, no backend)</h2>
        <p style={descStyle}>
          Embeds a watermark into a silence frame using hardcoded defaults and checks
          the correlation. Verifies the core PN math is correct — no microphone or
          backend needed.
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
        <h2 style={headingStyle}>Test 2 — Live mic recording with real config</h2>
        <p style={descStyle}>
          Fetches the real seed/alpha/frameSize for this user from the backend, then
          records 5 seconds through the watermark worklet using those values. The
          downloaded WAV will be detectable by Test 5 with the same session ID.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Session ID (e.g. abc)"
            value={recSessionId}
            onChange={(e) => setRecSessionId(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="User ID (e.g. debashri)"
            value={recUserId}
            onChange={(e) => setRecUserId(e.target.value)}
            style={inputStyle}
          />
        </div>

        {recError && (
          <div style={{ ...resultBox(false), marginBottom: 12 }}>
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>❌ Error</div>
            <div style={{ color: "#f44336" }}>{recError}</div>
          </div>
        )}

        {recStatus === "idle" && (
          <button
            style={btnStyle}
            onClick={startRecording}
            disabled={!recSessionId.trim() || !recUserId.trim()}
          >
            🎤 Fetch config &amp; record 5 seconds
          </button>
        )}

        {recStatus === "fetching" && (
          <div style={{ marginTop: 12, color: "#888" }}>
            Fetching config for {recUserId} / {recSessionId}…
          </div>
        )}

        {recStatus === "recording" && (
          <div style={{ marginTop: 12, color: "#ff9800" }}>
            ⏺ Recording… {countdown}s remaining
            {recConfig && (
              <span style={{ color: "#888", marginLeft: 12 }}>
                (seed={recConfig.seed}, α={recConfig.alpha}, frame={recConfig.frameSize})
              </span>
            )}
          </div>
        )}

        {recStatus === "done" && (
          <>
            {recConfig && (
              <div style={{ ...resultBox(true), marginBottom: 12 }}>
                <div>Config used — seed: <strong>{recConfig.seed}</strong> · α: {recConfig.alpha} · frameSize: {recConfig.frameSize}</div>
              </div>
            )}
            <button
              style={{ ...btnStyle, background: "#555", marginTop: 8 }}
              onClick={startRecording}
            >
              ↺ Record again
            </button>
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: "#aaa" }}>Original</div>
                {origUrl && <audio controls src={origUrl} style={{ width: "100%" }} />}
                {origUrl && (
                  <a href={origUrl} download="original.webm" style={linkStyle}>⬇ original.webm</a>
                )}
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: "#aaa" }}>Watermarked (WAV)</div>
                {wmUrl && <audio controls src={wmUrl} style={{ width: "100%" }} />}
                {wmUrl && (
                  <a href={wmUrl} download="watermarked.wav" style={linkStyle}>⬇ watermarked.wav</a>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: "#888", marginTop: 8 }}>
              Both should sound identical. Upload watermarked.wav to Test 3 or Test 5.
            </p>
          </>
        )}
      </section>

      {/* ── TEST 3 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 3 — Frontend detection on recorded file</h2>
        <p style={descStyle}>
          Upload a WAV recorded in Test 2. Detection runs in the browser using the
          same config that was fetched during recording. If no recording has been done
          yet this session, defaults are used (and a warning is shown).
        </p>
        <input
          ref={det3FileRef}
          type="file"
          accept="audio/*"
          style={{ display: "none" }}
          onChange={(e) => { if (e.target.files[0]) analyzeFile(e.target.files[0]); }}
        />
        <button style={btnStyle} onClick={() => det3FileRef.current?.click()}>
          📂 Upload audio file
        </button>

        {detection?.status === "analyzing" && (
          <div style={{ marginTop: 12, color: "#888" }}>Analyzing…</div>
        )}
        {detection?.status === "done" && (
          <div style={resultBox(detection.passed)}>
            {detection.usedFallback && (
              <div style={{ color: "#ff9800", marginBottom: 8 }}>
                ⚠️ No recording config found — using hardcoded defaults (seed={DEFAULT_SEED}).
                Run Test 2 first for an accurate result.
              </div>
            )}
            <div style={{ fontWeight: "bold", marginBottom: 8 }}>
              {detection.passed ? "✅ WATERMARK DETECTED" : "❌ NOT DETECTED"}{" "}
              ({detection.isWav ? "lossless WAV" : "compressed"})
            </div>
            <div>Config used — seed: {detection.seed} · α: {detection.alpha} · frameSize: {detection.frameSize}</div>
            <div>Frames analyzed:  {detection.numFrames}</div>
            <div>Detected frames:  {detection.detected} ({detection.rate}%)</div>
            <div>Mean correlation: {detection.mean} (expected: {detection.expected})</div>
            <div>Threshold used:   {detection.threshold}</div>
            {!detection.passed && (
              <div style={{ marginTop: 8, color: "#ff9800" }}>
                💡 If mean correlation is near 0, the worklet may not be embedding.
                Check audio-worklet-processor.js and confirm the seed matches.
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── TEST 4 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 4 — Dynamic config from backend</h2>
        <p style={descStyle}>
          Fetches the watermark config from the backend for a given session and user,
          then verifies the returned seed, alpha, and frameSize produce a detectable
          watermark on a synthetic silence frame.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Session ID (e.g. abc)"
            value={configSessionId}
            onChange={(e) => setConfigSessionId(e.target.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="User ID (e.g. debashri)"
            value={configUserId}
            onChange={(e) => setConfigUserId(e.target.value)}
            style={inputStyle}
          />
        </div>

        <button
          style={btnStyle}
          onClick={runConfigTest}
          disabled={configRunning || !configSessionId.trim() || !configUserId.trim()}
        >
          {configRunning ? "Fetching…" : "▶ Run config test"}
        </button>

        {configResult && (
          <div style={resultBox(configResult.passed)}>
            {configResult.error ? (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8 }}>❌ FAILED</div>
                <div style={{ color: "#f44336" }}>Error: {configResult.error}</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8 }}>
                  {configResult.passed ? "✅ PASSED" : "❌ FAILED"}
                </div>
                <div>
                  Seed: <strong>{String(configResult.seed)}</strong>
                  {configResult.seedIsDynamic ? (
                    <span style={{ color: "#4caf50" }}> ✅ differs from hardcoded default ({DEFAULT_SEED})</span>
                  ) : (
                    <span style={{ color: "#ff9800" }}> ⚠️ same as hardcoded default — backend may not be dynamic yet</span>
                  )}
                </div>
                <div>Alpha:     {configResult.alpha}</div>
                <div>FrameSize: {configResult.frameSize}</div>
                <div>WM corr:   {configResult.wmCorr} (want &gt; {configResult.threshold})</div>
                <div>Expected:  {configResult.expected}</div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ── TEST 5 ── */}
      <section style={sectionStyle}>
        <h2 style={headingStyle}>Test 5 — Backend detection API</h2>
        <p style={descStyle}>
          Upload a WAV file and enter the session ID to call{" "}
          <code style={{ color: "#60a5fa" }}>POST /api/watermark/detect</code>.
          The session must have users registered via{" "}
          <code style={{ color: "#60a5fa" }}>GET /api/watermark/config</code> first.
          Use the same session ID you recorded with in Test 2.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <input
            type="text"
            placeholder="Session ID (e.g. abc)"
            value={backendSessionId}
            onChange={(e) => setBackendSessionId(e.target.value)}
            style={inputStyle}
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
              📂 Choose audio file
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
            {backendLoading ? "Detecting…" : "🔍 Detect watermark"}
          </button>
        </div>

        {backendResult && (
          <div style={resultBox(backendResult.watermarkDetected)}>
            {backendResult.error ? (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 6 }}>❌ Request failed</div>
                <div style={{ color: "#f44336" }}>{backendResult.error}</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: "bold", marginBottom: 8, fontSize: 15 }}>
                  {backendResult.watermarkDetected ? "✅ WATERMARK DETECTED" : "❌ NO WATERMARK DETECTED"}
                </div>
                {backendResult.detectedUser && (
                  <div>Detected user: <strong style={{ color: "#4caf50" }}>{backendResult.detectedUser}</strong></div>
                )}
                <div>Session ID:         {backendResult.sessionId}</div>
                <div>Correlation score:  <strong>{backendResult.correlationScore}</strong></div>
                <div>Frames analyzed:    {backendResult.totalFramesAnalyzed}</div>
                <div>Users checked:      {backendResult.totalUsersChecked}</div>
                {backendResult.allUserScores && Object.keys(backendResult.allUserScores).length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: "#aaa", marginBottom: 4, fontSize: 12 }}>All user scores:</div>
                    <div style={{ background: "#0d0d0d", borderRadius: 4, padding: "8px 12px", fontSize: 12 }}>
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

const inputStyle = {
  background: "#111",
  border: "1px solid #444",
  borderRadius: 6,
  padding: "8px 12px",
  color: "#fff",
  fontSize: 13,
  fontFamily: "monospace",
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

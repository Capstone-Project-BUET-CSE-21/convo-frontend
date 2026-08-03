import { useRef, useState } from "react";

const encodeWav = (samples, sampleRate) => {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
};

const useMeetingRecording = ({
  localVideoRef,
  recordingSourceStreamRef, // the watermarked (own + remote) monitor mix
  playbackWorkletNodeRef,   // the AudioWorkletNode embedding that watermark
  roomId,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);

  const recordingAudioCtxRef = useRef(null);
  const recordingScriptNodeRef = useRef(null);
  const recordingSilentDestRef = useRef(null);
  const recordingSourceModeRef = useRef("none");
  const recordingSamplesRef = useRef([]);
  const recordingSampleRateRef = useRef(48000);

  const startRecording = async () => {
    const sourceStream = recordingSourceStreamRef?.current;

    let audioCtx = null;
    let sourceNode = null;

    if (sourceStream?.getAudioTracks().length) {
      // Primary path: the watermarked mix (own mic + every remote peer).
      audioCtx = new AudioContext();
      sourceNode = audioCtx.createMediaStreamSource(sourceStream);
      recordingSourceModeRef.current = "playback";
    } else if (localVideoRef.current?.srcObject?.getAudioTracks().length) {
      // Fallback for edge cases where the watermark mix isn't ready yet:
      // record raw local mic only rather than failing outright. This
      // won't include remote audio or a watermark.
      audioCtx = new AudioContext();
      sourceNode = audioCtx.createMediaStreamSource(localVideoRef.current.srcObject);
      recordingSourceModeRef.current = "fallback";
    } else {
      recordingSourceModeRef.current = "none";
    }

    if (!audioCtx || !sourceNode) {
      console.error("No audio source available to record.");
      return;
    }

    recordingAudioCtxRef.current = audioCtx;
    recordingSampleRateRef.current = audioCtx.sampleRate;
    recordingSamplesRef.current = [];

    // Use AudioWorklet-based recorder to avoid deprecated ScriptProcessorNode
    let silentDestination = null;
    try {
      await audioCtx.audioWorklet.addModule('/audio-watermark/recorder-processor.worklet.js');
      const recorderNode = new AudioWorkletNode(audioCtx, 'recorder-processor');
      recorderNode.port.onmessage = (e) => {
        recordingSamplesRef.current.push(new Float32Array(e.data));
      };

      // Keep capture silent to avoid feeding back into the live mix/speakers.
      silentDestination = audioCtx.createMediaStreamDestination();

      // Pins the recording's start to a KNOWN watermark cycle position (0)
      // instead of an arbitrary one, so the detector's cheap near-cyclePos=0
      // fast path finds it almost instantly. Not required for correctness —
      // the detector also has a full exhaustive fallback search for
      // recordings that never got this reset (e.g. external recorders) —
      // this is purely a speed optimization for in-app recordings.
      //
      // MUST happen right here, immediately before connect() actually
      // starts audio flowing into the recorder — NOT earlier (e.g. before
      // the addModule() await above). The embedder's cycle position
      // advances continuously in real time regardless of whether anyone is
      // recording, so any delay between "reset sent" and "recording
      // actually starts" — and addModule() is a real network fetch +
      // module registration, easily hundreds of ms on a cold load — erodes
      // the fast path's tolerance window directly. Resetting late (here)
      // instead of early keeps that gap to whatever's left of this
      // synchronous block, not an entire async worklet-loading round trip.
      if (recordingSourceModeRef.current === "playback") {
        playbackWorkletNodeRef?.current?.port.postMessage({ type: 'reset-prng' });
      }

      sourceNode.connect(recorderNode);
      recorderNode.connect(silentDestination);

      recordingScriptNodeRef.current = recorderNode;
    } catch (err) {
      console.error('recorder worklet registration failed', err);
      audioCtx.close();
      setIsRecording(false);
      return;
    }
    recordingSilentDestRef.current = silentDestination;
    setIsRecording(true);
    setRecordedBlob(null);
  };

  const stopRecording = () => {
    if (!recordingAudioCtxRef.current) {
      setIsRecording(false);
      return;
    }

    recordingScriptNodeRef.current?.disconnect();
    recordingScriptNodeRef.current = null;
    recordingSilentDestRef.current = null;

    const chunks = recordingSamplesRef.current;
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const pcm = new Float32Array(total);

    let offset = 0;
    chunks.forEach((chunk) => {
      pcm.set(chunk, offset);
      offset += chunk.length;
    });

    const wavBlob = encodeWav(pcm, recordingSampleRateRef.current);
    setRecordedBlob(wavBlob);

    recordingAudioCtxRef.current.close();
    recordingAudioCtxRef.current = null;
    recordingSourceModeRef.current = "none";
    recordingSamplesRef.current = [];

    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const downloadRecording = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `meeting-${roomId}-${Date.now()}.wav`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return {
    isRecording,
    hasRecording: Boolean(recordedBlob),
    toggleRecording,
    stopRecording,
    downloadRecording,
  };
};

export default useMeetingRecording;
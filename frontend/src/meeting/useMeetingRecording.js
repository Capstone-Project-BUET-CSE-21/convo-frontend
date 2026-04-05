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
  roomId,
  watermarkAudioContextRef,
  watermarkWorkletNodeRef,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);

  const recordingAudioCtxRef = useRef(null);
  const recordingScriptNodeRef = useRef(null);
  const recordingSilentDestRef = useRef(null);
  const recordingSourceModeRef = useRef("none");
  const recordingSamplesRef = useRef([]);
  const recordingSampleRateRef = useRef(48000);

  const startRecording = () => {
    const workletAudioContext = watermarkAudioContextRef.current;
    const workletNode = watermarkWorkletNodeRef.current;
    const localStream = localVideoRef.current?.srcObject;

    let audioCtx = null;
    let sourceNode = null;

    if (workletAudioContext && workletNode) {
      // Match WatermarkTestPage: capture directly from watermark worklet output.
      audioCtx = workletAudioContext;
      sourceNode = workletNode;
      recordingSourceModeRef.current = "worklet";
    } else {
      // Fallback for edge cases where watermark pipeline is not ready yet.
      audioCtx = new AudioContext();
      sourceNode = localStream?.getAudioTracks().length
        ? audioCtx.createMediaStreamSource(localStream)
        : null;
      recordingSourceModeRef.current = "fallback";
    }

    if (!audioCtx || !sourceNode) {
      return;
    }

    recordingAudioCtxRef.current = audioCtx;
    recordingSampleRateRef.current = audioCtx.sampleRate;
    recordingSamplesRef.current = [];

    const scriptNode = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptNode.onaudioprocess = (event) => {
      recordingSamplesRef.current.push(
        new Float32Array(event.inputBuffer.getChannelData(0))
      );
    };

    // Keep capture silent to avoid local echo.
    const silentDestination = audioCtx.createMediaStreamDestination();
    sourceNode.connect(scriptNode);
    scriptNode.connect(silentDestination);

    recordingScriptNodeRef.current = scriptNode;
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

    if (recordingSourceModeRef.current === "fallback") {
      recordingAudioCtxRef.current.close();
    }
    recordingAudioCtxRef.current = null;
    recordingScriptNodeRef.current = null;
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

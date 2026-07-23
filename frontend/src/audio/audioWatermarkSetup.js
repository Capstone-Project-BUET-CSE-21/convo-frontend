// Watermarks an ALREADY-MIXED audio stream (own mic + all remote peers,
// summed live by audioLocalMixBus.js). This is the ONLY watermark pipeline
// in the app now — it exists purely so that whatever reaches your own
// speakers (and therefore anything a phone/external recorder or the in-app
// recorder captures) carries your watermark. Peers receive your raw,
// unmodified mic/camera tracks — there is no outgoing watermarking.
export const createLocalMixBus = () => {
  const audioContext = new AudioContext();

  const mixGain = audioContext.createGain();
  mixGain.gain.value = 1;

  // Anti-clipping: several participants summed at full amplitude can exceed
  // 0dB and distort. A gentle compressor reins that in instead of clipping.
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 24;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;

  const destination = audioContext.createMediaStreamDestination();

  mixGain.connect(compressor);
  compressor.connect(destination);

  const sourceNodes = new Map();

  const addSource = (key, mediaStreamTrack) => {
    if (sourceNodes.has(key)) removeSource(key);

    const trackStream = new MediaStream([mediaStreamTrack]);
    const sourceNode = audioContext.createMediaStreamSource(trackStream);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1;

    sourceNode.connect(gainNode);
    gainNode.connect(mixGain);

    sourceNodes.set(key, { sourceNode, gainNode });
  };

  const removeSource = (key) => {
    const entry = sourceNodes.get(key);
    if (!entry) return;
    try {
      entry.sourceNode.disconnect();
      entry.gainNode.disconnect();
    } catch (err) {
      console.error("Error disconnecting mix source:", err);
    }
    sourceNodes.delete(key);
  };

  const hasSource = (key) => sourceNodes.has(key);

  const close = () => {
    Array.from(sourceNodes.keys()).forEach(removeSource);
    try {
      mixGain.disconnect();
      compressor.disconnect();
      destination.disconnect();
    } catch (err) {
      console.error("Error disconnecting mix bus:", err);
    } finally {
      sourceNodes.clear();
    }
    audioContext.close();
  };

  return {
    audioContext,
    mixedStream: destination.stream,
    addSource,
    removeSource,
    hasSource,
    close,
  };
};

export const createWatermarkedPlaybackStream = async ({ mixedStream, config }) => {
  const audioContext = new AudioContext();

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  await audioContext.audioWorklet.addModule('/audio-watermark/audio-processor.worklet.js');

  const sourceNode = audioContext.createMediaStreamSource(mixedStream);

  const workletNode = new AudioWorkletNode(audioContext, 'audio-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { ...config, sampleRate: audioContext.sampleRate }
  });

  const destination = audioContext.createMediaStreamDestination();

  sourceNode.connect(workletNode);
  workletNode.connect(destination);

  return { stream: destination.stream, audioContext, workletNode };
};
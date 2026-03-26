export async function createProcessedStream(rawStream) {
  const audioContext = new AudioContext();

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  await audioContext.audioWorklet.addModule('/audio-processor.worklet.js');

  const audioSource = audioContext.createMediaStreamSource(rawStream);

  // GainNode controls volume inside the pipeline
  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1; // 1 = full volume, 0 = silence

  const workletNode = new AudioWorkletNode(audioContext, 'audio-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1]
  });

  const destination = audioContext.createMediaStreamDestination();

  // source → gain → worklet → destination
  audioSource.connect(gainNode);
  gainNode.connect(workletNode);
  workletNode.connect(destination);

  const processedStream = new MediaStream();

  destination.stream.getAudioTracks().forEach(track => {
    processedStream.addTrack(track);
  });

  rawStream.getVideoTracks().forEach(track => {
    processedStream.addTrack(track);
  });

  // Attach context and gainNode so App.jsx can access them
  processedStream._audioContext = audioContext;
  processedStream._gainNode = gainNode;

  return processedStream;
}
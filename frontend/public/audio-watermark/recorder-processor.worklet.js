class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      // Copy into a transferable buffer
      const buf = new Float32Array(channelData.length);
      buf.set(channelData);
      this.port.postMessage(buf.buffer, [buf.buffer]);
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);

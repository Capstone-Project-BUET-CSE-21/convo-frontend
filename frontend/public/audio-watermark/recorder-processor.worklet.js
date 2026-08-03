class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._loggedFirstFrame = false; // TEMP DIAGNOSTIC — remove once the fast-path timing gap is measured.
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      if (!this._loggedFirstFrame) {
        this._loggedFirstFrame = true;
        console.log('[watermark-diag] recorder first real sample, t=', performance.now());
      }
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

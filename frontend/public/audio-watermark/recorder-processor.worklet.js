class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._loggedFirstFrame = false; // TEMP DIAGNOSTIC — remove once the fast-path timing gap is measured.
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channelData = input[0];
      // Copy into a transferable buffer
      const buf = new Float32Array(channelData.length);
      buf.set(channelData);
      this.port.postMessage(buf.buffer, [buf.buffer]);

      // TEMP DIAGNOSTIC — remove once the fast-path timing gap is measured.
      // Runs AFTER the real capture logic above, so even if this throws (as
      // it did with `performance`, which doesn't exist in
      // AudioWorkletGlobalScope — a worklet with an uncaught exception in
      // process() gets permanently silenced by the browser for the rest of
      // its lifetime, which is exactly what broke recording last time),
      // the actual sample never fails to get posted.
      if (!this._loggedFirstFrame) {
        this._loggedFirstFrame = true;
        console.log('[watermark-diag] recorder first real sample, currentTime=', currentTime);
      }
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);

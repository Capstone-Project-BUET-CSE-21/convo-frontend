class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 256;
    this._capacity = 4096;

    // Input ring buffer
    this._inBuf = new Float32Array(this._capacity);
    this._inWrite = 0;
    this._inRead = 0;
    this._inFilled = 0;

    // Output ring buffer
    this._outBuf = new Float32Array(this._capacity);
    this._outWrite = 0;
    this._outRead = 0;
    this._outFilled = 0;
  }

  _pushIn(samples) {
    for (let i = 0; i < samples.length; i++) {
      this._inBuf[this._inWrite % this._capacity] = samples[i];
      this._inWrite++;
      this._inFilled++;
    }
  }

  _pullIn(out) {
    for (let i = 0; i < out.length; i++) {
      out[i] = this._inBuf[this._inRead % this._capacity];
      this._inRead++;
      this._inFilled--;
    }
  }

  _pushOut(samples) {
    for (let i = 0; i < samples.length; i++) {
      this._outBuf[this._outWrite % this._capacity] = samples[i];
      this._outWrite++;
      this._outFilled++;
    }
  }

  _pullOut(out) {
    for (let i = 0; i < out.length; i++) {
      out[i] = this._outBuf[this._outRead % this._capacity];
      this._outRead++;
      this._outFilled--;
    }
  }

  process(inputs, outputs) {
    const inputChannel = inputs?.[0]?.[0];
    const outputChannel = outputs?.[0]?.[0];

    // Step 0: Handle empty frames safely
    if (!inputChannel || !outputChannel) return true;

    const frameSize = inputChannel.length; // 128 samples per frame

    // Step 1: Push incoming samples into input buffer
    this._pushIn(inputChannel);

    // Step 2: Process all complete 256-sample chunks from input → output buffer
    while (this._inFilled >= this._bufferSize) {
      const chunk = new Float32Array(this._bufferSize);
      this._pullIn(chunk);
      const processed = this._processChunk(chunk);
      this._pushOut(processed);
    }

    // Step 3: Handle incomplete frame — only when output buffer is starving
    // During normal call this never triggers (next frame will complete the 256)
    // Only fires at end of stream or mic cut — pads with zeros and processes
    if (this._inFilled > 0 && this._inFilled < this._bufferSize && this._outFilled < frameSize) {
      const chunk = new Float32Array(this._bufferSize); // zero-filled by default
      this._pullIn(chunk.subarray(0, this._inFilled));  // copy available samples
      // remaining samples stay as 0 (silence padding)
      const processed = this._processChunk(chunk);
      this._pushOut(processed);
    }

    // Step 4: Pull frameSize samples from output buffer to actual output
    if (this._outFilled >= frameSize) {
      this._pullOut(outputChannel);
    } else {
      // Truly nothing available — output silence
      outputChannel.fill(0);
    }

    return true;
  }

  _processChunk(samples) {
    // Pass-through — replace with real processing later
    return samples;
  }
}

registerProcessor("audio-processor", AudioProcessor);

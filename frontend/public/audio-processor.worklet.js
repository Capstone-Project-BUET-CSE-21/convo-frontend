/* eslint-disable no-undef */
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 256;
    this._capacity = 4096;
    this._analysisSize = config.analysisWindowSize || 512;
    this.sampleRate = config.sampleRate || 48000;

    // Guard against a silently-invalid sample rate (this previously caused
    // the bin->band map to collapse to band 0 for every bin — see fix below).
    if (!Number.isFinite(this.sampleRate) || this.sampleRate <= 0) {
      throw new Error("AudioProcessor: invalid sampleRate in processorOptions");
    }

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

    // Watermark config
    // this._alpha = config.alpha || 0.005;
    // this._seed = config.seed || 42;
    // this._pn = _generatePN(this._seed, this._bufferSize);

    // Analysis ring buffer: holds last `analysisSize` samples (current hop + previous hop)
    this._analysisBuf = new Float32Array(this._analysisSize);

    // OLA accumulator: must be at least analysisSize long; we add windowed watermark frames into it
    this._olaAcc = new Float32Array(this._analysisSize);

    this._window = _hannWindow(this._analysisSize); // also used as synthesis window (Hann @ 50% overlap = COLA)

    // Masking policy params (replaces constant alpha)
    this._marginLinear = Math.pow(10, (config.alpha ?? 1) / 20); // dB -> linear amplitude scale
    this._seed = config.seed || 42;
    this._rand = _createMulberry32(
      typeof this._seed === "string"
        ? _hashString(this._seed)
        : this._seed >>> 0,
    );

    // Precompute Bark band edges -> FFT bin index lookup (done once, not per-frame)
    this._numBands = config.numBands || 24;
    this._binToBand = this._buildBinToBandMap(
      this._analysisSize,
      this.sampleRate, // FIX: was `this._sampleRate` (never assigned -> undefined),
                        // which made _hzToBark/_buildBinToBandMap produce NaN for
                        // every bin. Assigning NaN into the Int32Array `map`
                        // silently coerced to 0, so every frequency bin was mapped
                        // to band 0 instead of the proper 24-band Bark mapping.
                        // This corrupted the masking-threshold shaping for the
                        // entire embedded watermark, which is why detection
                        // correlation was ~0 for every user regardless of seed.
      this._numBands,
    );

    // Scratch buffers reused every frame (avoid allocation in the hot path)
    this._re = new Float32Array(this._analysisSize);
    this._im = new Float32Array(this._analysisSize);
    this._pnRe = new Float32Array(this._analysisSize);
    this._pnIm = new Float32Array(this._analysisSize);
    this._bandEnergy = new Float32Array(this._numBands);
    this._bandFlatness = new Float32Array(this._numBands);
    this._bandThreshold = new Float32Array(this._numBands);
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
      // Truly nothing available — output silence uwu
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

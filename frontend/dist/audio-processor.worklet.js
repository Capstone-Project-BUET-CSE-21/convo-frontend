function _hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (((hash << 5) + hash) + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function _createMulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function _generatePN(seed, length) {
  const numericSeed = typeof seed === 'string' ? _hashString(seed) : (seed >>> 0);
  const rand = _createMulberry32(numericSeed);
  const pn = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    pn[i] = rand() * 2.0 - 1.0;
  }
  return pn;
}

class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const config = options.processorOptions || {};

    this._bufferSize = config.frameSize || 256;
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

    // Watermark config
    this._alpha = config.alpha || 0.005;
    this._seed = config.seed || 42;
    this._pn = _generatePN(this._seed, this._bufferSize);
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
    const out = new Float32Array(samples.length);
    const alpha = this._alpha;
    const pn = this._pn;
    for (let n = 0; n < samples.length; n++) {
      let s = samples[n] + alpha * pn[n];
      if (s >  1.0) s =  1.0;
      if (s < -1.0) s = -1.0;
      out[n] = s;
    }
    return out;
  }
}

registerProcessor("audio-processor", AudioProcessor);

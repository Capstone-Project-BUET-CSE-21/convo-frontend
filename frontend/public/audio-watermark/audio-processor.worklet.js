function _hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function _createMulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function _generatePN(seed, length) {
  const numericSeed = typeof seed === "string" ? _hashString(seed) : seed >>> 0;
  const rand = _createMulberry32(numericSeed);
  const pn = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    pn[i] = rand() * 2.0 - 1.0;
  }
  return pn;
}

// ---------- Minimal iterative radix-2 FFT (in-place, real+imag arrays) ----------
function _fft(re, im, invert) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? -1 : 1);
    const wr = Math.cos(ang),
      wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curWr = 1,
        curWi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j],
          ui = im[i + j];
        const vr = re[i + j + len / 2] * curWr - im[i + j + len / 2] * curWi;
        const vi = re[i + j + len / 2] * curWi + im[i + j + len / 2] * curWr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nWr = curWr * wr - curWi * wi;
        const nWi = curWr * wi + curWi * wr;
        curWr = nWr;
        curWi = nWi;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function _hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++)
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function _hzToBark(hz) {
  return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan((hz / 7500) ** 2);
}

class AudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const config = options.processorOptions || {};

    this._bufferSize = config.frameSize || 256;
    this._capacity = 4096;
    this._analysisSize = config.analysisWindowSize || 512;
    this.sampleRate = config.sampleRate || 48000;

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
    this._marginLinear = Math.pow(10, (config.alpha ?? -9) / 20); // dB -> linear amplitude scale
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
      this._sampleRate,
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

  _buildBinToBandMap(n, sr, numBands) {
    const map = new Int32Array(n);
    const nyquistBark = _hzToBark(sr / 2);
    for (let k = 0; k < n; k++) {
      const hz = (k * sr) / n;
      const bark = _hzToBark(hz);
      let band = Math.floor((bark / nyquistBark) * numBands);
      if (band >= numBands) band = numBands - 1;
      if (band < 0) band = 0;
      map[k] = band;
    }
    return map;
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
    if (
      this._inFilled > 0 &&
      this._inFilled < this._bufferSize &&
      this._outFilled < frameSize
    ) {
      const chunk = new Float32Array(this._bufferSize); // zero-filled by default
      this._pullIn(chunk.subarray(0, this._inFilled)); // copy available samples
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

  // _processChunk(samples) {
  //   const out = new Float32Array(samples.length);
  //   const alpha = this._alpha;
  //   const pn = this._pn;
  //   for (let n = 0; n < samples.length; n++) {
  //     let s = samples[n] + alpha * pn[n];
  //     if (s >  1.0) s =  1.0;
  //     if (s < -1.0) s = -1.0;
  //     out[n] = s;
  //   }
  //   return out;
  // }

  // ---- core change: replaces the old constant-alpha per-sample multiply ----
  _processChunk(samples) {
    const N = this._analysisSize;
    const hop = this._bufferSize;

    // 1. Slide the analysis buffer: drop oldest hop, append new hop
    this._analysisBuf.copyWithin(0, hop);
    this._analysisBuf.set(samples, N - hop);

    // 2. Window + load into FFT scratch
    for (let i = 0; i < N; i++) {
      this._re[i] = this._analysisBuf[i] * this._window[i];
      this._im[i] = 0;
    }
    _fft(this._re, this._im, false);

    // 3. Bark-band energy + spectral flatness (tonality proxy)
    this._bandEnergy.fill(0);
    const bandLogSum = new Float32Array(this._numBands);
    const bandCount = new Float32Array(this._numBands);
    for (let k = 0; k < N / 2; k++) {
      // only need positive-frequency half
      const mag2 = this._re[k] * this._re[k] + this._im[k] * this._im[k];
      const b = this._binToBand[k];
      this._bandEnergy[b] += mag2;
      bandLogSum[b] += Math.log(mag2 + 1e-12);
      bandCount[b] += 1;
    }
    for (let b = 0; b < this._numBands; b++) {
      const count = Math.max(bandCount[b], 1);
      const geoMean = Math.exp(bandLogSum[b] / count);
      const arithMean = this._bandEnergy[b] / count;
      this._bandFlatness[b] = geoMean / (arithMean + 1e-12); // 0 (tonal) .. 1 (noise-like)
      this._bandEnergy[b] = arithMean;
    }

    // 4. Masking threshold per band: tonal -> larger offset, noisy -> smaller offset
    for (let b = 0; b < this._numBands; b++) {
      const flat = Math.min(Math.max(this._bandFlatness[b], 0), 1);
      const offsetDb = 18 - flat * 12; // tonal(flat=0) -> 18dB offset, noisy(flat=1) -> 6dB offset
      const energyDb = 10 * Math.log10(this._bandEnergy[b] + 1e-12);
      this._bandThreshold[b] = Math.pow(10, (energyDb - offsetDb) / 10); // linear energy threshold
    }
    // simple 3-tap spreading across adjacent bands
    for (let b = 0; b < this._numBands; b++) {
      const left = b > 0 ? this._bandThreshold[b - 1] : this._bandThreshold[b];
      const right =
        b < this._numBands - 1
          ? this._bandThreshold[b + 1]
          : this._bandThreshold[b];
      this._bandThreshold[b] =
        0.5 * this._bandThreshold[b] + 0.25 * left + 0.25 * right;
    }

    // 5. Generate this frame's PN spectrum (fresh values each frame from continuing PRNG -> non-periodic watermark)
    for (let k = 0; k < N; k++) {
      this._pnRe[k] = this._rand() * 2 - 1;
      this._pnIm[k] = 0;
    }
    _fft(this._pnRe, this._pnIm, false);

    // 6. Shape PN spectrum by sqrt(threshold) * margin, mirror for negative frequencies (real output)
    for (let k = 0; k < N / 2; k++) {
      const b = this._binToBand[k];
      const mag =
        Math.sqrt(
          this._pnRe[k] * this._pnRe[k] + this._pnIm[k] * this._pnIm[k],
        ) + 1e-12;
      const gain =
        (Math.sqrt(this._bandThreshold[b]) * this._marginLinear) / mag; // <-- divide by mag
      this._pnRe[k] *= gain;
      this._pnIm[k] *= gain;
      const mirror = (N - k) % N;
      this._pnRe[mirror] = this._pnRe[k];
      this._pnIm[mirror] = -this._pnIm[k];
    }

    // 7. IFFT back to time domain, apply synthesis window
    _fft(this._pnRe, this._pnIm, true);
    for (let i = 0; i < N; i++) {
      this._pnRe[i] *= this._window[i];
    }

    // 8. Overlap-add into accumulator
    for (let i = 0; i < N; i++) {
      this._olaAcc[i] += this._pnRe[i];
    }

    // 9. Emit the oldest `hop` samples (fully summed since they're no longer touched by future overlaps...
    //    NOTE: with 50% overlap and a 2-hop accumulator this works because each sample is touched by exactly 2 frames)
    const out = new Float32Array(hop);
    for (let i = 0; i < hop; i++) {
      let s = samples[i] + this._olaAcc[i];
      if (s > 1.0) s = 1.0;
      if (s < -1.0) s = -1.0;
      out[i] = s;
    }

    // 10. Shift accumulator by hop, zero-fill the newly exposed tail
    this._olaAcc.copyWithin(0, hop);
    this._olaAcc.fill(0, N - hop);

    return out;
  }
}

registerProcessor("audio-processor", AudioProcessor);

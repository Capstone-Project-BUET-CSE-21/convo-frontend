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

/**
 * Jump a mulberry32 state ahead by `numDraws` calls in O(1).
 *
 * mulberry32's state update is a plain linear counter increment applied
 * BEFORE each call's output scrambling — the scrambling never feeds back
 * into the counter — so the state after N calls is just the initial state
 * plus N * increment (mod 2^32), computable directly instead of by
 * stepping through N calls one at a time. This is what lets each frame
 * jump straight to its position within the current cycle, rather than
 * needing to replay every frame since the cycle began.
 */
function _stateAfterDraws(initialState, numDraws) {
  const INC = 0x6d2b79f5;
  return (initialState + numDraws * INC) >>> 0;
}

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

    if (!Number.isFinite(this.sampleRate) || this.sampleRate <= 0) {
      throw new Error("AudioProcessor: invalid sampleRate in processorOptions");
    }

    this._inBuf = new Float32Array(this._capacity);
    this._inWrite = 0;
    this._inRead = 0;
    this._inFilled = 0;

    this._outBuf = new Float32Array(this._capacity);
    this._outWrite = 0;
    this._outRead = 0;
    this._outFilled = 0;

    this._analysisBuf = new Float32Array(this._analysisSize);
    this._olaAcc = new Float32Array(this._analysisSize);
    this._window = _hannWindow(this._analysisSize);

    this._marginLinear = Math.pow(10, (config.alpha ?? 1) / 20);
    this._seed = config.seed || 42;
    this._baseSeedState =
      typeof this._seed === "string" ? _hashString(this._seed) : this._seed >>> 0;

    // REPEATING TAG: the watermark now repeats every `cycleSeconds` instead
    // of running as one never-repeating stream for the whole call. Frame f's
    // pattern depends only on (f mod hopsPerCycle) — never on how long the
    // call has been running — so ANY recording at least one cycle long is
    // guaranteed to contain a complete repetition somewhere in it, and the
    // detector only ever needs to search within one cycle, not the whole
    // call. See _randForFrame below.
    this._cycleSeconds = config.cycleSeconds || 8;
    this._hopsPerCycle = Math.max(
      1,
      Math.round((this._cycleSeconds * this.sampleRate) / this._bufferSize)
    );
    this._frameIndex = 0;

    this._numBands = config.numBands || 24;
    this._binToBand = this._buildBinToBandMap(
      this._analysisSize,
      this.sampleRate,
      this._numBands,
    );

    this._re = new Float32Array(this._analysisSize);
    this._im = new Float32Array(this._analysisSize);
    this._pnRe = new Float32Array(this._analysisSize);
    this._pnIm = new Float32Array(this._analysisSize);
    this._bandEnergy = new Float32Array(this._numBands);
    this._bandFlatness = new Float32Array(this._numBands);
    this._bandThreshold = new Float32Array(this._numBands);
  }

  /**
   * Returns a fresh PRNG positioned at the start of this frame's slot
   * within the current cycle. Frame index f and frame index (f +
   * hopsPerCycle) always produce the identical generator here — that's
   * the entire mechanism behind the repeat.
   */
  _randForFrame(frameIndex) {
    const cyclePos = frameIndex % this._hopsPerCycle;
    const jumped = _stateAfterDraws(this._baseSeedState, cyclePos * this._analysisSize);
    return _createMulberry32(jumped);
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

    if (!inputChannel || !outputChannel) return true;

    const frameSize = inputChannel.length;

    this._pushIn(inputChannel);

    while (this._inFilled >= this._bufferSize) {
      const chunk = new Float32Array(this._bufferSize);
      this._pullIn(chunk);
      const processed = this._processChunk(chunk);
      this._pushOut(processed);
    }

    if (
      this._inFilled > 0 &&
      this._inFilled < this._bufferSize &&
      this._outFilled < frameSize
    ) {
      const chunk = new Float32Array(this._bufferSize);
      this._pullIn(chunk.subarray(0, this._inFilled));
      const processed = this._processChunk(chunk);
      this._pushOut(processed);
    }

    if (this._outFilled >= frameSize) {
      this._pullOut(outputChannel);
    } else {
      outputChannel.fill(0);
    }

    return true;
  }

  _processChunk(samples) {
    const N = this._analysisSize;
    const hop = this._bufferSize;

    this._analysisBuf.copyWithin(0, hop);
    this._analysisBuf.set(samples, N - hop);

    for (let i = 0; i < N; i++) {
      this._re[i] = this._analysisBuf[i] * this._window[i];
      this._im[i] = 0;
    }
    _fft(this._re, this._im, false);

    this._bandEnergy.fill(0);
    const bandLogSum = new Float32Array(this._numBands);
    const bandCount = new Float32Array(this._numBands);
    for (let k = 0; k < N / 2; k++) {
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
      this._bandFlatness[b] = geoMean / (arithMean + 1e-12);
      this._bandEnergy[b] = arithMean;
    }

    for (let b = 0; b < this._numBands; b++) {
      const flat = Math.min(Math.max(this._bandFlatness[b], 0), 1);
      const offsetDb = 18 - flat * 12;
      const energyDb = 10 * Math.log10(this._bandEnergy[b] + 1e-12);
      this._bandThreshold[b] = Math.pow(10, (energyDb - offsetDb) / 10);
    }

    for (let b = 0; b < this._numBands; b++) {
      const left = b > 0 ? this._bandThreshold[b - 1] : this._bandThreshold[b];
      const right =
        b < this._numBands - 1
          ? this._bandThreshold[b + 1]
          : this._bandThreshold[b];
      this._bandThreshold[b] =
        0.5 * this._bandThreshold[b] + 0.25 * left + 0.25 * right;
    }

    // Repeating-tag PN generation — this frame's noise pattern comes from
    // its position WITHIN THE CURRENT CYCLE (see _randForFrame), so it's
    // identical every time this cycle position comes back around,
    // regardless of how long the call has been running overall.
    const rand = this._randForFrame(this._frameIndex);
    for (let k = 0; k < N; k++) {
      this._pnRe[k] = rand() * 2 - 1;
      this._pnIm[k] = 0;
    }
    this._frameIndex++;

    _fft(this._pnRe, this._pnIm, false);

    for (let k = 0; k < N / 2; k++) {
      const b = this._binToBand[k];
      const mag =
        Math.sqrt(
          this._pnRe[k] * this._pnRe[k] + this._pnIm[k] * this._pnIm[k],
        ) + 1e-12;
      const gain =
        (Math.sqrt(this._bandThreshold[b]) * this._marginLinear) / mag;
      this._pnRe[k] *= gain;
      this._pnIm[k] *= gain;
      const mirror = (N - k) % N;
      this._pnRe[mirror] = this._pnRe[k];
      this._pnIm[mirror] = -this._pnIm[k];
    }

    _fft(this._pnRe, this._pnIm, true);
    for (let i = 0; i < N; i++) {
      this._pnRe[i] *= this._window[i];
    }

    for (let i = 0; i < N; i++) {
      this._olaAcc[i] += this._pnRe[i];
    }

    const out = new Float32Array(hop);
    for (let i = 0; i < hop; i++) {
      let s = samples[i] + this._olaAcc[i];
      if (s > 1.0) s = 1.0;
      if (s < -1.0) s = -1.0;
      out[i] = s;
    }

    this._olaAcc.copyWithin(0, hop);
    this._olaAcc.fill(0, N - hop);

    return out;
  }
}

registerProcessor("audio-processor", AudioProcessor);
export const DATA_CHANNEL_CHUNK_HEADER_BYTES = 8;
export const DATA_CHANNEL_CHUNK_SIZE = 16 * 1024;
export const DATA_CHANNEL_CHUNK_PAYLOAD_BYTES =
  DATA_CHANNEL_CHUNK_SIZE - DATA_CHANNEL_CHUNK_HEADER_BYTES;

const ensureArrayBuffer = (value, message) => {
  if (!(value instanceof ArrayBuffer)) {
    throw new Error(message);
  }
};

export const encodeChunkFrame = (chunkIndex, totalChunks, payloadBuffer) => {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new Error("Invalid chunk index");
  }

  if (!Number.isInteger(totalChunks) || totalChunks <= 0) {
    throw new Error("Invalid total chunk count");
  }

  ensureArrayBuffer(payloadBuffer, "Chunk payload must be an ArrayBuffer");

  const frame = new ArrayBuffer(DATA_CHANNEL_CHUNK_HEADER_BYTES + payloadBuffer.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, chunkIndex, false);
  view.setUint32(4, totalChunks, false);
  new Uint8Array(frame, DATA_CHANNEL_CHUNK_HEADER_BYTES).set(new Uint8Array(payloadBuffer));
  return frame;
};

export const decodeChunkFrame = (frameBuffer) => {
  ensureArrayBuffer(frameBuffer, "Incoming transfer chunk must be an ArrayBuffer");

  if (frameBuffer.byteLength < DATA_CHANNEL_CHUNK_HEADER_BYTES) {
    throw new Error("Malformed chunk frame: too short");
  }

  const view = new DataView(frameBuffer);
  const chunkIndex = view.getUint32(0, false);
  const totalChunks = view.getUint32(4, false);

  if (totalChunks <= 0) {
    throw new Error("Malformed chunk frame: invalid chunk count");
  }

  if (chunkIndex >= totalChunks) {
    throw new Error("Malformed chunk frame: chunk index out of range");
  }

  return {
    chunkIndex,
    totalChunks,
    payload: frameBuffer.slice(DATA_CHANNEL_CHUNK_HEADER_BYTES),
  };
};

export const splitBufferIntoChunkFrames = (
  buffer,
  payloadSize = DATA_CHANNEL_CHUNK_PAYLOAD_BYTES
) => {
  ensureArrayBuffer(buffer, "Wrapped payload must be an ArrayBuffer");

  if (!Number.isInteger(payloadSize) || payloadSize <= 0) {
    throw new Error("Invalid payload chunk size");
  }

  const totalChunks = Math.ceil(buffer.byteLength / payloadSize) || 1;
  return Array.from({ length: totalChunks }, (_, chunkIndex) => {
    const start = chunkIndex * payloadSize;
    const payload = buffer.slice(start, start + payloadSize);
    return encodeChunkFrame(chunkIndex, totalChunks, payload);
  });
};

export const reassembleChunkFrames = (chunks) => {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("Malformed transfer buffer: no chunks received");
  }

  const totalBytes = chunks.reduce((sum, chunk, index) => {
    ensureArrayBuffer(chunk, `Missing chunk payload at index ${index}`);
    return sum + chunk.byteLength;
  }, 0);

  const joined = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  return joined.buffer;
};
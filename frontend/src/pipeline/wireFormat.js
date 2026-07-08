// Shared between chainEmbed.js and chainReconstruct.js so the two are
// always reading/writing the same layout — see section 0.6.
export const MAGIC = 0x50524f56; // "PROV"
export const VERSION = 1;
export const HEADER_LENGTH = 9; // 4 (magic) + 1 (version) + 4 (uint32 length)
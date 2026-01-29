/**
 * Custom Bech32 implementation for NIP-19
 * Implemented from scratch based on BIP-173 specification
 */

// Bech32 character set (32 characters)
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const CHARSET_MAP: Map<string, number> = new Map(
  CHARSET.split('').map((c, i) => [c, i])
);

// Generator polynomial for checksum
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/**
 * Polymod function for Bech32 checksum calculation
 */
function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATOR[i];
      }
    }
  }
  return chk;
}

/**
 * Expand human-readable part for checksum
 */
function hrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (const c of hrp) {
    result.push(c.charCodeAt(0) >> 5);
  }
  result.push(0);
  for (const c of hrp) {
    result.push(c.charCodeAt(0) & 31);
  }
  return result;
}

/**
 * Create checksum for Bech32 encoding
 */
function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const result: number[] = [];
  for (let i = 0; i < 6; i++) {
    result.push((mod >> (5 * (5 - i))) & 31);
  }
  return result;
}

/**
 * Verify Bech32 checksum
 */
function verifyChecksum(hrp: string, data: number[]): boolean {
  return polymod(hrpExpand(hrp).concat(data)) === 1;
}

/**
 * Convert 8-bit bytes to 5-bit groups
 */
function convertBits8to5(data: Uint8Array): number[] {
  const result: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const byte of data) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result.push((acc >> bits) & 31);
    }
  }

  // Pad remaining bits
  if (bits > 0) {
    result.push((acc << (5 - bits)) & 31);
  }

  return result;
}

/**
 * Convert 5-bit groups to 8-bit bytes
 */
function convertBits5to8(data: number[]): Uint8Array {
  const result: number[] = [];
  let acc = 0;
  let bits = 0;

  for (const value of data) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 255);
    }
  }

  return new Uint8Array(result);
}

/**
 * Encode data to Bech32 string
 */
export function bech32Encode(hrp: string, data: Uint8Array): string {
  const data5bit = convertBits8to5(data);
  const checksum = createChecksum(hrp, data5bit);
  const combined = data5bit.concat(checksum);
  return hrp + '1' + combined.map((d) => CHARSET[d]).join('');
}

/**
 * Decode Bech32 string
 */
export function bech32Decode(str: string): { hrp: string; data: Uint8Array } | null {
  // Bech32 is case-insensitive, convert to lowercase
  const lower = str.toLowerCase();

  // Find separator
  const sepIndex = lower.lastIndexOf('1');
  if (sepIndex < 1 || sepIndex + 7 > lower.length) {
    return null;
  }

  const hrp = lower.slice(0, sepIndex);
  const dataStr = lower.slice(sepIndex + 1);

  // Decode data part
  const data5bit: number[] = [];
  for (const c of dataStr) {
    const value = CHARSET_MAP.get(c);
    if (value === undefined) {
      return null;
    }
    data5bit.push(value);
  }

  // Verify checksum
  if (!verifyChecksum(hrp, data5bit)) {
    return null;
  }

  // Remove checksum (last 6 characters)
  const dataWithoutChecksum = data5bit.slice(0, -6);
  const data = convertBits5to8(dataWithoutChecksum);

  return { hrp, data };
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// NIP-19 specific functions

/**
 * Encode hex pubkey to npub format
 */
export function npubEncode(hex: string): string {
  if (hex.length !== 64) {
    throw new Error('Invalid pubkey length: must be 64 hex characters');
  }
  const bytes = hexToBytes(hex);
  return bech32Encode('npub', bytes);
}

/**
 * Encode event to nevent format (TLV encoding)
 * TLV: Type-Length-Value
 * Type 0: event id (32 bytes)
 */
export function neventEncode(event: { id: string; relays?: string[]; author?: string }): string {
  const tlvParts: number[] = [];

  // Type 0: event id (required)
  if (event.id.length !== 64) {
    throw new Error('Invalid event id length: must be 64 hex characters');
  }
  const idBytes = hexToBytes(event.id);
  tlvParts.push(0); // type
  tlvParts.push(32); // length
  tlvParts.push(...idBytes);

  // Type 1: relay (optional, can be multiple)
  if (event.relays) {
    for (const relay of event.relays) {
      const relayBytes = new TextEncoder().encode(relay);
      tlvParts.push(1); // type
      tlvParts.push(relayBytes.length); // length
      tlvParts.push(...relayBytes);
    }
  }

  // Type 2: author pubkey (optional)
  if (event.author) {
    if (event.author.length !== 64) {
      throw new Error('Invalid author pubkey length: must be 64 hex characters');
    }
    const authorBytes = hexToBytes(event.author);
    tlvParts.push(2); // type
    tlvParts.push(32); // length
    tlvParts.push(...authorBytes);
  }

  return bech32Encode('nevent', new Uint8Array(tlvParts));
}

/**
 * Decode NIP-19 bech32 string
 */
export function nip19Decode(str: string): { type: string; data: string } | null {
  const decoded = bech32Decode(str);
  if (!decoded) {
    return null;
  }

  const { hrp, data } = decoded;

  if (hrp === 'npub') {
    // npub: 32-byte pubkey
    if (data.length !== 32) {
      return null;
    }
    return { type: 'npub', data: bytesToHex(data) };
  }

  if (hrp === 'nsec') {
    // nsec: 32-byte secret key
    if (data.length !== 32) {
      return null;
    }
    return { type: 'nsec', data: bytesToHex(data) };
  }

  if (hrp === 'note') {
    // note: 32-byte event id
    if (data.length !== 32) {
      return null;
    }
    return { type: 'note', data: bytesToHex(data) };
  }

  if (hrp === 'nevent') {
    // nevent: TLV encoded
    // For simplicity, just extract the event id (type 0)
    let i = 0;
    while (i < data.length) {
      const type = data[i];
      const length = data[i + 1];
      if (type === 0 && length === 32) {
        const idBytes = data.slice(i + 2, i + 2 + 32);
        return { type: 'nevent', data: bytesToHex(idBytes) };
      }
      i += 2 + length;
    }
    return null;
  }

  // Unknown type
  return null;
}

/**
 * Tests for custom Bech32/NIP-19 implementation
 * Compares results with nostr-tools for validation
 */

import { nip19 } from 'nostr-tools';
import {
  npubEncode,
  neventEncode,
  nip19Decode,
  hexToBytes,
  bytesToHex,
} from '../src/nostr/bech32';

// Test utilities
let passed = 0;
let failed = 0;

function assertEqual(actual: unknown, expected: unknown, testName: string): void {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr === expectedStr) {
    console.log(`✓ ${testName}`);
    passed++;
  } else {
    console.log(`✗ ${testName}`);
    console.log(`  Expected: ${expectedStr}`);
    console.log(`  Actual:   ${actualStr}`);
    failed++;
  }
}

function assertThrows(fn: () => void, testName: string): void {
  try {
    fn();
    console.log(`✗ ${testName} (expected to throw but didn't)`);
    failed++;
  } catch {
    console.log(`✓ ${testName}`);
    passed++;
  }
}

// Generate random hex string
function randomHex(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

console.log('=== Bech32/NIP-19 Tests ===\n');

// ========================================
// 1. npubEncode tests
// ========================================
console.log('--- npubEncode tests ---');

// Boundary test: All zeros
{
  const hex = '0'.repeat(64);
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, 'npubEncode: all zeros');
}

// Boundary test: All ones (ff)
{
  const hex = 'f'.repeat(64);
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, 'npubEncode: all ff');
}

// Boundary test: Alternating pattern
{
  const hex = 'aa'.repeat(32);
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, 'npubEncode: alternating aa');
}

{
  const hex = '55'.repeat(32);
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, 'npubEncode: alternating 55');
}

// Known value test (from actual Nostr usage)
{
  const hex = '4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee';
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, 'npubEncode: known pubkey');
}

// Random tests
console.log('\n--- npubEncode random tests (10 iterations) ---');
for (let i = 0; i < 10; i++) {
  const hex = randomHex(64);
  const ours = npubEncode(hex);
  const theirs = nip19.npubEncode(hex);
  assertEqual(ours, theirs, `npubEncode: random #${i + 1}`);
}

// Error test: wrong length
assertThrows(() => npubEncode('abc'), 'npubEncode: throws on short input');
assertThrows(() => npubEncode('0'.repeat(63)), 'npubEncode: throws on 63 chars');
assertThrows(() => npubEncode('0'.repeat(65)), 'npubEncode: throws on 65 chars');

// ========================================
// 2. neventEncode tests
// ========================================
console.log('\n--- neventEncode tests ---');

// Basic test: event id only
{
  const id = '0'.repeat(64);
  const ours = neventEncode({ id });
  const theirs = nip19.neventEncode({ id });
  assertEqual(ours, theirs, 'neventEncode: all zeros');
}

{
  const id = 'f'.repeat(64);
  const ours = neventEncode({ id });
  const theirs = nip19.neventEncode({ id });
  assertEqual(ours, theirs, 'neventEncode: all ff');
}

// Known value test
{
  const id = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const ours = neventEncode({ id });
  const theirs = nip19.neventEncode({ id });
  assertEqual(ours, theirs, 'neventEncode: known event id');
}

// Random tests
console.log('\n--- neventEncode random tests (10 iterations) ---');
for (let i = 0; i < 10; i++) {
  const id = randomHex(64);
  const ours = neventEncode({ id });
  const theirs = nip19.neventEncode({ id });
  assertEqual(ours, theirs, `neventEncode: random #${i + 1}`);
}

// Error test
assertThrows(() => neventEncode({ id: 'abc' }), 'neventEncode: throws on short id');

// ========================================
// 3. nip19Decode tests (npub only - actual usage)
// ========================================
console.log('\n--- nip19Decode tests ---');

// Decode all zeros npub
{
  const hex = '0'.repeat(64);
  const npub = nip19.npubEncode(hex);
  const ours = nip19Decode(npub);
  const theirs = nip19.decode(npub);
  assertEqual(ours?.type, theirs.type, 'nip19Decode: all zeros type');
  assertEqual(ours?.data, theirs.data, 'nip19Decode: all zeros data');
}

// Decode all ff npub
{
  const hex = 'f'.repeat(64);
  const npub = nip19.npubEncode(hex);
  const ours = nip19Decode(npub);
  const theirs = nip19.decode(npub);
  assertEqual(ours?.type, theirs.type, 'nip19Decode: all ff type');
  assertEqual(ours?.data, theirs.data, 'nip19Decode: all ff data');
}

// Decode known npub
{
  const hex = '4c5d5379a066339c88f6e101e3edb1fbaee4ede3eea35ffc6f1c664b3a4383ee';
  const npub = nip19.npubEncode(hex);
  const ours = nip19Decode(npub);
  const theirs = nip19.decode(npub);
  assertEqual(ours?.type, theirs.type, 'nip19Decode: known npub type');
  assertEqual(ours?.data, theirs.data, 'nip19Decode: known npub data');
}

// Random tests
console.log('\n--- nip19Decode random tests (10 iterations) ---');
for (let i = 0; i < 10; i++) {
  const hex = randomHex(64);
  const npub = nip19.npubEncode(hex);
  const ours = nip19Decode(npub);
  const theirs = nip19.decode(npub);
  assertEqual(ours?.type, theirs.type, `nip19Decode: random #${i + 1} type`);
  assertEqual(ours?.data, theirs.data, `nip19Decode: random #${i + 1} data`);
}

// Invalid input tests
assertEqual(nip19Decode('invalid'), null, 'nip19Decode: invalid string returns null');
assertEqual(nip19Decode('npub1invalid'), null, 'nip19Decode: invalid checksum returns null');

// ========================================
// 4. Round-trip tests
// ========================================
console.log('\n--- Round-trip tests ---');

// npub round-trip
for (let i = 0; i < 5; i++) {
  const originalHex = randomHex(64);
  const encoded = npubEncode(originalHex);
  const decoded = nip19Decode(encoded);
  assertEqual(decoded?.data, originalHex, `Round-trip npub #${i + 1}`);
}

// ========================================
// 5. hexToBytes / bytesToHex tests
// ========================================
console.log('\n--- hex conversion tests ---');

assertEqual(bytesToHex(hexToBytes('00')), '00', 'hexToBytes/bytesToHex: 00');
assertEqual(bytesToHex(hexToBytes('ff')), 'ff', 'hexToBytes/bytesToHex: ff');
assertEqual(bytesToHex(hexToBytes('deadbeef')), 'deadbeef', 'hexToBytes/bytesToHex: deadbeef');
assertEqual(
  bytesToHex(hexToBytes('0'.repeat(64))),
  '0'.repeat(64),
  'hexToBytes/bytesToHex: 64 zeros'
);

// ========================================
// Summary
// ========================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

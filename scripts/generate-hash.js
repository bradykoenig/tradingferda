/**
 * Run this script once to generate the PBKDF2 hash for the worker secret.
 * Usage: node scripts/generate-hash.js
 * Then set the output as your Cloudflare Worker secret:
 *   cd worker && npx wrangler secret put PASSWORD_HASH
 */

const { subtle } = require('crypto').webcrypto ?? globalThis.crypto;

const PASSWORD = 'ferda';
const SALT = 'schlima-site-v1-salt';

async function generateHash() {
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(PASSWORD),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(SALT), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hash = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  console.log('\n=== SCHLIMA PASSWORD HASH ===');
  console.log(hash);
  console.log('\nRun the following to set your worker secrets:');
  console.log('  cd worker');
  console.log('  npx wrangler secret put PASSWORD_HASH');
  console.log('  (paste the hash above when prompted)');
  console.log('  npx wrangler secret put JWT_SECRET');
  console.log('  (enter any long random string as the JWT secret)');
  console.log('==============================\n');
}

generateHash().catch(console.error);

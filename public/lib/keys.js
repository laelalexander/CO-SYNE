// Device-held Ed25519 keys via WebCrypto. The private key never leaves the
// browser; the server only ever sees the public key and signatures.
import { credentialPayload } from '../canonical.js';

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function generateHolderKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

export async function signText(privateJwk, text) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
  return b64url(await crypto.subtle.sign({ name: 'Ed25519' }, key, enc.encode(text)));
}

export async function verifyText(publicJwk, text, signature) {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x }, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64url(signature), enc.encode(text));
  } catch {
    return false;
  }
}

// Independent on-device check of a credential against the published trust
// registry, so the driver does not have to take the server's word for it.
export async function verifyCredentialLocally(credential, registry) {
  const issuer = registry.find((i) => i.id === credential?.issuer);
  if (!issuer) return { ok: false, reason: 'issuer not in trust registry' };
  if (issuer.issues !== credential.type) return { ok: false, reason: 'issuer cannot issue this credential type' };
  if (Date.parse(credential.expiresAt) < Date.now()) return { ok: false, reason: 'credential expired' };
  const ok = await verifyText(issuer.publicJwk, credentialPayload(credential), credential.proof?.sig);
  return ok ? { ok: true, issuer: issuer.name } : { ok: false, reason: 'issuer signature invalid' };
}

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function webCryptoEd25519Supported() {
  return crypto?.subtle && window.isSecureContext;
}

const storeKey = (role) => `cosyne:identity:${role}`;
export function loadIdentity(role) {
  try { return JSON.parse(localStorage.getItem(storeKey(role))); } catch { return null; }
}
export function saveIdentity(role, data) {
  try { localStorage.setItem(storeKey(role), JSON.stringify(data)); } catch { /* private mode: identity lasts this tab only */ }
}
export function clearIdentity(role) {
  try { localStorage.removeItem(storeKey(role)); } catch { /* ignore */ }
}

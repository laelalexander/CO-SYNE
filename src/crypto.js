import {
  generateKeyPairSync, createPublicKey, createPrivateKey, sign, verify, createHash, randomBytes,
} from 'node:crypto';

export function generateKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicJwk: publicKey.export({ format: 'jwk' }),
    privateJwk: privateKey.export({ format: 'jwk' }),
  };
}

// Strip a JWK down to the public Ed25519 fields so private material never leaks.
export function publicOnly(jwk) {
  return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
}

export function signText(privateJwk, text) {
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  return sign(null, Buffer.from(text), key).toString('base64url');
}

export function verifyText(publicJwk, text, signature) {
  try {
    if (!publicJwk?.x || typeof signature !== 'string') return false;
    const key = createPublicKey({ key: publicOnly(publicJwk), format: 'jwk' });
    return verify(null, Buffer.from(text), key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const randomId = (prefix, bytes = 8) => `${prefix}_${randomBytes(bytes).toString('hex')}`;
export const nonce = () => randomBytes(18).toString('base64url');

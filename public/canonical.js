// Deterministic JSON serialization shared by the server and the browser.
// Signatures and ledger hashes are always computed over this form, so both
// sides must produce byte-identical output for the same value.
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => JSON.stringify(k) + ':' + canonicalize(value[k]))
    .join(',') + '}';
}

// The exact message each party signs to prove they hold the key named in
// their credential during a traffic stop.
export function stopChallengeMessage(stopId, nonce, role) {
  return `CO-SYNE/stop/v1|${stopId}|${nonce}|${role}`;
}

// The credential body that the issuer signs (everything except the proof).
export function credentialPayload(credential) {
  const { proof, ...body } = credential;
  return canonicalize(body);
}

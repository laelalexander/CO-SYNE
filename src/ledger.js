import fs from 'node:fs';
import path from 'node:path';
import { canonicalize } from '../public/canonical.js';
import { sha256, signText, verifyText } from './crypto.js';

export const GENESIS = '0'.repeat(64);

// Append-only, hash-chained, signed event log. Each entry commits to the
// previous entry's hash, so editing, deleting, or reordering any past entry
// breaks every hash after it. Each hash is also signed by the ledger key, so
// an attacker who rewrites the file cannot re-chain it without that key.
export class Ledger {
  constructor({ file, signer }) {
    this.file = file;
    this.signer = signer;
    this.entries = [];
    this.listeners = new Set();
    if (file) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file)) {
        this.entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      }
    }
  }

  static hashEntry({ seq, ts, type, ref, data, prevHash }) {
    return sha256(canonicalize({ seq, ts, type, ref, data, prevHash }));
  }

  head() {
    return this.entries.at(-1)?.hash ?? GENESIS;
  }

  append(type, data, ref = null) {
    const body = { seq: this.entries.length, ts: new Date().toISOString(), type, ref, data, prevHash: this.head() };
    const hash = Ledger.hashEntry(body);
    const entry = { ...body, hash, sig: signText(this.signer.privateJwk, hash) };
    this.entries.push(entry);
    if (this.file) fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    for (const fn of this.listeners) fn(entry);
    return entry;
  }

  onAppend(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list({ ref, limit = 200 } = {}) {
    const items = ref ? this.entries.filter((e) => e.ref === ref) : this.entries;
    return items.slice(-limit);
  }

  verify(entries = this.entries) {
    let prev = GENESIS;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.seq !== i) return { ok: false, length: entries.length, brokenAt: i, reason: 'sequence gap or reorder' };
      if (e.prevHash !== prev) return { ok: false, length: entries.length, brokenAt: i, reason: 'chain link mismatch' };
      if (Ledger.hashEntry(e) !== e.hash) return { ok: false, length: entries.length, brokenAt: i, reason: 'entry contents altered' };
      if (!verifyText(this.signer.publicJwk, e.hash, e.sig)) return { ok: false, length: entries.length, brokenAt: i, reason: 'bad ledger signature' };
      prev = e.hash;
    }
    return { ok: true, length: entries.length, head: prev };
  }
}

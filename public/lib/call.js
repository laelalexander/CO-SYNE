// A live session (video + voice + text) in a stop or alert room, rendered
// into any container. Each app styles the tiles for its own layout.
import { VideoRoom, startRecording } from './rtc.js';
import { sha256Hex } from './keys.js';
import { esc } from './ui.js';

export class Call {
  constructor({ session, room, iceServers, container, label, onChat, onPeers, mic = true, camera = true }) {
    Object.assign(this, { session, room, container, onChat, onPeers });
    this.peers = new Map();
    this.micOn = mic;
    this.camOn = camera;
    this.recorder = null;
    this.vr = new VideoRoom({
      socket: session.socket, room, iceServers, label,
      onTile: (id, stream, info) => this.tile(id, stream, info),
      onLeave: (id) => this.untile(id),
      onChat: (m) => this.onChat?.(m),
    });
  }

  async start() {
    await this.vr.start();
    this.applyTracks();
    return this;
  }

  get stream() { return this.vr.stream; }

  tile(id, stream, info = {}) {
    let el = this.container.querySelector(`[data-peer="${id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = `tile ${id === 'local' ? 'self' : ''}`;
      el.dataset.peer = id;
      el.dataset.role = id === 'local' ? 'self' : info.role ?? 'peer';
      el.innerHTML = `<video autoplay playsinline ${id === 'local' ? 'muted' : ''}></video><span class="tag">${esc(id === 'local' ? 'You' : info.name ?? 'Participant')}${info.role && id !== 'local' ? ` · ${esc(info.callsign ?? info.role)}` : ''}</span>`;
      if (id === 'local') this.container.append(el); else this.container.prepend(el);
    }
    const v = el.querySelector('video');
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play().catch(() => {
      // Autoplay with sound was blocked: play muted and offer a tap to unmute.
      v.muted = true; v.play().catch(() => {});
      if (id !== 'local' && !el.querySelector('.unmute')) {
        const b = Object.assign(document.createElement('button'), { className: 'unmute', textContent: 'Tap for sound' });
        b.onclick = () => { v.muted = false; v.play(); b.remove(); };
        el.append(b);
      }
    });
    if (id !== 'local') { this.peers.set(id, info); this.onPeers?.([...this.peers.values()]); }
  }

  untile(id) {
    this.container.querySelector(`[data-peer="${id}"]`)?.remove();
    if (this.peers.delete(id)) this.onPeers?.([...this.peers.values()]);
  }

  applyTracks() {
    for (const t of this.stream?.getAudioTracks() ?? []) t.enabled = this.micOn;
    for (const t of this.stream?.getVideoTracks() ?? []) t.enabled = this.camOn;
  }
  toggleMic() { this.micOn = !this.micOn; this.applyTracks(); return this.micOn; }
  toggleCam() { this.camOn = !this.camOn; this.applyTracks(); return this.camOn; }

  chat(text) { if (text.trim()) this.vr.chat(text.trim()); }

  get recording() { return Boolean(this.recorder); }
  startRecording() { this.recorder = startRecording(this.stream); }
  // Stops recording, keeps the file on this device, and anchors its SHA-256
  // in the evidence ledger.
  async stopRecording() {
    const stop = this.recorder; this.recorder = null;
    if (!stop) return null;
    const { blob, durationSec } = await stop();
    const sha256 = await sha256Hex(blob);
    const ref = this.room.split(':')[1];
    const { entry } = await this.session.api('POST', '/api/evidence', { ref, sha256, kind: 'video', bytes: blob.size, durationSec });
    return { blob, sha256, entry, durationSec, url: URL.createObjectURL(blob) };
  }

  leave() {
    if (this.recorder) this.stopRecording().catch(() => {});
    this.vr.stop();
    this.container.querySelectorAll('.tile').forEach((t) => t.remove());
  }
}

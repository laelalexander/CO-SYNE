// Mesh WebRTC room. The server only relays offers/answers/ICE candidates; the
// media itself flows peer to peer. The newcomer sends offers to everyone
// already in the room, which avoids offer collisions.
export class VideoRoom {
  constructor({ socket, room, iceServers, onTile, onLeave, onChat, label }) {
    Object.assign(this, { socket, room, iceServers, onTile, onLeave, onChat, label });
    this.peers = new Map(); // peerId -> { pc, info }
    this.off = socket.on((msg) => this.handle(msg));
  }

  async start() {
    this.stream = await getLocalStream(this.label);
    this.onTile('local', this.stream, { name: 'You', role: 'self' });
    this.socket.send({ t: 'join', room: this.room });
  }

  connection(peerId, info) {
    let entry = this.peers.get(peerId);
    if (entry) return entry.pc;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(peerId, { candidate: e.candidate }); };
    pc.ontrack = (e) => this.onTile(peerId, e.streams[0], this.peers.get(peerId)?.info ?? info);
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this.drop(peerId); };
    entry = { pc, info };
    this.peers.set(peerId, entry);
    return pc;
  }

  signal(to, data) { this.socket.send({ t: 'signal', room: this.room, to, data }); }

  async handle(msg) {
    if (msg.room !== this.room) return;
    if (msg.t === 'room_peers') {
      for (const p of msg.peers) {
        const pc = this.connection(p.id, p);
        await pc.setLocalDescription(await pc.createOffer());
        this.signal(p.id, { sdp: pc.localDescription });
      }
    } else if (msg.t === 'peer_joined') {
      this.connection(msg.peer.id, msg.peer);
    } else if (msg.t === 'peer_left') {
      this.drop(msg.peer);
    } else if (msg.t === 'signal') {
      const pc = this.connection(msg.from);
      const { sdp, candidate } = msg.data ?? {};
      if (sdp) {
        await pc.setRemoteDescription(sdp);
        if (sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.signal(msg.from, { sdp: pc.localDescription });
        }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch { /* candidate raced the description */ }
      }
    } else if (msg.t === 'chat') {
      this.onChat?.(msg);
    } else if (msg.t === 'chat_history') {
      for (const m of msg.messages) this.onChat?.(m);
    }
  }

  chat(text) { this.socket.send({ t: 'chat', room: this.room, text }); }

  drop(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    this.peers.delete(peerId);
    this.onLeave(peerId);
  }

  stop() {
    this.socket.send({ t: 'leave', room: this.room });
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.onLeave('local');
    this.off();
  }
}

// Camera + mic when allowed; otherwise a generated test pattern (labelled
// with who is sending it) so the call and evidence recording still work on
// computers without a camera.
export async function getLocalStream(label = 'CO-SYNE') {
  let cam = null;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
    return cam;
  } catch { /* fall back below */ }
  let audio = null;
  try { audio = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* no mic either */ }
  const canvas = Object.assign(document.createElement('canvas'), { width: 960, height: 540 });
  const ctx = canvas.getContext('2d');
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 960, 540);
    g.addColorStop(0, '#1b1e23'); g.addColorStop(1, '#0d0f12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 960, 540);
    ctx.strokeStyle = '#c9a54a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(480, 220, 70, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e6e8eb'; ctx.font = '600 34px Segoe UI, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, 480, 350);
    ctx.fillStyle = '#9aa2ad'; ctx.font = '22px Segoe UI, system-ui, sans-serif';
    ctx.fillText(`No camera on this device · ${new Date().toLocaleTimeString()}`, 480, 392);
    ctx.fillStyle = '#c9a54a'; ctx.font = '700 46px Segoe UI, system-ui, sans-serif';
    ctx.fillText(label.split(/\s+/).filter((w) => !/^(officer|deputy|dispatch)$/i.test(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase(), 480, 237);
  };
  draw();
  const timer = setInterval(draw, 1000);
  const stream = canvas.captureStream(15);
  stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
  stream.simulatedCamera = true;
  for (const t of audio?.getAudioTracks() ?? []) stream.addTrack(t);
  return stream;
}

// Records the local stream; returns a stop() that resolves to the Blob.
export function startRecording(stream) {
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const startedAt = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(1000);
  return () => new Promise((resolve) => {
    rec.onstop = () => resolve({ blob: new Blob(chunks, { type: rec.mimeType || 'video/webm' }), durationSec: Math.round((Date.now() - startedAt) / 1000) });
    rec.stop();
  });
}

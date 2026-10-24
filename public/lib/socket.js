// WebSocket session with challenge-response sign-in and auto-reconnect.
export class Socket {
  constructor(url, buildHello) {
    this.url = url;
    this.buildHello = buildHello; // async (nonce, resumeToken) => hello message
    this.listeners = new Set();
    this.queue = [];
    this.token = null;
    this.closed = false;
    this.open();
  }

  open() {
    this.ws = new WebSocket(this.url);
    this.ready = false;
    this.ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.t === 'challenge') {
        try {
          this.ws.send(JSON.stringify(await this.buildHello(msg.nonce, this.token)));
        } catch (err) {
          for (const fn of this.listeners) fn({ t: 'error', error: err.message, ref: 'hello' });
        }
        return;
      }
      if (msg.t === 'hello_ok') {
        this.token = msg.token;
        this.ready = true;
        for (const m of this.queue.splice(0)) this.ws.send(JSON.stringify(m));
      }
      for (const fn of this.listeners) fn(msg);
    };
    this.ws.onclose = () => {
      const was = this.ready;
      this.ready = false;
      for (const fn of this.listeners) fn({ t: 'disconnected', was });
      if (!this.closed) setTimeout(() => this.open(), 1500);
    };
  }

  send(msg) {
    if (this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    this.closed = true;
    this.ws.close();
  }
}

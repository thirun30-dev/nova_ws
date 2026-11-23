// Minimal rosbridge v2 client (JSON over WebSocket). No roslib dependency.
// Supports subscribe (with throttle), advertise/publish, call_service, auto-reconnect.

export class Rosbridge {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.subs = new Map(); // topic -> { type, opts, handlers:Set }
    this.adverts = new Map(); // topic -> type
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.listeners = { open: new Set(), close: new Set(), error: new Set() };
    this.seq = 0;
    this.reconnect = true;
    this.retryTimer = null;
  }

  on(event, cb) {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  emit(event, arg) {
    this.listeners[event].forEach((cb) => cb(arg));
  }

  connect() {
    clearTimeout(this.retryTimer);
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.emit('error', err);
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      for (const [topic, type] of this.adverts) this.send({ op: 'advertise', topic, type });
      for (const [topic, s] of this.subs) this.sendSubscribe(topic, s);
      this.emit('open');
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('connection closed'));
      }
      this.pending.clear();
      if (was) this.emit('close');
      this.scheduleRetry();
    };
    ws.onerror = (e) => this.emit('error', e);
    ws.onmessage = (ev) => this.handle(ev.data);
  }

  scheduleRetry() {
    if (!this.reconnect) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), 2500);
  }

  close() {
    this.reconnect = false;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.connected = false;
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  handle(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.op === 'publish') {
      const s = this.subs.get(msg.topic);
      if (s) s.handlers.forEach((cb) => cb(msg.msg));
    } else if (msg.op === 'service_response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.result === false) p.reject(new Error(typeof msg.values === 'string' ? msg.values : 'service failed'));
      else p.resolve(msg.values || {});
    } else if (msg.op === 'status' && msg.level === 'error') {
      console.warn('[rosbridge]', msg.msg);
    }
  }

  sendSubscribe(topic, s) {
    this.send({
      op: 'subscribe',
      id: `sub:${topic}`,
      topic,
      type: s.type,
      throttle_rate: s.opts.throttle || 0,
      queue_length: s.opts.queue ?? 1,
    });
  }

  subscribe(topic, type, cb, opts = {}) {
    let s = this.subs.get(topic);
    if (!s) {
      s = { type, opts, handlers: new Set() };
      this.subs.set(topic, s);
      if (this.connected) this.sendSubscribe(topic, s);
    }
    s.handlers.add(cb);
    return () => {
      s.handlers.delete(cb);
      if (!s.handlers.size) {
        this.subs.delete(topic);
        this.send({ op: 'unsubscribe', id: `sub:${topic}`, topic });
      }
    };
  }

  publish(topic, type, msg) {
    if (this.adverts.get(topic) !== type) {
      this.adverts.set(topic, type);
      this.send({ op: 'advertise', topic, type });
    }
    return this.send({ op: 'publish', topic, msg });
  }

  call(service, type, args = {}, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const id = `call:${service}:${++this.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${service} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ op: 'call_service', id, service, type, args })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('not connected'));
      }
    });
  }
}

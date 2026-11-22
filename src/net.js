import Peer from 'peerjs';

const PREFIX = 'simufam-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

// Pantalla (TV/PC): recibe al mando
export class HostLink {
  constructor({ onInput, onMsg, onStatus }) {
    this.onInput = onInput; this.onMsg = onMsg; this.onStatus = onStatus;
    this.rel = null; this.unrel = null;
    this.open();
  }
  open(tries = 0) {
    this.code = sessionStorage.getItem('simu-code') || genCode();
    const peer = new Peer(PREFIX + this.code, { debug: 0 });
    this.peer = peer;
    peer.on('open', () => { sessionStorage.setItem('simu-code', this.code); this.onStatus?.('ready', this.code); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries < 5) { sessionStorage.removeItem('simu-code'); peer.destroy(); this.open(tries + 1); }
      else this.onStatus?.('error', e.type);
    });
    peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 1000));
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        if (conn.label === 'u') this.unrel = conn; else { this.rel = conn; this.onStatus?.('connected'); }
      });
      conn.on('data', (d) => (d && d.t === 'in' ? this.onInput?.(d) : this.onMsg?.(d)));
      conn.on('close', () => { if (conn === this.rel) { this.rel = null; this.onStatus?.('lost'); } if (conn === this.unrel) this.unrel = null; });
    });
  }
  get connected() { return !!(this.rel && this.rel.open); }
  send(msg) { if (this.rel && this.rel.open) this.rel.send(msg); }
  sendFast(msg) { const c = this.unrel && this.unrel.open ? this.unrel : this.rel; if (c && c.open) c.send(msg); }
}

// Celular (mando)
export class PadLink {
  constructor(code, { onMsg, onStatus }) {
    this.code = code.toUpperCase(); this.onMsg = onMsg; this.onStatus = onStatus;
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => this.connect());
    this.peer.on('error', (e) => { this.onStatus?.('error', e.type); if (e.type === 'peer-unavailable') setTimeout(() => this.connect(), 2500); });
    this.peer.on('disconnected', () => setTimeout(() => !this.peer.destroyed && this.peer.reconnect(), 1000));
  }
  connect() {
    this.onStatus?.('connecting');
    const id = PREFIX + this.code;
    const rel = this.peer.connect(id, { label: 'r', reliable: true, serialization: 'json' });
    const unrel = this.peer.connect(id, { label: 'u', reliable: false, serialization: 'json' });
    rel.on('open', () => { this.rel = rel; this.onStatus?.('connected'); rel.send({ t: 'hello', ua: navigator.userAgent }); });
    rel.on('data', (d) => this.onMsg?.(d));
    unrel.on('data', (d) => this.onMsg?.(d));
    unrel.on('open', () => (this.unrel = unrel));
    rel.on('close', () => { this.rel = null; this.onStatus?.('lost'); setTimeout(() => this.connect(), 1500); });
  }
  send(msg) { if (this.rel && this.rel.open) this.rel.send(msg); }
  sendFast(msg) { const c = this.unrel && this.unrel.open ? this.unrel : this.rel; if (c && c.open) c.send(msg); }
}

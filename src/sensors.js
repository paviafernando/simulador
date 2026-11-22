// Lee la orientación del celular y la convierte en ejes de control relativos a la posición "centrada".
import { Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);

export class MotionSensor {
  constructor() {
    this.q = new Quaternion(); this.q0 = null; this.has = false;
    this.out = { steer: 0, tilt: 0, yaw: 0, look: 0 };
    this._qa = new Quaternion(); this._qb = new Quaternion(); this._qc = new Quaternion();
    this.onOri = (e) => this.handle(e);
  }

  async start() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) { return false; }
    window.addEventListener('deviceorientation', this.onOri);
    return true;
  }

  handle(e) {
    if (e.alpha == null && e.beta == null) return;
    const a = (e.alpha || 0) * DEG, b = (e.beta || 0) * DEG, g = (e.gamma || 0) * DEG;
    // W3C: R = Rz(alpha) * Rx(beta) * Ry(gamma)
    this._qa.setFromAxisAngle(AZ, a); this._qb.setFromAxisAngle(AX, b); this._qc.setFromAxisAngle(AY, g);
    this.q.copy(this._qa).multiply(this._qb).multiply(this._qc);
    if (!this.has) { this.has = true; this.calibrate(); }
    this.compute();
  }

  calibrate() { this.q0 = this.q.clone(); this.compute(); }

  compute() {
    if (!this.q0) return;
    const rel = this.q0.clone().invert().multiply(this.q); // rotación en el marco del equipo al calibrar
    if (rel.w < 0) { rel.x = -rel.x; rel.y = -rel.y; rel.z = -rel.z; rel.w = -rel.w; }
    const ang = 2 * Math.acos(Math.min(1, rel.w));
    const s = Math.sqrt(1 - rel.w * rel.w) || 1;
    const v = new Vector3(rel.x / s, rel.y / s, rel.z / s).multiplyScalar(ang);
    const so = (screen.orientation && screen.orientation.angle) ?? (window.orientation || 0);
    const r = so * DEG;
    const right = new Vector3(Math.cos(r), -Math.sin(r), 0);
    const up = new Vector3(Math.sin(r), Math.cos(r), 0);
    const sx = v.dot(right), sy = v.dot(up), sz = v.z;
    // steer: girar como volante (derecha positivo); tilt: borde superior hacia adelante positivo
    this.out.steer = -sz; this.out.tilt = -sx; this.out.yaw = sy; this.out.look = sx;
  }
}

// Vibración: Android usa navigator.vibrate; en iPhone (Safari 18+) usamos el truco del switch nativo.
let iosLabel = null;
export function haptic(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); return; } catch (e) {} }
  if (!iosLabel) {
    iosLabel = document.createElement('label');
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.setAttribute('switch', '');
    iosLabel.appendChild(inp); iosLabel.style.cssText = 'position:fixed;left:-100px;opacity:0;pointer-events:none';
    document.body.appendChild(iosLabel);
  }
  const arr = Array.isArray(pattern) ? pattern : [pattern];
  let t = 0;
  for (let i = 0; i < arr.length; i += 2) {
    const n = Math.max(1, Math.round(arr[i] / 60));
    for (let k = 0; k < n; k++) setTimeout(() => iosLabel.click(), t + k * 60);
    t += arr[i] + (arr[i + 1] || 0);
  }
}

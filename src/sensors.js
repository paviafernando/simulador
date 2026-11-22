// Lee la orientación del celular y la convierte en ejes de control.
// Volante e inclinación salen de la GRAVEDAD (no derivan, no dependen de la brújula).
// La "posición de sostener" (horizontal izq/der) se fija al centrar, así que si el sistema
// gira la pantalla a vertical en medio del juego, el control sigue igual.
import { Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const AX = new Vector3(1, 0, 0), AY = new Vector3(0, 1, 0), AZ = new Vector3(0, 0, 1);
const clamp1 = (x) => Math.max(-1, Math.min(1, x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const screenAngle = () => ((screen.orientation && screen.orientation.angle) ?? (window.orientation || 0) + 360) % 360;

export class MotionSensor {
  constructor() {
    this.q = new Quaternion(); this.q0 = null; this.has = false;
    this.up = new Vector3(0, 1, 0); this.u0 = null;
    this.angle = 90; // cómo se sostiene el celu (0, 90, 180, 270) — se fija al centrar
    this.out = { steer: 0, tilt: 0, yaw: 0, look: 0 };
    this._qa = new Quaternion(); this._qb = new Quaternion(); this._qc = new Quaternion();
    this.onOri = (e) => this.handle(e);
    this.listeners = [];
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
    if (e.beta == null && e.gamma == null) return;
    const a = (e.alpha || 0) * DEG, b = (e.beta || 0) * DEG, g = (e.gamma || 0) * DEG;
    // vector "arriba" del mundo expresado en ejes del equipo (x derecha, y arriba, z hacia el usuario)
    this.up.set(-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g));
    this._qa.setFromAxisAngle(AZ, a); this._qb.setFromAxisAngle(AX, b); this._qc.setFromAxisAngle(AY, g);
    this.q.copy(this._qa).multiply(this._qb).multiply(this._qc);
    if (!this.has) { this.has = true; this.calibrate(); }
    this.compute();
  }

  toScreen(v, angle = this.angle) {
    const r = angle * DEG;
    const right = new Vector3(Math.cos(r), -Math.sin(r), 0), up = new Vector3(Math.sin(r), Math.cos(r), 0);
    return new Vector3(v.dot(right), v.dot(up), v.z);
  }

  /** Toma la posición actual como "derecho". Detecta cómo se está sosteniendo el celu. */
  calibrate() {
    const u = this.up;
    if (Math.hypot(u.x, u.y) > 0.35) {
      const a = Math.atan2(u.x, u.y) / DEG; // 0 vertical normal, 90 = girado a la izquierda, -90 = a la derecha
      this.angle = ((Math.round(a / 90) * 90) + 360) % 360;
    } else this.angle = screenAngle();
    this.q0 = this.q.clone();
    this.u0 = this.toScreen(u);
    this.compute();
    this.listeners.forEach((f) => f());
  }

  get landscape() { return this.angle === 90 || this.angle === 270; }

  compute() {
    if (!this.u0) return;
    const s = this.toScreen(this.up), s0 = this.u0;
    // volante: girar el celu en su plano (o inclinarlo a los costados si está acostado)
    this.out.steer = -(Math.asin(clamp1(s.x)) - Math.asin(clamp1(s0.x)));
    // inclinación: borde superior hacia adelante = positivo
    this.out.tilt = wrap(Math.atan2(s.z, s.y) - Math.atan2(s0.z, s0.y));
    // mirar alrededor (montaña rusa): rotación relativa completa
    const rel = this.q0.clone().invert().multiply(this.q);
    if (rel.w < 0) { rel.x = -rel.x; rel.y = -rel.y; rel.z = -rel.z; rel.w = -rel.w; }
    const ang = 2 * Math.acos(Math.min(1, rel.w)), sn = Math.sqrt(1 - rel.w * rel.w) || 1;
    const v = this.toScreen(new Vector3(rel.x / sn, rel.y / sn, rel.z / sn).multiplyScalar(ang));
    this.out.yaw = v.y; this.out.look = v.x;
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

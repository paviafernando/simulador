import * as THREE from 'three';

const FWD = new THREE.Vector3(0, 0, 1), RIGHT = new THREE.Vector3(-1, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const WY = new THREE.Vector3(0, 1, 0), LEFT = new THREE.Vector3(1, 0, 0);

// Física arcade de vuelo compartida (avión y lechuza). El modelo mira hacia +Z.
export class Flyer {
  constructor(obj, o = {}) {
    this.obj = obj;
    this.o = Object.assign({ minSpeed: 25, maxSpeed: 110, cruise: 55, rollRate: 2.0, pitchRate: 1.2, turn: 1.1, gravity: 0.6, autoLevel: 1.2, accel: 14, stall: 18 }, o);
    this.speed = this.o.cruise; this.target = this.o.cruise;
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.bank = 0; this.gload = 1; this.boost = 0;
    this._q = new THREE.Quaternion(); this._prevFwd = new THREE.Vector3(0, 0, 1);
  }
  axes() {
    const q = this.obj.quaternion;
    this.fwd.copy(FWD).applyQuaternion(q); this.right.copy(RIGHT).applyQuaternion(q); this.up.copy(UP).applyQuaternion(q);
  }
  update(dt, inp, extraLift = 0) {
    const o = this.o, obj = this.obj;
    this.axes();
    let steer = THREE.MathUtils.clamp(inp.steer, -1, 1), pitch = THREE.MathUtils.clamp(inp.pitch, -1, 1);
    if (inp.assist) {
      // Modo asistido: la inclinación del celu ES la actitud del avión (alabeo máx 55°, cabeceo máx 30°)
      const bankNow = Math.asin(THREE.MathUtils.clamp(-this.right.y, -1, 1));
      const pitchNow = Math.asin(THREE.MathUtils.clamp(this.fwd.y, -1, 1));
      const upside = this.up.y < 0;
      steer = THREE.MathUtils.clamp((steer * 0.96 - bankNow) * 2.6 / o.rollRate * 2, -1, 1);
      pitch = THREE.MathUtils.clamp((pitch * 0.52 - pitchNow) * 3 / o.pitchRate, -1, 1);
      if (upside) steer = -Math.sign(bankNow || 1);
    }
    // alabeo y cabeceo locales
    obj.rotateOnAxis(FWD, steer * o.rollRate * dt);
    obj.rotateOnAxis(LEFT, -pitch * o.pitchRate * dt); // pitch>0 = nariz arriba
    this.axes();
    this.bank = -this.right.y; // >0 alabeo a la derecha
    // giro inducido por alabeo (guiñada sobre eje Y mundial)
    const yaw = -this.bank * o.turn * dt * (0.6 + 0.4 * Math.min(1, this.speed / o.cruise));
    this._q.setFromAxisAngle(WY, yaw); obj.quaternion.premultiply(this._q);
    // auto-nivelado suave
    if (!inp.assist && Math.abs(steer) < 0.15) obj.rotateOnAxis(FWD, -this.bank * o.autoLevel * dt);
    // evitar invertir de más: limitar alabeo
    this.axes();
    if (this.up.y < 0.15 && Math.abs(steer) < 0.5) obj.rotateOnAxis(FWD, -Math.sign(this.bank) * 1.5 * dt);
    // velocidad
    this.target = THREE.MathUtils.clamp(this.target + (inp.gas - inp.brake) * o.accel * 1.5 * dt, o.minSpeed, o.maxSpeed);
    let tgt = this.target + this.boost;
    this.speed += (tgt - this.speed) * Math.min(1, dt * 0.8);
    this.speed -= this.fwd.y * 9.8 * o.gravity * dt; // trepar cuesta, picar acelera
    this.speed = THREE.MathUtils.clamp(this.speed, o.minSpeed * 0.6, o.maxSpeed * 1.5);
    this.boost = Math.max(0, this.boost - dt * 12);
    obj.position.addScaledVector(this.fwd, this.speed * dt);
    // pérdida de sustentación si va lento
    const sink = Math.max(0, o.stall - this.speed) * 0.6 - extraLift;
    obj.position.y -= sink * dt;
    // carga G aproximada
    const turnRate = this._prevFwd.angleTo(this.fwd) / Math.max(dt, 1e-3);
    this.gload += (1 + (this.speed * turnRate) / 9.8 - this.gload) * Math.min(1, dt * 4);
    this._prevFwd.copy(this.fwd);
  }
}

// Cámara de persecución suave
export class ChaseCam {
  constructor(camera, { dist = 18, height = 5, look = 25, stiff = 4, roll = 0.35 } = {}) {
    Object.assign(this, { camera, dist, height, look, stiff, roll });
    this.pos = camera.position.clone(); this.upv = new THREE.Vector3(0, 1, 0); this.init = false;
  }
  update(dt, target, fwd, up, speedFov = 0) {
    const desired = target.clone().addScaledVector(fwd, -this.dist).addScaledVector(WY, this.height).addScaledVector(up, this.height * 0.3);
    if (!this.init) { this.pos.copy(desired); this.init = true; }
    this.pos.lerp(desired, 1 - Math.exp(-dt * this.stiff));
    this.camera.position.copy(this.pos);
    const wantUp = WY.clone().lerp(up, this.roll).normalize();
    this.upv.lerp(wantUp, 1 - Math.exp(-dt * 3));
    this.camera.up.copy(this.upv);
    this.camera.lookAt(target.clone().addScaledVector(fwd, this.look));
    const fov = 68 + speedFov;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 2); this.camera.updateProjectionMatrix();
  }
}

export function ringMesh(radius = 12, color = 0xffc23a) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.09, 12, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, metalness: 0.8, roughness: 0.25 }));
  const inner = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.92, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false }));
  g.add(t, inner);
  g.userData.radius = radius;
  return g;
}

export function arrowMesh(color = 0x4dfcff) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.2); shape.lineTo(1.4, 0); shape.lineTo(0.5, 0); shape.lineTo(0.5, -1.6); shape.lineTo(-0.5, -1.6); shape.lineTo(-0.5, 0); shape.lineTo(-1.4, 0); shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
  geo.rotateX(Math.PI / 2); geo.translate(0, 0, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false }));
  m.renderOrder = 20;
  return m;
}

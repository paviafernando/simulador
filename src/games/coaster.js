import * as THREE from 'three';
import { makeNoise, smoothstep } from '../engine/noise.js';
import { buildTerrain, naturalColor, scatterTrees, buildClouds, buildWater, Particles, getDot } from '../engine/terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function trackPoints() {
  const pts = [V(-10, 3, 0), V(10, 3, 0), V(30, 3, 0), V(50, 7, 0), V(80, 34, 0), V(108, 60, 0), V(122, 65, 0), V(135, 60, 0),
    V(156, 26, 0), V(172, 6, 3), V(198, 4, 14), V(222, 14, 36), V(230, 27, 62), V(218, 33, 88), V(193, 29, 101), V(163, 17, 101), V(136, 5, 95)];
  // rizo vertical
  const cx = 104, cy = 21, r = 17;
  for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; pts.push(V(cx - r * Math.sin(a), cy - r * Math.cos(a), 93 - 11 * (i / 9))); }
  pts.push(V(80, 4, 80), V(52, 8, 74), V(28, 19, 66), V(5, 6, 56), V(-22, 5, 46), V(-52, 9, 30), V(-70, 15, 6), V(-62, 19, -18), V(-40, 10, -26), V(-30, 4, -8));
  return pts;
}

function frames(curve, step = 0.5) {
  const L = curve.getLength(), M = Math.ceil(L / step);
  const P = [], T = [], U = [];
  for (let i = 0; i <= M; i++) { const u = (i % M) / M; P.push(curve.getPointAt(u)); T.push(curve.getTangentAt(u).normalize()); }
  // marcos de rotación mínima (doble reflexión)
  let up = V(0, 1, 0); up.sub(T[0].clone().multiplyScalar(up.dot(T[0]))).normalize(); U.push(up.clone());
  for (let i = 0; i < M; i++) {
    const v1 = P[i + 1].clone().sub(P[i]); const c1 = v1.dot(v1) || 1e-6;
    const rL = U[i].clone().sub(v1.clone().multiplyScalar((2 / c1) * v1.dot(U[i])));
    const tL = T[i].clone().sub(v1.clone().multiplyScalar((2 / c1) * v1.dot(T[i])));
    const v2 = T[i + 1].clone().sub(tL); const c2 = v2.dot(v2) || 1e-6;
    U.push(rL.sub(v2.clone().multiplyScalar((2 / c2) * v2.dot(rL))).normalize());
  }
  // corregir torsión del cierre
  const a = Math.atan2(T[0].clone().cross(U[0]).dot(U[M]), U[0].dot(U[M]));
  for (let i = 0; i <= M; i++) U[i].applyAxisAngle(T[i], -a * (i / M));
  return { P, T, U, M, L, step };
}

// Simula el recorrido para conocer la velocidad real en cada punto y peraltar acorde
function simulate(F, sCrest) {
  const vel = new Float32Array(F.M + 1);
  let s = 0, v = 3; const dt = 0.02;
  while (s < F.L) {
    const i = Math.min(F.M, Math.floor(s / F.step));
    v += (-9.8 * F.T[i].y - 0.1 - 0.0011 * v * v) * dt;
    if (s < sCrest) v = Math.max(v, s < 40 ? 4 : 5.5);
    v = Math.max(v, 2.5);
    if (s > F.L - 55) v = Math.min(v, Math.max(0.8, Math.sqrt(Math.max(0, 2 * 2.2 * (F.L + 2 - s)))));
    vel[i] = v; s += v * dt;
  }
  for (let i = 1; i <= F.M; i++) if (!vel[i]) vel[i] = vel[i - 1];
  return vel;
}

function applyBank(F, vel) {
  const { P, T, U, M, step } = F;
  const bank = new Float32Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const ip = (i + 2) % M, im = (i - 2 + M) % M;
    const k = T[ip].clone().sub(T[im]).divideScalar(4 * step);
    const right = T[i].clone().cross(U[i]);
    const v2 = vel[i % M] ** 2;
    bank[i] = THREE.MathUtils.clamp(Math.atan2(v2 * k.dot(right), 9.8), -1.2, 1.2) * smoothstep(0.6, 0.95, U[i].y);
  }
  const sm = new Float32Array(M + 1), W = 20;
  for (let i = 0; i <= M; i++) { let s = 0; for (let j = -W; j <= W; j++) s += bank[(i + j + M) % M]; sm[i] = s / (2 * W + 1); }
  for (let i = 0; i <= M; i++) U[i].applyAxisAngle(T[i], sm[i]);
  F.R = U.map((u, i) => T[i].clone().cross(u).normalize());
}

function tube(centers, radius, seg = 8) {
  const n = centers.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const { c, u, r } = centers[i];
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; const v = c.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(r, Math.sin(a) * radius); pos.push(v.x, v.y, v.z); }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
    const a = i * seg + k, b = i * seg + ((k + 1) % seg), c = (i + 1) * seg + k, d = (i + 1) * seg + ((k + 1) % seg);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function buildCar(color, front) {
  const bars = !front;
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.4, roughness: 0.3, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
  const seat = new THREE.MeshStandardMaterial({ color: 0x1b1b2a, roughness: 0.7 });
  const shape = new THREE.Shape(); shape.moveTo(-1.1, 0); shape.lineTo(1.1, 0); shape.lineTo(1.2, 0.5); shape.quadraticCurveTo(1.25, 0.95, 0.8, 1.0); shape.lineTo(-0.8, 1.0); shape.quadraticCurveTo(-1.25, 0.95, -1.2, 0.5); shape.closePath();
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3 }), paint);
  body.position.z = -1.0; body.position.y = 0.25; g.add(body);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 1.5), seat); hole.position.set(0, 1.1, -0.1); g.add(hole);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.2), seat); back.position.set(0, 1.5, -0.8); g.add(back);
  const bar = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 16, Math.PI), dark); bar.position.set(-0.45, 1.35, 0.35); if (bars) { g.add(bar); const bar2 = bar.clone(); bar2.position.x = 0.45; g.add(bar2); }
  if (front) { const nose = new THREE.Mesh(new THREE.SphereGeometry(0.9, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), paint); nose.rotation.x = Math.PI / 2; nose.scale.set(1.25, 0.9, 0.6); nose.position.set(0, 0.75, 1.15); g.add(nose); }
  [-0.6, 0.6].forEach((x) => [-0.7, 0.7].forEach((z) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 12), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.1, z); g.add(w); }));
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

function ferrisWheel() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 0.8, roughness: 0.3 });
  const wheel = new THREE.Group(); wheel.position.y = 32; g.add(wheel);
  const R = 26;
  [-1.5, 1.5].forEach((z) => { const t = new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 8, 64), steel); t.position.z = z; wheel.add(t); });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), 96);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < 96; i++) { const a = (i / 48) * Math.PI * 2; m.makeTranslation(Math.cos(a) * R, Math.sin(a) * R, i < 48 ? 1.9 : -1.9); bulbs.setMatrixAt(i, m); bulbs.setColorAt(i, c.setHSL((i % 48) / 48, 1, 0.6).multiplyScalar(3)); }
  wheel.add(bulbs);
  const gondolas = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, R, 6), steel); sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2; wheel.add(sp);
    const gd = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.2, 2.2, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 16, 0.7, 0.55), roughness: 0.4 }));
    const holder = new THREE.Group(); holder.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); gd.position.y = -1.8; holder.add(gd); wheel.add(holder); gondolas.push(holder);
  }
  [-1, 1].forEach((s) => [-4, 4].forEach((z) => { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 36, 8), steel); leg.position.set(s * 9, 16, z); leg.rotation.z = s * 0.27; g.add(leg); }));
  g.userData.update = (dt) => { wheel.rotation.z += dt * 0.08; gondolas.forEach((h) => (h.rotation.z = -wheel.rotation.z)); };
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export default class CoasterGame {
  constructor({ world, synth, fx, hud }) {
    Object.assign(this, { world, synth, fx, hud });
    const scene = world.scene;
    world.setupAtmosphere({ mode: 'sunset', elevation: 5, azimuth: 250, fog: 0.0016, fogColor: 0xd89a7a, exposure: 0.42, shadowRange: 90, bloom: { strength: 0.55, radius: 0.5, threshold: 0.9 } });
    const N = makeNoise(5);
    const lake = (x, z) => 1 - smoothstep(40, 90, Math.hypot(x - 90, z + 150));
    const H = (x, z) => {
      const r = Math.hypot(x - 80, z - 40);
      let h = 1 + N.fbm(x * 0.01, z * 0.01, 3) * 1.2;
      h += smoothstep(300, 700, r) * (40 + N.fbm(x * 0.003, z * 0.003, 4) * 70 + Math.pow(N.ridged(x * 0.002, z * 0.002, 4), 2) * 160);
      return h - lake(x, z) * 9;
    };
    this.H = H;
    scene.add(buildTerrain({ size: 3600, segments: world.q.segments, heightFn: H, colorFn: naturalColor(N, { waterLevel: -2, snowLine: 9999 }) }));
    this.water = buildWater(world, { level: -2, color: 0x2a4f66, sunColor: 0xffc080, size: 3000 }); scene.add(this.water);
    scene.add(scatterTrees({ count: Math.floor(2500 * world.q.trees), area: 1600, center: new THREE.Vector2(80, 40), heightFn: H, rnd: N.rnd, kind: 'round',
      palette: [0x4e7a2c, 0x6a8a2a, 0x3f6a26, 0x7a8f35, 0x9a7a2a], scale: [1, 1.8],
      accept: (x, z, y) => y > -1 && !this.nearTrack(x, z, 9), castShadow: world.q.shadows }));
    scene.add(buildClouds({ count: Math.floor(30 * world.q.clouds), area: 4000, height: [300, 500], tint: 0xffd2b0, shade: 0x8a6a8a, rnd: N.rnd, puffSize: 110 }));

    // pista
    const curve = new THREE.CatmullRomCurve3(trackPoints(), true, 'centripetal');
    const F = frames(curve, 0.5); this.F = F;
    this.sCrest = 0; { let my = -1; for (let i = 0; i < F.M * 0.45; i++) if (F.P[i].y > my) { my = F.P[i].y; this.sCrest = i * F.step; } }
    applyBank(F, simulate(F, this.sCrest));
    const rails = [], spine = [];
    for (let i = 0; i <= F.M; i += 2) {
      const c = F.P[i], u = F.U[i], r = F.R[i];
      rails.push([{ c: c.clone().addScaledVector(r, 0.62), u, r }, { c: c.clone().addScaledVector(r, -0.62), u, r }]);
      spine.push({ c: c.clone().addScaledVector(u, -0.45), u, r });
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0xd9dde6, metalness: 0.9, roughness: 0.25 });
    const spineMat = new THREE.MeshStandardMaterial({ color: 0xe0362c, metalness: 0.5, roughness: 0.35 });
    [0, 1].forEach((k) => { const m = new THREE.Mesh(tube(rails.map((x) => x[k]), 0.1, 8), railMat); m.castShadow = true; scene.add(m); });
    const sp = new THREE.Mesh(tube(spine, 0.28, 10), spineMat); sp.castShadow = true; scene.add(sp);
    // durmientes, soportes y luces
    const nTies = Math.floor(F.M / 3);
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.12, 0.22), spineMat, nTies);
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), nTies);
    const supGeo = new THREE.CylinderGeometry(0.22, 0.32, 1, 8); supGeo.translate(0, -0.5, 0);
    const sups = new THREE.InstancedMesh(supGeo, new THREE.MeshStandardMaterial({ color: 0xb9bcc6, metalness: 0.7, roughness: 0.45 }), Math.floor(F.M / 12));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let ns = 0;
    for (let k = 0, i = 0; k < nTies; k++, i += 3) {
      const b = new THREE.Matrix4().makeBasis(F.R[i], F.U[i], F.T[i]); q.setFromRotationMatrix(b);
      m.compose(F.P[i].clone().addScaledVector(F.U[i], -0.12), q, V(1, 1, 1)); ties.setMatrixAt(k, m);
      m.compose(F.P[i].clone().addScaledVector(F.R[i], (k % 2 ? 1 : -1) * 0.95), q, V(1, 1, 1)); lights.setMatrixAt(k, m);
      lights.setColorAt(k, col.setHSL((k * 0.013) % 1, 1, 0.6).multiplyScalar(4));
      if (i % 12 === 0 && F.U[i].y > 0.75) {
        const top = F.P[i].clone().addScaledVector(F.U[i], -0.6); const gy = H(top.x, top.z);
        if (top.y - gy > 1.2) { m.compose(top, new THREE.Quaternion(), V(1, top.y - gy + 0.5, 1)); sups.setMatrixAt(ns++, m); }
      }
    }
    sups.count = ns; sups.castShadow = true; ties.castShadow = true;
    scene.add(ties, lights, sups);
    // estación
    const st = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.BoxGeometry(32, 0.6, 9), new THREE.MeshStandardMaterial({ color: 0x2b5fd0, roughness: 0.5 })); roof.position.set(10, 9.5, 0); st.add(roof);
    const plat = new THREE.Mesh(new THREE.BoxGeometry(32, 2.4, 3), new THREE.MeshStandardMaterial({ color: 0xc9b38a })); plat.position.set(10, 1.5, 3); st.add(plat);
    [-5, 10, 25].forEach((x) => [-4, 4].forEach((z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9), new THREE.MeshStandardMaterial({ color: 0xffffff })); c.position.set(x, 4.8, z); st.add(c); }));
    const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 0.3), new THREE.MeshStandardMaterial({ color: 0xff3366, emissive: 0xff2255, emissiveIntensity: 1.5 })); sign.position.set(10, 11.2, 0); st.add(sign);
    st.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true));
    scene.add(st);
    this.ferris = ferrisWheel(); this.ferris.position.set(-60, H(-60, 140), 140); this.ferris.rotation.y = 0.5; scene.add(this.ferris);
    // carpas de colores
    for (let i = 0; i < 8; i++) {
      const x = -120 + i * 22, z = -70 - (i % 2) * 18;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(6, 7, 12), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 8, 0.8, 0.55), roughness: 0.6 }));
      tent.position.set(x, H(x, z) + 6.5, z); tent.castShadow = true; scene.add(tent);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 3.2, 12), new THREE.MeshStandardMaterial({ color: 0xfaf3e0 })); base.position.set(x, H(x, z) + 1.6, z); scene.add(base);
    }

    // tren
    this.cars = [];
    const colors = [0xffcc00, 0x00b4ff, 0xff4d6d, 0x7cff4d];
    for (let i = 0; i < 4; i++) { const c = buildCar(colors[i], i === 0); scene.add(c); this.cars.push(c); }
    // brazos (primera persona)
    this.arms = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: 0xe0a77d, roughness: 0.7 });
    const sleeve = new THREE.MeshStandardMaterial({ color: 0x2c74ff, roughness: 0.8 });
    [-0.5, 0.5].forEach((x) => { const a = new THREE.Group(); a.position.set(x, -1.1, -0.9);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.6), sleeve); up.position.y = 0.3; a.add(up);
      const fo = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.5), skin); fo.position.y = 0.82; a.add(fo);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), skin); h.position.y = 1.1; a.add(h);
      a.rotation.z = -x * 0.5; this.arms.add(a); });
    world.camera.add(this.arms); scene.add(world.camera);
    this.armUp = 0;

    this.particles = new Particles(scene, 600, { size: 0.6 });
    this.s = 2; this.v = 0; this.state = 'station'; this.dwell = 3; this.laps = 0; this.maxG = 0; this.maxV = 0;
    this.camMode = 0; this.clickD = 0; this.prevFelt = 1; this.air = 0; this.look = { y: 0, p: 0 };
    this.rail = synth.noiseLoop('rail', { type: 'lowpass', freq: 300, q: 0.8, vol: 0.7 });
    this.windL = synth.noiseLoop('wind', { type: 'bandpass', freq: 500, q: 0.5, vol: 0.5 });
    this.say('🎢 Mové el celular para mirar alrededor · ARRANCAR para salir', 4);
  }
  nearTrack(x, z, d) {
    if (!this.F) { // antes de crear la pista: usar puntos de control
      return trackPoints().some((p) => Math.hypot(p.x - x, p.z - z) < d * 2.2) || Math.hypot(x - 10, z) < 25 || Math.hypot(x + 60, z - 140) < 40;
    }
    return false;
  }
  say(t, d = 2) { this.hud.C.innerHTML = `<div class="msg">${t}</div>`; this.msgT = d; }

  sample(s) {
    const F = this.F; s = ((s % F.L) + F.L) % F.L;
    const f = s / F.step, i = Math.floor(f) % F.M, j = (i + 1) % F.M, t = f - Math.floor(f);
    return { p: F.P[i].clone().lerp(F.P[j], t), T: F.T[i].clone().lerp(F.T[j], t).normalize(), U: F.U[i].clone().lerp(F.U[j], t).normalize(), i };
  }

  update(dt, inp) {
    const F = this.F, world = this.world;
    this.ferris.userData.update(dt);
    this.water.userData.animate(dt);
    this.particles.update(dt);
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    if (inp.bPressed) this.camMode = (this.camMode + 1) % 2;

    // física
    const a = this.sample(this.s);
    if (this.state === 'station') {
      this.v = 0; this.dwell -= dt;
      if (inp.gas > 0 || inp.aPressed || this.dwell <= 0) { this.state = 'ride'; this.v = 3; this.fx.sound('horn', 'tv'); this.fx.vibrate([60, 60, 60]); }
    } else {
      let acc = -9.8 * a.T.y - 0.1 - 0.0011 * this.v * this.v;
      this.v += acc * dt;
      if (this.s < this.sCrest) { this.v = Math.max(this.v, this.s < 40 ? 4 : 5.5); this.chain = true; } else this.chain = false;
      this.v = Math.max(this.v, 2.5);
      if (this.s > F.L - 55) { const target = Math.max(0.8, Math.sqrt(Math.max(0, 2 * 2.2 * (F.L + 2 - this.s)))); this.v = Math.min(this.v, Math.max(target, this.v - 6 * dt)); }
      this.s += this.v * dt;
      if (this.s >= F.L + 2) { this.s -= F.L; this.state = 'station'; this.dwell = 4; this.laps++; this.say(`🎉 ¡Vuelta ${this.laps}! Velocidad máx ${Math.round(this.maxV * 3.6)} km/h · G máx ${this.maxG.toFixed(1)}`, 4); this.fx.sound('win'); }
    }
    const b = this.sample(this.s);
    // g-fuerzas sentidas
    const c = this.sample(this.s + 1.5), d = this.sample(this.s - 1.5);
    const k = c.T.clone().sub(d.T).divideScalar(3);
    const felt = (this.v * this.v * k.dot(b.U) + 9.8 * b.U.y) / 9.8;
    this.maxG = Math.max(this.maxG, felt); this.maxV = Math.max(this.maxV, this.v);
    if (felt < 0.3 && this.state === 'ride' && this.air <= 0) { this.air = 1.2; this.fx.vibrate([30, 30, 30, 30, 30]); this.fx.sound('whee', 'pad'); }
    this.air -= dt;

    // carritos
    this.cars.forEach((car, i) => {
      const sm = this.sample(this.s - i * 2.6);
      const right = sm.T.clone().cross(sm.U).normalize();
      car.matrix.makeBasis(right.negate(), sm.U, sm.T); car.matrix.setPosition(sm.p.clone().addScaledVector(sm.U, 0.05));
      car.matrix.decompose(car.position, car.quaternion, car.scale);
    });

    // cámara
    const cam = world.camera;
    this.look.y += (inp.yaw * 1.7 - this.look.y) * Math.min(1, dt * 8);
    this.look.p += (inp.look * 1.1 - this.look.p) * Math.min(1, dt * 8);
    if (this.camMode === 0) {
      const right = b.T.clone().cross(b.U).normalize();
      const base = new THREE.Matrix4().makeBasis(right, b.U, b.T.clone().negate());
      const q = new THREE.Quaternion().setFromRotationMatrix(base);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.look.p, this.look.y, 0, 'YXZ')));
      const shake = Math.min(1, this.v / 30) * 0.012 + (this.chain ? 0.003 : 0);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0)));
      cam.quaternion.slerp(q, Math.min(1, dt * 20));
      cam.position.copy(b.p).addScaledVector(b.U, 1.75 + (felt - 1) * -0.03).addScaledVector(b.T, 0.1);
      cam.fov += (78 + Math.min(14, this.v * 0.35) - cam.fov) * Math.min(1, dt * 2); cam.updateProjectionMatrix();
      this.arms.visible = true;
    } else {
      const off = b.p.clone().addScaledVector(b.T, -18).addScaledVector(b.U, 6).add(V(0, 4, 0));
      cam.position.lerp(off, Math.min(1, dt * 3)); cam.up.set(0, 1, 0); cam.lookAt(b.p);
      this.arms.visible = false;
    }
    const raise = inp.a > 0 || inp.brake > 0 ? 1 : 0;
    if (inp.aPressed) { this.fx.sound('whee'); this.fx.vibrate([200, 50, 200]); }
    this.armUp += (raise - this.armUp) * Math.min(1, dt * 6);
    this.arms.visible = this.arms.visible && this.armUp > 0.03;
    this.arms.children.forEach((arm, i) => { arm.rotation.x = -0.2 + this.armUp * 0.1; arm.position.y = -1.6 + this.armUp * 0.9; arm.rotation.z = (i ? -1 : 1) * 0.35; });
    world.followShadow(b.p);

    // sonido y vibración
    if (this.chain && this.state === 'ride') { this.clickD += this.v * dt; if (this.clickD > 0.9) { this.clickD = 0; this.synth.play('click'); this.fx.vibrate(15); } }
    this.rail.set(this.state === 'ride' ? Math.min(1, this.v / 25) : 0, 150 + this.v * 18);
    this.windL.set(Math.min(1, this.v / 30) ** 1.5, 300 + this.v * 30);
    const rumble = this.state === 'ride' ? Math.min(1, 0.08 + this.v / 70 + Math.abs(felt - 1) * 0.12) : 0;
    this.fx.rumble(this.chain ? 0.1 : rumble);
    if (this.v > 25 && Math.random() < 0.3) this.particles.emit(this.cars[3].position, 1, { speed: 2, color: 0xffcc66, life: 0.4 });

    this.hud.L.innerHTML = `<div class="g"><b>${Math.round(this.v * 3.6)}</b> km/h</div><div class="g">G <b>${felt.toFixed(1)}</b></div><div class="g">${Math.round(b.p.y)} m</div>`;
    this.hud.R.innerHTML = `<div class="g">🎢 Vueltas <b>${this.laps}</b></div><div class="g">Máx ${Math.round(this.maxV * 3.6)} km/h</div><div class="g">G máx ${this.maxG.toFixed(1)}</div>`;
    if (this.state === 'station' && this.msgT <= 0) this.say(`Salida en ${Math.ceil(this.dwell)}… (ARRANCAR para salir ya)`, 0.3);
  }
  padHud() { return `${Math.round(this.v * 3.6)} km/h · Vueltas ${this.laps}`; }
  dispose() { this.world.camera.remove(this.arms); }
}

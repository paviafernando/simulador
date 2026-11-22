import * as THREE from 'three';
import { makeNoise, smoothstep } from '../engine/noise.js';
import { buildTerrain, naturalColor, scatterTrees, buildClouds, Particles } from '../engine/terrain.js';
import { fmt } from './plane.js';

const ROAD_W = 16;

function roadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#3a3c40'; g.fillRect(0, 0, 256, 1024);
  const img = g.getImageData(0, 0, 256, 1024);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 34; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(60, 0, 40, 1024); g.fillRect(156, 0, 40, 1024); // huellas
  g.fillStyle = '#f2f2f2'; g.fillRect(14, 0, 6, 1024); g.fillRect(236, 0, 6, 1024);
  g.fillStyle = '#f5d300'; for (let y = 0; y < 1024; y += 128) g.fillRect(125, y, 6, 70);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function checkerTexture(n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const s = 128 / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#fff'; g.fillRect(i * s, j * s, s, s); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildCarModel(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0f18, metalness: 0.9, roughness: 0.05, clearcoat: 1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 1, roughness: 0.2 });
  // perfil lateral (z adelante)
  const s = new THREE.Shape();
  s.moveTo(-2.3, 0.35); s.lineTo(2.25, 0.35); s.quadraticCurveTo(2.45, 0.4, 2.4, 0.7); s.lineTo(2.1, 0.92);
  s.quadraticCurveTo(1.2, 1.0, 0.6, 1.05); s.quadraticCurveTo(0.1, 1.5, -0.9, 1.45); s.quadraticCurveTo(-1.8, 1.35, -2.2, 1.05); s.lineTo(-2.35, 0.7); s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: true, bevelSize: 0.14, bevelThickness: 0.14, bevelSegments: 4, curveSegments: 16 });
  geo.translate(0, 0, -0.85); geo.rotateY(-Math.PI / 2);
  const body = new THREE.Mesh(geo, paint); g.add(body);
  // vidrios
  const ws = new THREE.Shape(); ws.moveTo(0.55, 1.07); ws.quadraticCurveTo(0.1, 1.45, -0.85, 1.42); ws.quadraticCurveTo(-1.6, 1.33, -1.95, 1.08); ws.closePath();
  const wg = new THREE.ExtrudeGeometry(ws, { depth: 1.86, bevelEnabled: false }); wg.translate(0, 0.02, -0.93); wg.rotateY(-Math.PI / 2);
  g.add(new THREE.Mesh(wg, glass));
  // luces
  const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff1010, emissiveIntensity: 2.5 });
  [-0.62, 0.62].forEach((x) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.1), head); h.position.set(x, 0.75, 2.42); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.1), tail); t.position.set(x, 0.85, -2.42); g.add(t);
  });
  g.userData.tail = tail;
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.4), black); spoiler.position.set(0, 1.35, -2.05); g.add(spoiler);
  [-0.8, 0.8].forEach((x) => { const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), black); p.position.set(x, 1.2, -2.0); g.add(p); });
  // ruedas
  const wheels = [];
  const tyreG = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 24); tyreG.rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(0.26, 0.26, 0.34, 12); rimG.rotateZ(Math.PI / 2);
  [[1, 1.45], [-1, 1.45], [1, -1.45], [-1, -1.45]].forEach(([sx, z]) => {
    const steer = new THREE.Group(); steer.position.set(sx * 0.92, 0.4, z);
    const spin = new THREE.Group(); spin.add(new THREE.Mesh(tyreG, black)); spin.add(new THREE.Mesh(rimG, rim));
    for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.06), rim); sp.rotation.x = (k / 5) * Math.PI; sp.position.x = sx * 0.02; spin.add(sp); }
    steer.add(spin); g.add(steer); wheels.push({ steer, spin, front: z > 0 });
  });
  g.userData.wheels = wheels;
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  return g;
}

export default class RaceGame {
  constructor({ world, synth, fx, hud }) {
    Object.assign(this, { world, synth, fx, hud });
    const scene = world.scene;
    world.setupAtmosphere({ mode: 'day', elevation: 35, azimuth: 120, fog: 0.0007, exposure: 0.5, shadowRange: 70, bloom: { strength: 0.35, threshold: 0.85 } });
    const N = makeNoise(42);
    const base = (x, z) => N.fbm(x * 0.0018, z * 0.0018, 4) * 18 + smoothstep(700, 1500, Math.hypot(x, z)) * (60 + Math.pow(N.ridged(x * 0.0012, z * 0.0012, 5), 2) * 380);
    // trazado
    const ctrl = [];
    const K = 16;
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2;
      const r = 430 + N.fbm(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 2) * 220 + (i % 4 === 1 ? -120 : 0);
      ctrl.push(new THREE.Vector3(Math.cos(a) * r * 1.25, 0, Math.sin(a) * r));
    }
    ctrl.forEach((p) => (p.y = base(p.x, p.z)));
    // suavizar alturas
    const ys = ctrl.map((p, i) => (ctrl[(i - 1 + K) % K].y + p.y * 2 + ctrl[(i + 1) % K].y) / 4); ctrl.forEach((p, i) => (p.y = ys[i]));
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    const L = curve.getLength(), M = Math.ceil(L / 2);
    const P = [], T = [], Rt = [];
    for (let i = 0; i < M; i++) { const u = i / M; P.push(curve.getPointAt(u)); const t = curve.getTangentAt(u); t.y = 0; t.normalize(); T.push(t); Rt.push(new THREE.Vector3(-t.z, 0, t.x)); } // Rt = derecha
    this.P = P; this.T = T; this.R = Rt; this.M = M; this.L = L;
    // grilla para búsqueda del punto más cercano
    this.grid = new Map();
    P.forEach((p, i) => { const k = `${Math.floor(p.x / 40)},${Math.floor(p.z / 40)}`; (this.grid.get(k) || this.grid.set(k, []).get(k)).push(i); });
    const H = (x, z) => {
      const n = this.nearest(x, z, 2);
      const h0 = base(x, z);
      if (!n) return h0;
      const t = smoothstep(ROAD_W / 2 + 3, ROAD_W / 2 + 45, n.d);
      return THREE.MathUtils.lerp(n.y - 0.25, h0, t);
    };
    this.H = H;
    scene.add(buildTerrain({ size: 4000, segments: world.q.segments, heightFn: H, colorFn: naturalColor(N, { waterLevel: -999, snowLine: 330 }) }));
    // asfalto
    const pos = [], uv = [], idx = [];
    let acc = 0;
    for (let i = 0; i <= M; i++) {
      const k = i % M, p = P[k], r = Rt[k];
      if (i > 0) acc += P[k].distanceTo(P[(k - 1 + M) % M]);
      const l = p.clone().addScaledVector(r, -ROAD_W / 2), rr = p.clone().addScaledVector(r, ROAD_W / 2);
      pos.push(l.x, p.y + 0.05, l.z, rr.x, p.y + 0.05, rr.z); uv.push(0, acc / 24, 1, acc / 24);
      if (i < M) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    const roadNormalsUp = rg.attributes.normal; for (let i = 0; i < roadNormalsUp.count; i++) if (roadNormalsUp.getY(i) < 0) { idx.reverse(); break; }
    rg.setIndex(idx); rg.computeVertexNormals();
    const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.85, metalness: 0.05 }));
    road.receiveShadow = true; scene.add(road);
    // pianitos (curbs) rojo/blanco
    const curbG = new THREE.BoxGeometry(1.2, 0.18, 2.1);
    const curbs = new THREE.InstancedMesh(curbG, new THREE.MeshStandardMaterial({ roughness: 0.6 }), M * 2);
    const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < M; i++) [-1, 1].forEach((sd, j) => {
      const p = P[i].clone().addScaledVector(Rt[i], sd * (ROAD_W / 2 + 0.55)); p.y += 0.06;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(T[i].x, T[i].z)); mm.compose(p, q, new THREE.Vector3(1, 1, 1));
      curbs.setMatrixAt(i * 2 + j, mm); curbs.setColorAt(i * 2 + j, c.set(i % 2 ? 0xd62020 : 0xf4f4f4));
    });
    curbs.receiveShadow = true; scene.add(curbs);
    // línea de largada + pórtico
    const chk = checkerTexture(); chk.repeat.set(8, 1);
    const sl = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 3), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.7 }));
    sl.rotation.x = -Math.PI / 2; sl.rotation.z = Math.atan2(T[0].x, T[0].z); sl.position.copy(P[0]).setY(P[0].y + 0.08); scene.add(sl);
    const gate = new THREE.Group();
    const pil = new THREE.MeshStandardMaterial({ color: 0x1d2433, metalness: 0.7, roughness: 0.3 });
    [-1, 1].forEach((sd) => { const pl = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), pil); pl.position.set(sd * (ROAD_W / 2 + 2), 5, 0); gate.add(pl); });
    const chk2 = checkerTexture(); chk2.repeat.set(10, 1);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 5, 2, 0.8), [pil, pil, pil, pil, new THREE.MeshStandardMaterial({ map: chk2 }), new THREE.MeshStandardMaterial({ map: chk2 })]);
    beam.position.y = 10; gate.add(beam);
    this.lamps = [];
    for (let i = 0; i < 5; i++) { const lm = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0x000000 })); lm.position.set(-4 + i * 2, 8.4, 0.5); gate.add(lm); this.lamps.push(lm); }
    gate.position.copy(P[0]); gate.rotation.y = Math.atan2(T[0].x, T[0].z); gate.traverse((o) => o.isMesh && (o.castShadow = true)); scene.add(gate);
    // tribuna con público
    const stand = new THREE.Group();
    const sb = new THREE.Mesh(new THREE.BoxGeometry(60, 8, 12), new THREE.MeshStandardMaterial({ color: 0xb8bcc6 })); sb.position.y = 4; stand.add(sb);
    const roofS = new THREE.Mesh(new THREE.BoxGeometry(62, 0.5, 14), new THREE.MeshStandardMaterial({ color: 0xd42a2a })); roofS.position.set(0, 14, 1); stand.add(roofS);
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.1, 0.5), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 600);
    for (let i = 0; i < 600; i++) { const row = i % 6, col = Math.floor(i / 6); mm.makeTranslation(-29 + col * 0.58, 8.6 + row * 0.9, -4 + row * 1.6 - 0); crowd.setMatrixAt(i, mm); crowd.setColorAt(i, c.setHSL(Math.random(), 0.7, 0.55)); }
    stand.add(crowd); this.crowd = crowd;
    const sp = P[8].clone().addScaledVector(Rt[8], -(ROAD_W / 2 + 14)); stand.position.set(sp.x, H(sp.x, sp.z), sp.z); stand.rotation.y = Math.atan2(T[8].x, T[8].z) + Math.PI / 2;
    stand.traverse((o) => o.isMesh && (o.castShadow = true)); scene.add(stand);
    // neumáticos / vallas en curvas: barreras
    const tyres = new THREE.InstancedMesh(new THREE.TorusGeometry(0.45, 0.22, 8, 14), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }), M);
    let nt = 0;
    for (let i = 0; i < M; i += 1) {
      const curv = T[(i + 6) % M].clone().sub(T[(i - 6 + M) % M]).length();
      if (curv > 0.25) { const sd = T[(i + 6) % M].clone().sub(T[(i - 6 + M) % M]).dot(Rt[i]) > 0 ? -1 : 1; const p = P[i].clone().addScaledVector(Rt[i], sd * (ROAD_W / 2 + 9)); p.y = H(p.x, p.z) + 0.3; mm.compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)); tyres.setMatrixAt(nt++, mm); }
    }
    tyres.count = nt; scene.add(tyres);
    scene.add(scatterTrees({ count: Math.floor(6000 * world.q.trees), area: 3200, heightFn: H, rnd: N.rnd, kind: N.rnd() > 0.5 ? 'pine' : 'round', scale: [1.4, 2.6],
      accept: (x, z, y) => { const n = this.nearest(x, z, 1); return (!n || n.d > ROAD_W / 2 + 18) && y < 200 && Math.hypot(x - stand.position.x, z - stand.position.z) > 45; }, castShadow: world.q.shadows }));
    scene.add(buildClouds({ count: Math.floor(40 * world.q.clouds), area: 5000, height: [400, 700], rnd: N.rnd, puffSize: 130 }));

    // autos
    this.player = { obj: buildCarModel(0xe0101a), x: 0, z: 0, y: 0, h: 0, vf: 0, vl: 0, idx: 0, lap: 0, prog: 0, steerVis: 0, spin: 0, nitro: 100 };
    scene.add(this.player.obj);
    const aiColors = [0x1a6cff, 0xffc400, 0x20c060, 0xff6a00, 0xaa33ff];
    this.ai = aiColors.map((col, i) => ({ obj: buildCarModel(col), s: 0, v: 0, lane: 0, skill: 0.86 + i * 0.025 + Math.random() * 0.02, lap: 0, prog: 0, spin: 0 }));
    this.ai.forEach((a) => scene.add(a.obj));
    this.reset();
    this.particles = new Particles(scene, 800, { size: 2.2, additive: false }); this.particles.gravity = 1.5; this.particles.drag = 1.5;
    this.sparks = new Particles(scene, 600, { size: 0.5 });
    this.laps = 3; this.camMode = 0; this.camPos = new THREE.Vector3();
    this.engine = synth.engine('engine', { type: 'sawtooth', base: 45, vol: 0.16 });
    this.skid = synth.noiseLoop('skid', { type: 'bandpass', freq: 2200, q: 3, vol: 0.4 });
    this.windL = synth.noiseLoop('wind', { type: 'bandpass', freq: 500, q: 0.5, vol: 0.25 });
    hud.map.style.display = 'block';
    this.mapCtx = hud.map.getContext('2d');
  }

  reset() {
    const { P, T, Rt = this.R, M, L } = this;
    const startI = (k) => (M - 6 - k * 5 + M) % M;
    const place = (i, side) => P[i].clone().addScaledVector(Rt[i], side * 3.2);
    const pi = startI(3), pp = place(pi, 1);
    Object.assign(this.player, { x: pp.x, z: pp.z, h: Math.atan2(T[pi].x, T[pi].z), idx: pi, lap: -1, vf: 0, vl: 0, nitro: 100 });
    this.ai.forEach((a, k) => { const si = startI(k < 3 ? k : k + 1); a.s = si * (L / M); a.lane = (k % 2 ? 1 : -1) * 3.2; a.idx = si; a.lap = -1; a.v = 0; });
    this.state = 'count'; this.count = 4.2; this.time = 0; this.camInit = false; this.lastBeep = 5; this.msgT = 0;
    this.lamps.forEach((l) => l.material.emissive.set(0x000000));
  }

  nearest(x, z, rad = 1) {
    const cx = Math.floor(x / 40), cz = Math.floor(z / 40); let best = null, bd = 1e18;
    for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) {
      const l = this.grid.get(`${cx + i},${cz + j}`); if (!l) continue;
      for (const k of l) { const p = this.P[k]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = k; } }
    }
    if (best == null) return null;
    // proyectar sobre el segmento
    const p = this.P[best], t = this.T[best];
    const along = (x - p.x) * t.x + (z - p.z) * t.z;
    const nx = best, nn = (best + (along > 0 ? 1 : -1) + this.M) % this.M;
    const f = Math.min(1, Math.abs(along) / 2);
    const y = THREE.MathUtils.lerp(p.y, this.P[nn].y, f);
    const lat = (x - p.x) * this.R[best].x + (z - p.z) * this.R[best].z;
    return { i: nx, d: Math.abs(lat), lat, y };
  }

  update(dt, inp) {
    const pl = this.player, P = this.P, M = this.M;
    this.particles.update(dt); this.sparks.update(dt);
    // semáforo
    if (this.state === 'count') {
      this.count -= dt;
      const lit = Math.min(5, Math.floor((4.2 - this.count) / 0.7));
      this.lamps.forEach((l, i) => { l.material.emissive.set(i < lit ? 0xff1010 : 0x000000); l.material.emissiveIntensity = 3; });
      if (lit !== this.lastBeep && lit > 0 && lit <= 5) { this.lastBeep = lit; this.fx.sound('beep'); this.fx.vibrate(60); }
      this.hud.C.innerHTML = `<div class="msg big">${lit >= 5 ? '¡Preparados!' : '🔴'.repeat(lit) + '⚫'.repeat(5 - lit)}</div>`;
      if (this.count <= 0) { this.state = 'race'; this.lamps.forEach((l) => l.material.emissive.set(0x00ff40)); this.fx.sound('go'); this.fx.vibrate([300]); this.hud.C.innerHTML = '<div class="msg big go">¡YA!</div>'; this.msgT = 1; }
      inp = { ...inp, gas: inp.gas, steer: 0 };
    } else if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    const racing = this.state === 'race';
    if (racing) this.time += dt;
    if (inp.bPressed) this.fx.sound('horn');

    // ---- física del jugador ----
    const n = this.nearest(pl.x, pl.z, 2) || { d: 999, lat: 0, i: pl.idx, y: pl.y };
    const off = n.d > ROAD_W / 2 + 1.5;
    const fwd = new THREE.Vector2(Math.sin(pl.h), Math.cos(pl.h));
    const steer = THREE.MathUtils.clamp(inp.steer, -1, 1);
    let nitro = 0;
    if (inp.a > 0 && pl.nitro > 0 && racing) { nitro = 1; pl.nitro = Math.max(0, pl.nitro - dt * 30); if (inp.aPressed) { this.fx.sound('boost'); this.fx.vibrate([100, 30, 200]); } } else pl.nitro = Math.min(100, pl.nitro + dt * 6);
    const maxV = (off ? 18 : 62) + nitro * 18;
    const gas = racing ? inp.gas : 0;
    let accel = gas * (off ? 9 : 16) * (1 - pl.vf / (maxV + 1)) + nitro * 14;
    if (inp.brake > 0) accel -= (pl.vf > 1 ? 30 : 8) * inp.brake;
    accel -= 0.0035 * pl.vf * Math.abs(pl.vf) + (off ? 3 : 0.4) * Math.sign(pl.vf);
    pl.vf += accel * dt;
    if (Math.abs(pl.vf) < 0.3 && gas === 0 && inp.brake === 0) pl.vf = 0;
    pl.vf = Math.max(-8, pl.vf);
    const steerGain = 1.9 / (1 + Math.abs(pl.vf) / 28);
    const drift = inp.brake > 0 && Math.abs(steer) > 0.4 && pl.vf > 20;
    pl.h -= steer * steerGain * dt * Math.min(1, Math.abs(pl.vf) / 6) * Math.sign(pl.vf || 1) * (drift ? 1.35 : 1);
    // deslizamiento lateral
    pl.vl += -steer * pl.vf * 0.06 * dt * 60 * (drift ? 0.9 : 0.25);
    pl.vl *= Math.exp(-(drift ? 1.8 : off ? 7 : 9) * dt);
    const right = new THREE.Vector2(-fwd.y, fwd.x);
    pl.x += (fwd.x * pl.vf + right.x * pl.vl) * dt;
    pl.z += (fwd.y * pl.vf + right.y * pl.vl) * dt;
    // límites
    if (n.d > ROAD_W / 2 + 30) {
      const p = P[n.i]; const back = new THREE.Vector2(p.x - pl.x, p.z - pl.z).normalize();
      pl.x += back.x * (n.d - ROAD_W / 2 - 30); pl.z += back.y * (n.d - ROAD_W / 2 - 30); pl.vf *= 0.5;
      this.fx.vibrate([200, 50, 100]); this.fx.sound('crash', 'tv');
    }
    pl.y = this.H(pl.x, pl.z);
    // avance en la pista y vueltas
    const prevIdx = pl.idx; pl.idx = n.i;
    if (prevIdx > M * 0.85 && pl.idx < M * 0.15) { pl.lap++; this.onLap(); }
    if (prevIdx < M * 0.15 && pl.idx > M * 0.85) pl.lap--;
    pl.prog = pl.lap * M + pl.idx;

    // ---- IA ----
    for (const a of this.ai) {
      const i = Math.floor(a.s / (this.L / M)) % M;
      const ahead = this.T[(i + 15) % M], now = this.T[i];
      const curv = 1 - ahead.dot(now);
      const target = racing ? (62 * a.skill) * (1 - Math.min(0.55, curv * 6)) : 0;
      a.v += THREE.MathUtils.clamp(target - a.v, -25 * dt, 14 * dt);
      a.s += a.v * dt;
      const ii = Math.floor(a.s / (this.L / M));
      if (ii >= M) { a.s -= this.L; a.lap++; }
      a.idx = Math.floor(a.s / (this.L / M)) % M;
      a.prog = a.lap * M + a.idx;
      const p = P[a.idx].clone().lerp(P[(a.idx + 1) % M], (a.s / (this.L / M)) % 1);
      a.lane += (Math.sin(this.time * 0.3 + a.skill * 50) * 3.5 - a.lane) * dt * 0.5;
      p.addScaledVector(this.R[a.idx], a.lane);
      // choque con jugador
      const dx = pl.x - p.x, dz = pl.z - p.z, dd = Math.hypot(dx, dz);
      if (dd < 3.6 && dd > 0.01) {
        const push = (3.6 - dd) / 2; pl.x += (dx / dd) * push; pl.z += (dz / dd) * push; p.x -= (dx / dd) * push * 0.3;
        if (!a.hitT || this.time - a.hitT > 0.6) { a.hitT = this.time; this.fx.vibrate([150, 40, 80]); this.fx.sound('bump'); pl.vf *= 0.85; a.v *= 0.9;
          this.sparks.emit(new THREE.Vector3((pl.x + p.x) / 2, pl.y + 0.6, (pl.z + p.z) / 2), 40, { speed: 8, color: 0xffcc55, life: 0.5 }); }
      }
      a.obj.position.set(p.x, this.H(p.x, p.z), p.z);
      const tt = this.T[a.idx]; a.obj.rotation.set(0, Math.atan2(tt.x, tt.z), 0);
      a.spin += a.v * dt / 0.4; a.obj.userData.wheels.forEach((w) => (w.spin.rotation.x = a.spin));
    }

    // ---- visual del jugador ----
    const o = pl.obj;
    o.position.set(pl.x, pl.y, pl.z);
    const ahead = this.H(pl.x + fwd.x * 2, pl.z + fwd.y * 2), behind = this.H(pl.x - fwd.x * 2, pl.z - fwd.y * 2);
    const pitch = Math.atan2(behind - ahead, 4);
    pl.steerVis += (steer - pl.steerVis) * Math.min(1, dt * 10);
    o.rotation.set(pitch, pl.h, pl.steerVis * Math.min(1, pl.vf / 40) * 0.06 + pl.vl * 0.01, 'YXZ');
    pl.spin += pl.vf * dt / 0.4;
    o.userData.wheels.forEach((w) => { w.spin.rotation.x = pl.spin; if (w.front) w.steer.rotation.y = -pl.steerVis * 0.5; });
    o.userData.tail.emissiveIntensity = inp.brake > 0 ? 6 : 2;
    const skidding = Math.abs(pl.vl) > 2.5 || drift;
    if (skidding || (off && pl.vf > 5)) {
      o.userData.wheels.filter((w) => !w.front).forEach((w) => { const wp = new THREE.Vector3(); w.steer.getWorldPosition(wp); this.particles.emit(wp, 1, { speed: 1.5, color: off ? 0x8a7a55 : 0xcccccc, life: 1.4, up: 1 }); });
    }
    if (nitro) { const ex = new THREE.Vector3(0, 0.5, -2.6).applyMatrix4(o.matrixWorld); this.sparks.emit(ex, 3, { speed: 3, color: 0x55aaff, life: 0.3, dir: new THREE.Vector3(-fwd.x, 0, -fwd.y) }); }

    // ---- cámara ----
    const cam = this.world.camera;
    const camBack = this.camMode === 0 ? 9 : 4.5, camUp = this.camMode === 0 ? 3.4 : 1.6;
    const desired = new THREE.Vector3(pl.x - fwd.x * camBack, pl.y + camUp, pl.z - fwd.y * camBack);
    if (!this.camInit) { this.camPos.copy(desired); this.camInit = true; }
    this.camPos.lerp(desired, 1 - Math.exp(-dt * 6));
    this.camPos.y = Math.max(this.camPos.y, this.H(this.camPos.x, this.camPos.z) + 1);
    cam.position.copy(this.camPos); cam.up.set(0, 1, 0);
    cam.lookAt(pl.x + fwd.x * 6, pl.y + 1.2, pl.z + fwd.y * 6);
    cam.fov += (65 + Math.max(0, pl.vf - 20) * 0.3 + nitro * 10 - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
    this.world.followShadow(o.position);

    // ---- sonido / vibración ----
    const gear = Math.min(5, Math.floor(Math.abs(pl.vf) / 13));
    const rpm = (Math.abs(pl.vf) - gear * 13) / 13 * 0.6 + gear * 0.08 + gas * 0.15;
    this.engine.set(rpm, 0.2 + gas * 0.8);
    this.skid.set(skidding && !off ? Math.min(1, Math.abs(pl.vl) / 6 + (drift ? 0.5 : 0)) : 0);
    this.windL.set(Math.abs(pl.vf) / 60);
    this.fx.rumble(Math.min(1, (off ? 0.35 + pl.vf / 40 : 0.05 + Math.abs(pl.vf) / 160) + (skidding ? 0.25 : 0) + nitro * 0.3));

    // ---- HUD ----
    const all = [{ prog: pl.prog, me: true }, ...this.ai.map((a) => ({ prog: a.prog }))].sort((a, b) => b.prog - a.prog);
    const posn = all.findIndex((x) => x.me) + 1;
    this.pos = posn;
    this.hud.L.innerHTML = `<div class="g speedo"><b>${Math.round(Math.abs(pl.vf) * 3.6)}</b> km/h</div><div class="nitro"><i style="width:${pl.nitro}%"></i></div><div class="g">Marcha ${pl.vf < -0.5 ? 'R' : gear + 1}</div>`;
    this.hud.R.innerHTML = `<div class="g pos"><b>${posn}°</b>/${all.length}</div><div class="g">Vuelta <b>${Math.min(this.laps, Math.max(1, pl.lap + 1))}</b>/${this.laps}</div><div class="g">⏱ ${fmt(this.time)}</div>`;
    this.drawMap();
    if (this.state === 'done') { this.hud.C.innerHTML = this.doneMsg; if (inp.aPressed || inp.gas > 0 && this.time - this.doneT > 3) this.restart(); }
  }

  onLap() {
    const pl = this.player;
    if (pl.lap >= this.laps && this.state === 'race') {
      this.state = 'done'; this.doneT = this.time;
      this.doneMsg = `<div class="msg big">${this.pos === 1 ? '🏆 ¡GANASTE!' : `🏁 Llegaste ${this.pos}°`}<br><small>${fmt(this.time)} · NITRO para revancha</small></div>`;
      this.fx.sound(this.pos === 1 ? 'win' : 'lap'); this.fx.vibrate(this.pos === 1 ? [100, 50, 100, 50, 100, 50, 400] : [200]);
    } else if (pl.lap > 0) { this.hud.C.innerHTML = `<div class="msg">Vuelta ${pl.lap + 1} de ${this.laps}</div>`; this.msgT = 2; this.fx.sound('lap'); this.fx.vibrate([50, 50, 50]); }
  }
  restart() { this.reset(); }

  drawMap() {
    const g = this.mapCtx, W = 200; if (!this._bounds) { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; this.P.forEach((p) => { a = Math.min(a, p.x); b = Math.max(b, p.x); c = Math.min(c, p.z); d = Math.max(d, p.z); }); this._bounds = { a, b, c, d, s: 170 / Math.max(b - a, d - c) }; }
    const B = this._bounds, X = (x) => 15 + (x - B.a) * B.s, Y = (z) => 15 + (z - B.c) * B.s;
    g.clearRect(0, 0, W, W); g.fillStyle = 'rgba(10,14,25,0.55)'; g.beginPath(); g.roundRect(0, 0, W, W, 16); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
    this.P.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.z)) : g.moveTo(X(p.x), Y(p.z)))); g.closePath(); g.stroke();
    const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Y(z), r, 0, 7); g.fill(); };
    this.ai.forEach((a) => dot(a.obj.position.x, a.obj.position.z, '#' + a.obj.children[0].material.color.getHexString(), 4.5));
    dot(this.player.x, this.player.z, '#ff2030', 6.5);
  }
  padHud() { return `${this.pos || '-'}° · Vuelta ${Math.min(this.laps, this.player.lap + 1)}/${this.laps}`; }
  dispose() {}
}

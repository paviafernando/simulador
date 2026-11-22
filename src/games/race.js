import * as THREE from 'three';
import { makeNoise, smoothstep } from '../engine/noise.js';
import { buildTerrain, naturalColor, scatterTrees, buildClouds, Particles, tex } from '../engine/terrain.js';
import { buildGrass } from '../engine/grass.js';
import { loadModel } from '../engine/assets.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { fmt } from './plane.js';

const ROAD_W = 16;

function roadTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#26282b'; g.fillRect(0, 0, 256, 1024);
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
    world.setupAtmosphere({ mode: 'day', hour: 16.3, env: 'noon_grass_1k.hdr', envIntensity: 1.2, shadowRange: 45, bloom: { strength: 0.5, threshold: 1.0 },
      clouds: { coverage: 0.35 }, ao: { radius: 2, intensity: 2.2 } });
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
    const terrain = buildTerrain({ size: 4000, segments: world.q.segments, heightFn: H, colorFn: naturalColor(N), noise: N, waterLevel: -999, snowLine: 330, sand: 0x7d7262,
      splatFn: (x, z, y, slope, w) => { const n = this.nearest(x, z, 1); if (!n) return; const g = (1 - smoothstep(ROAD_W / 2 + 3, ROAD_W / 2 + 7, n.d)) * 0.85; if (g > 0) { w[3] = Math.max(w[3], g); w[0] *= 1 - g; } } });
    scene.add(terrain); this.terrain = terrain;
    if (world.q.grass) {
      scene.add(this.grass = buildGrass({ heightFn: H, area: 2400, res: 768, count: Math.floor(220000 * world.q.grass), radius: 40, bladeH: 0.42,
        maskFn: (x, z) => { const n = this.nearest(x, z, 1); return n ? smoothstep(ROAD_W / 2 + 7, ROAD_W / 2 + 10, n.d) : 1; } }));
    }
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
    const rn = tex('rock_Normal.jpg', false).clone(); rn.repeat.set(6, 6); rn.needsUpdate = true;
    const road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.78, metalness: 0.0, normalMap: rn, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.6 }));
    this.road = road;
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
    if (!world.atmo?.clouds && world.q.billboardClouds) scene.add(buildClouds({ count: Math.floor(40 * world.q.billboardClouds), area: 5000, height: [400, 700], rnd: N.rnd, puffSize: 130, E: world.E }));
    this.tyrePositions = [];
    for (let i = 0; i < nt; i++) { tyres.getMatrixAt(i, mm); this.tyrePositions.push(new THREE.Vector3().setFromMatrixPosition(mm)); }

    // autos (modelo provisorio hasta que carga el Ferrari)
    this.player = { obj: buildCarModel(0xe0101a), idx: 0, lap: 0, prog: 0, steerVis: 0, nitro: 100, flipT: 0 };
    scene.add(this.player.obj);
    const aiColors = [0x1a6cff, 0xffc400, 0x20c060, 0xff6a00, 0xaa33ff];
    this.aiColors = aiColors;
    this.ai = aiColors.map((col, i) => ({ obj: buildCarModel(col), s: 0, v: 0, lane: 0, skill: 0.86 + i * 0.025 + Math.random() * 0.02, lap: 0, prog: 0, spin: 0 }));
    this.ai.forEach((a) => scene.add(a.obj));
    this.ready = Promise.all([RAPIER.init(), loadModel('/assets/models/ferrari.glb')]).then(([, g]) => {
      if (g) this.useFerrari(g);
      this.initPhysics();
      this.reset();
    });
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
    const { P, T, M, L } = this, Rt = this.R;
    const startI = (k) => (M - 6 - k * 5 + M) % M;
    const place = (i, side) => P[i].clone().addScaledVector(Rt[i], side * 3.2);
    const pi = startI(3), pp = place(pi, 1);
    Object.assign(this.player, { idx: pi, lap: -1, nitro: 100, flipT: 0 });
    this.placeCar(pp, Math.atan2(T[pi].x, T[pi].z));
    this.ai.forEach((a, k) => { const si = startI(k < 3 ? k : k + 1); a.s = si * (L / M); a.lane = (k % 2 ? 1 : -1) * 3.2; a.idx = si; a.lap = -1; a.v = 0; });
    this.state = 'count'; this.count = 4.2; this.time = 0; this.camInit = false; this.lastBeep = 5; this.msgT = 0;
    this.lamps.forEach((l) => l.material.emissive.set(0x000000));
  }

  useFerrari(g) {
    const make = (color) => {
      const root = g.scene.clone(true);
      const wheels = [];
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          o.material = o.material.clone();
          if (o.material.name === 'Body_Color') { o.material = new THREE.MeshPhysicalMaterial({ color, metalness: 1.0, roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 }); o.material.name = 'Body_Color'; }
          if (o.material.name === 'Glass_Gray') { o.material = new THREE.MeshPhysicalMaterial({ color: 0x111111, metalness: 0.25, roughness: 0, transmission: 0.6, transparent: true, opacity: 0.6 }); }
        }
        if (/^wheel_(fl|fr|rl|rr)$/.test(o.name)) { o.rotation.order = 'YXZ'; wheels.push({ node: o, front: /f/.test(o.name.slice(6)) && o.name[6] === 'f', base: o.rotation.x }); }
      });
      root.rotation.y = Math.PI; // el modelo mira hacia -Z; lo giramos a +Z
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: (() => { const t = new THREE.TextureLoader().load('/assets/models/ferrari_ao.png'); return t; })(), blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true, depthWrite: false }));
      shadow.material.userData.raw = true; shadow.position.y = 0.02; shadow.renderOrder = 2;
      const grp = new THREE.Group(); grp.add(root, shadow);
      grp.userData.wheels = wheels.map((w) => ({ ...w, spin: { rotation: w.node.rotation }, steer: w.node }));
      grp.userData.tail = new THREE.MeshStandardMaterial();
      grp.userData.paint = color;
      return grp;
    };
    const scene = this.world.scene;
    scene.remove(this.player.obj); this.player.obj = make(0xd10f0f); scene.add(this.player.obj);
    this.ai.forEach((a, i) => { scene.remove(a.obj); a.obj = make(this.aiColors[i]); scene.add(a.obj); });
    this.ferrari = true;
  }

  initPhysics() {
    const W = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.phys = W;
    const tri = (mesh) => {
      const g = mesh.geometry, p = g.attributes.position.array;
      const v = new Float32Array(p.length); v.set(p);
      if (mesh.matrixWorldNeedsUpdate || true) { mesh.updateMatrixWorld(true); const m = mesh.matrixWorld, t = new THREE.Vector3(); for (let i = 0; i < v.length; i += 3) { t.set(v[i], v[i + 1], v[i + 2]).applyMatrix4(m); v[i] = t.x; v[i + 1] = t.y; v[i + 2] = t.z; } }
      const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array([...Array(v.length / 3).keys()]);
      return RAPIER.ColliderDesc.trimesh(v, idx);
    };
    W.createCollider(tri(this.terrain).setFriction(0.9));
    W.createCollider(tri(this.road).setFriction(1.1));
    // barreras de neumáticos: obstáculos reales
    this.tyrePositions.forEach((p) => W.createCollider(RAPIER.ColliderDesc.cylinder(0.6, 0.7).setTranslation(p.x, p.y + 0.3, p.z).setRestitution(0.3)));
    // chasis
    const body = W.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setAngularDamping(0.9).setLinearDamping(0.01).setCcdEnabled(true));
    W.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.32, 2.15).setTranslation(0, 0.6, 0).setMass(1250).setFriction(0.4).setRestitution(0.1), body);
    const veh = W.createVehicleController(body); veh.indexUpAxis = 1; veh.setIndexForwardAxis = 2;
    [[0.83, 0.42, 1.32], [-0.83, 0.42, 1.32], [0.83, 0.42, -1.48], [-0.83, 0.42, -1.48]].forEach(([x, y, z], k) => {
      veh.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, 0.3, 0.36);
      veh.setWheelSuspensionStiffness(k, 42); veh.setWheelSuspensionCompression(k, 4.4); veh.setWheelSuspensionRelaxation(k, 5.2);
      veh.setWheelMaxSuspensionForce(k, 70000); veh.setWheelFrictionSlip(k, 2.6); veh.setWheelMaxSuspensionTravel(k, 0.25);
    });
    this.body = body; this.veh = veh;
    // rivales: cuerpos cinemáticos (empujan de verdad)
    this.ai.forEach((a) => {
      a.body = W.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
      W.createCollider(RAPIER.ColliderDesc.cuboid(0.92, 0.5, 2.15).setTranslation(0, 0.7, 0).setFriction(0.3), a.body);
    });
    this.acc = 0;
  }

  placeCar(p, heading) {
    if (!this.body) return;
    const y = this.H(p.x, p.z) + 0.6;
    this.body.setTranslation({ x: p.x, y, z: p.z }, true);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
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
      this.lamps.forEach((l, i) => { l.material.emissive.set(i < lit ? 0xff1010 : 0x000000); l.material.emissiveIntensity = 9 * this.world.E; });
      if (lit !== this.lastBeep && lit > 0 && lit <= 5) { this.lastBeep = lit; this.fx.sound('beep'); this.fx.vibrate(60); }
      this.hud.C.innerHTML = `<div class="msg big">${lit >= 5 ? '¡Preparados!' : '🔴'.repeat(lit) + '⚫'.repeat(5 - lit)}</div>`;
      if (this.count <= 0) { this.state = 'race'; this.lamps.forEach((l) => l.material.emissive.set(0x00ff40)); this.fx.sound('go'); this.fx.vibrate([300]); this.hud.C.innerHTML = '<div class="msg big go">¡YA!</div>'; this.msgT = 1; }
      inp = { ...inp, gas: inp.gas, steer: 0 };
    } else if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    const racing = this.state === 'race';
    if (racing) this.time += dt;
    if (inp.bPressed) this.fx.sound('horn');

    // ---- física del jugador (Rapier: vehículo con suspensión y fricción por rueda) ----
    const body = this.body, veh = this.veh;
    const tp = body.translation();
    const n = this.nearest(tp.x, tp.z, 2) || { d: 999, lat: 0, i: pl.idx, y: tp.y };
    const off = n.d > ROAD_W / 2 + 1.5;
    const steer = THREE.MathUtils.clamp(inp.steer, -1, 1);
    let nitro = 0;
    if (inp.a > 0 && pl.nitro > 0 && racing) { nitro = 1; pl.nitro = Math.max(0, pl.nitro - dt * 30); if (inp.aPressed) { this.fx.sound('boost'); this.fx.vibrate([100, 30, 200]); } } else pl.nitro = Math.min(100, pl.nitro + dt * 6);
    const speed = veh.currentVehicleSpeed();
    // ayudas: acelera solo (el freno manda) y corrige suave hacia la pista si te vas
    const autoGas = inp.assist && inp.brake === 0 ? 0.85 : 0;
    const gas = racing ? Math.max(inp.gas, autoGas) : 0;
    let steerIn = steer;
    if (inp.assist && racing) {
      const ahead = (n.i + 10) % M, tp2 = P[ahead];
      const r3 = body.rotation(), fw = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(r3.x, r3.y, r3.z, r3.w));
      const want = Math.atan2(tp2.x - tp.x, tp2.z - tp.z), have = Math.atan2(fw.x, fw.z);
      const err = Math.atan2(Math.sin(want - have), Math.cos(want - have));
      steerIn = THREE.MathUtils.clamp(steer - err * 0.35 * (1 - Math.abs(steer)), -1, 1);
    }
    const vmax = 66 + nitro * 16;
    const engine = (gas * 5200 * Math.max(0, 1 - speed / vmax) + nitro * 4200) * (speed < -1 ? 0 : 1);
    const reverse = inp.brake > 0 && speed < 1.5 && gas === 0 ? -2200 : 0;
    const drift = inp.brake > 0 && Math.abs(steer) > 0.35 && speed > 18;
    const steerAng = -steerIn * 0.55 / (1 + Math.max(0, speed) / 22);
    for (let k = 0; k < 4; k++) {
      const front = k < 2;
      if (front) veh.setWheelSteering(k, steerAng);
      else veh.setWheelEngineForce(k, engine + reverse);
      veh.setWheelBrake(k, inp.brake > 0 && speed > 1.5 ? (drift ? (front ? 8 : 40) : 60) : gas === 0 ? 2 : 0);
      veh.setWheelFrictionSlip(k, off ? 1.4 : drift && !front ? 1.1 : 2.6);
    }
    // arrastre aerodinámico + carga aerodinámica
    const lv = body.linvel();
    const v2 = lv.x * lv.x + lv.z * lv.z, vv = Math.sqrt(v2);
    if (vv > 0.5) body.applyImpulse({ x: -lv.x * vv * 0.42 * dt, y: -vv * vv * 0.9 * dt, z: -lv.z * vv * 0.42 * dt }, true);
    // paso fijo
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= 1 / 60) {
      this.ai.forEach((a) => a.next && (a.body.setNextKinematicTranslation(a.next.p), a.body.setNextKinematicRotation(a.next.q)));
      veh.updateVehicle(1 / 60); this.phys.step(); this.acc -= 1 / 60;
    }
    const t2 = body.translation(), r2 = body.rotation();
    const q = new THREE.Quaternion(r2.x, r2.y, r2.z, r2.w);
    const fwd3 = new THREE.Vector3(0, 0, 1).applyQuaternion(q), up3 = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const fwd = new THREE.Vector2(fwd3.x, fwd3.z).normalize();
    // impactos
    const nv = body.linvel(); const dv = Math.hypot(nv.x - lv.x, nv.y - lv.y, nv.z - lv.z);
    if (dv > 5) { this.fx.vibrate([Math.min(400, 60 + dv * 25), 40, 80]); this.fx.sound(dv > 12 ? 'crash' : 'bump'); this.sparks.emit(new THREE.Vector3(t2.x, t2.y + 0.6, t2.z), 40, { speed: 8, color: 0xffcc55, life: 0.5 }); }
    // volcado o fuera de pista: volver a la pista
    pl.flipT = up3.y < 0.3 ? pl.flipT + dt : 0;
    if (pl.flipT > 1.5 || n.d > ROAD_W / 2 + 60 || t2.y < -50) { const i = n.i; this.placeCar(P[i].clone(), Math.atan2(this.T[i].x, this.T[i].z)); pl.flipT = 0; this.hud.C.innerHTML = '<div class="msg">🔧 ¡De vuelta a la pista!</div>'; this.msgT = 1.5; }
    pl.x = t2.x; pl.z = t2.z; pl.y = t2.y; pl.vf = speed;
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
      // si el jugador está muy cerca adelante, la IA frena un poco
      const dx = pl.x - p.x, dz = pl.z - p.z, dd = Math.hypot(dx, dz);
      if (dd < 7 && (dx * this.T[a.idx].x + dz * this.T[a.idx].z) > 0) a.v *= 1 - dt * 1.5;
      const yaw = Math.atan2(this.T[a.idx].x, this.T[a.idx].z);
      const gy = this.H(p.x, p.z);
      a.obj.position.set(p.x, gy, p.z);
      a.obj.rotation.set(0, yaw, 0);
      a.next = { p: { x: p.x, y: gy, z: p.z }, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) };
      a.spin += a.v * dt / 0.36; a.obj.userData.wheels.forEach((w) => { w.spin.rotation.x = (w.base || 0) + a.spin; });
    }

    // ---- visual del jugador ----
    const o = pl.obj;
    o.position.set(t2.x, t2.y - 0.2, t2.z); o.quaternion.copy(q);
    pl.steerVis += (steer - pl.steerVis) * Math.min(1, dt * 10);
    o.userData.wheels.forEach((w, k) => {
      const i = this.ferrari ? { wheel_fl: 0, wheel_fr: 1, wheel_rl: 2, wheel_rr: 3 }[w.node.name] : [1, 0, 3, 2][k] ?? k;
      w.spin.rotation.x = (w.base || 0) + (veh.wheelRotation(i) || 0);
      if (w.front) w.steer.rotation.y = veh.wheelSteering(i) || 0;
    });
    const skidding = drift || Math.abs(new THREE.Vector3(nv.x, 0, nv.z).dot(new THREE.Vector3(fwd.y, 0, -fwd.x))) > 3.5;
    if ((skidding || (off && speed > 5)) && speed > 3) {
      [-0.8, 0.8].forEach((x) => { const wp = new THREE.Vector3(x, 0.15, -1.45).applyMatrix4(o.matrixWorld); this.particles.emit(wp, 1, { speed: 1.5, color: off ? 0x8a7a55 : 0xcccccc, life: 1.4, up: 1 }); });
    }
    if (nitro) { const ex = new THREE.Vector3(0, 0.45, -2.3).applyMatrix4(o.matrixWorld); this.sparks.emit(ex, 3, { speed: 3, color: 0x55aaff, life: 0.3, dir: new THREE.Vector3(-fwd.x, 0, -fwd.y) }); }
    this.grass?.userData.update(this.world.camera);

    // ---- cámara ----
    const cam = this.world.camera;
    const camBack = this.camMode === 0 ? 9 : 4.5, camUp = this.camMode === 0 ? 3.4 : 1.6;
    const desired = new THREE.Vector3(pl.x - fwd.x * camBack, pl.y + camUp, pl.z - fwd.y * camBack);
    void up3;
    if (!this.camInit) { this.camPos.copy(desired); this.camInit = true; }
    this.camPos.lerp(desired, 1 - Math.exp(-dt * 6));
    this.camPos.y = Math.max(this.camPos.y, this.H(this.camPos.x, this.camPos.z) + 1);
    cam.position.copy(this.camPos); cam.up.set(0, 1, 0);
    cam.lookAt(pl.x + fwd.x * 6, pl.y + 1.2, pl.z + fwd.y * 6);
    cam.fov += (62 + Math.max(0, pl.vf - 20) * 0.3 + nitro * 10 - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
    this.world.followShadow(o.position);

    // ---- sonido / vibración ----
    const gear = Math.min(5, Math.floor(Math.abs(pl.vf) / 13));
    const rpm = (Math.abs(pl.vf) - gear * 13) / 13 * 0.6 + gear * 0.08 + gas * 0.15;
    this.engine.set(rpm, 0.2 + gas * 0.8);
    this.skid.set(skidding && !off && speed > 5 ? (drift ? 0.9 : 0.5) : 0);
    this.windL.set(Math.abs(pl.vf) / 60);
    this.fx.rumble(Math.min(1, (off ? 0.35 + Math.abs(speed) / 40 : 0.05 + Math.abs(speed) / 160) + (skidding ? 0.25 : 0) + nitro * 0.3));

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
    this.ai.forEach((a, i) => dot(a.obj.position.x, a.obj.position.z, '#' + new THREE.Color(this.aiColors[i]).getHexString(), 4.5));
    dot(this.player.x, this.player.z, '#ff2030', 6.5);
  }
  padHud() { return `${this.pos || '-'}° · Vuelta ${Math.min(this.laps, this.player.lap + 1)}/${this.laps}`; }
  dispose() { this.phys?.free(); }
}

import * as THREE from 'three';
import { makeNoise, smoothstep } from '../engine/noise.js';
import { buildTerrain, naturalColor, scatterTrees, buildClouds, buildWater, Particles, terrainSlope } from '../engine/terrain.js';
import { Flyer, ChaseCam, ringMesh, arrowMesh } from './flyer.js';

export function buildPlaneModel() {
  const g = new THREE.Group();
  const red = new THREE.MeshPhysicalMaterial({ color: 0xd8261c, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f0, metalness: 0.2, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.7, roughness: 0.4 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x88bbff, metalness: 0, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.55, clearcoat: 1 });
  // fuselaje torneado
  const prof = [[0, -4.6], [0.35, -4.4], [0.55, -3], [0.95, -1], [1.15, 0.5], [1.15, 2.2], [1.0, 3.4], [0.75, 4.1], [0.4, 4.5], [0, 4.6]].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), red); fus.rotation.x = Math.PI / 2; g.add(fus);
  // franja blanca
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.17, 1.17, 0.6, 32, 1, true), white); stripe.rotation.x = Math.PI / 2; stripe.position.z = -0.8; g.add(stripe);
  // alas
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(6.8, 0.5); wingShape.lineTo(7, 1.4); wingShape.lineTo(0, 2.3); wingShape.closePath();
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  wingGeo.rotateX(Math.PI / 2);
  const wL = new THREE.Mesh(wingGeo, white); wL.position.set(0.3, -0.35, -0.7); wL.rotation.z = 0.06;
  const wR = new THREE.Mesh(wingGeo, white); wR.position.set(-0.3, -0.35, -0.7); wR.scale.x = -1; wR.rotation.z = -0.06;
  g.add(wR, wL);
  // puntas rojas
  [-7.2, 7.2].forEach((x) => { const tip = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), red); tip.scale.set(1, 0.5, 2.5); tip.position.set(x, -0.3, 0.25); g.add(tip); });
  // cola
  const hs = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.14, 1.3), white); hs.position.set(0, 0.2, -4); g.add(hs);
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(1.8, 0); fin.lineTo(0.6, 2.2); fin.lineTo(0, 2.2); fin.closePath();
  const finM = new THREE.Mesh(new THREE.ExtrudeGeometry(fin, { depth: 0.14, bevelEnabled: false }), red);
  finM.rotation.y = -Math.PI / 2; finM.position.set(0.07, 0.4, -4.6); g.add(finM);
  // cabina
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  canopy.scale.set(0.9, 0.8, 2); canopy.position.set(0, 0.85, 0.9); g.add(canopy);
  // hélice
  const prop = new THREE.Group(); prop.position.z = 4.75;
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.9, 16), dark); spinner.rotation.x = Math.PI / 2; spinner.position.z = 0.3; prop.add(spinner);
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.0, 0.06), dark); b.position.y = 1; const h = new THREE.Group(); h.rotation.z = (i * Math.PI * 2) / 3; h.add(b); prop.add(h); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.1, 32), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  prop.add(disc);
  g.add(prop);
  // tren
  [-1.2, 1.2].forEach((x) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 16), dark); w.rotation.z = Math.PI / 2; w.position.set(x, -1.6, 1.8); g.add(w);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1, 0.2), white); s.position.set(x * 0.8, -1.1, 1.8); g.add(s); });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.userData.prop = prop;
  return g;
}

export default class PlaneGame {
  constructor({ world, synth, fx, hud, quality }) {
    Object.assign(this, { world, synth, fx, hud, q: quality });
    const scene = world.scene;
    world.setupAtmosphere({ mode: 'day', elevation: 22, azimuth: 140, fog: 0.00018, exposure: 0.5, shadowRange: 60, bloom: { strength: 0.3, threshold: 0.92 } });
    const N = makeNoise(7);
    this.noise = N;
    const H = (x, z) => {
      const r = Math.hypot(x, z);
      const base = N.fbm(x * 0.0004, z * 0.0004, 5) * 90 + 30;
      const mask = smoothstep(-0.3, 0.45, N.fbm(x * 0.00022 + 3.1, z * 0.00022 - 1.7, 3));
      const mt = Math.pow(N.ridged(x * 0.00055 + 11, z * 0.00055, 6), 1.7) * 620 * mask;
      let h = base + mt;
      h = THREE.MathUtils.lerp(h, -60, smoothstep(3600, 4600, r));
      return h;
    };
    this.H = H;
    scene.add(buildTerrain({ size: 10000, segments: world.q.segments, heightFn: H, colorFn: naturalColor(N, { snowLine: 360 }) }));
    this.water = buildWater(world, { level: 0, color: 0x1b5378 });
    scene.add(this.water);
    const trees = Math.floor(9000 * world.q.trees);
    if (trees) scene.add(scatterTrees({ count: trees, area: 7000, heightFn: H, rnd: N.rnd, accept: (x, z, y) => y > 6 && y < 260 && terrainSlope(H, x, z) < 0.45 && N.fbm(x * 0.002, z * 0.002, 2) > -0.05, scale: [2.5, 4.5] }));
    this.clouds = buildClouds({ count: Math.floor(70 * world.q.clouds), area: 8000, height: [380, 650], rnd: N.rnd, puffSize: 120 });
    scene.add(this.clouds);

    this.plane = buildPlaneModel(); scene.add(this.plane);
    this.flyer = new Flyer(this.plane, { minSpeed: 30, maxSpeed: 120, cruise: 60, rollRate: 2.2, pitchRate: 1.25, turn: 1.15, stall: 25 });
    this.cam = new ChaseCam(world.camera, { dist: 20, height: 5.5, look: 30 });
    this.camMode = 0;
    this.particles = new Particles(scene, 2500, { size: 3 });
    this.smoke = new Particles(scene, 800, { size: 9, additive: false }); this.smoke.gravity = 2; this.smoke.drag = 1.2;
    this.trail = new Particles(scene, 1200, { size: 1.2 }); this.trail.gravity = 0; this.trail.drag = 0.1;

    // aros
    this.rings = [];
    const spawn = new THREE.Vector3(0, 0, -3000);
    spawn.y = Math.max(H(spawn.x, spawn.z), 0) + 180;
    this.spawn = spawn;
    let p = spawn.clone(), heading = 0;
    for (let i = 0; i < 25; i++) {
      heading += (N.rnd() - 0.5) * 1.1;
      const toC = Math.atan2(-p.x, -p.z);
      if (Math.hypot(p.x, p.z) > 2600) heading = THREE.MathUtils.lerp(heading, toC, 0.5);
      const d = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      p = p.clone().addScaledVector(d, 330 + N.rnd() * 120);
      let gnd = 0; for (let k = -2; k <= 2; k++) gnd = Math.max(gnd, H(p.x + d.x * k * 40, p.z + d.z * k * 40));
      p.y = THREE.MathUtils.clamp(Math.max(gnd, 0) + 45 + N.rnd() * 110, 60, 720);
      const r = ringMesh(14);
      r.position.copy(p); r.lookAt(p.clone().add(d));
      scene.add(r); this.rings.push(r);
    }
    this.arrow = arrowMesh(); scene.add(this.arrow);
    this.next = 0; this.score = 0; this.time = 0; this.dead = 0; this.msgT = 0;
    this.respawn(spawn, 0);
    this.engine = synth.engine('engine', { type: 'sawtooth', base: 38, vol: 0.14 });
    this.wind = synth.noiseLoop('wind', { type: 'bandpass', freq: 600, q: 0.6, vol: 0.35 });
    this.say('¡Pasá por los aros dorados! 🟡', 3);
  }

  respawn(pos, heading) {
    this.plane.position.copy(pos);
    this.plane.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.flyer.speed = this.flyer.target = 60;
    this.plane.visible = true; this.dead = 0; this.cam.init = false;
  }
  say(t, d = 2) { this.hud.C.innerHTML = `<div class="msg">${t}</div>`; this.msgT = d; }

  update(dt, inp) {
    const { world, plane, flyer } = this;
    this.time += dt;
    this.water.userData.animate(dt);
    this.particles.update(dt); this.smoke.update(dt); this.trail.update(dt);
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    if (inp.bPressed) this.camMode = (this.camMode + 1) % 2;

    if (this.dead > 0) {
      this.dead -= dt;
      this.fx.rumble(Math.max(0, this.dead - 1.5));
      world.camera.lookAt(plane.position);
      if (this.dead <= 0) {
        const prev = this.next > 0 ? this.rings[this.next - 1].position : this.spawn;
        const tgt = this.rings[this.next]?.position || this.spawn;
        const pos = prev.clone(); pos.y += 30;
        this.respawn(pos, Math.atan2(tgt.x - pos.x, tgt.z - pos.z));
      }
      world.followShadow(plane.position);
      return;
    }
    if (inp.aPressed && flyer.boost < 5) { flyer.boost = 45; this.fx.sound('boost'); this.fx.vibrate([80, 40, 120]); }
    flyer.update(dt, { steer: inp.steer, pitch: -inp.tilt, gas: inp.gas, brake: inp.brake });
    // límites del mapa
    const r = Math.hypot(plane.position.x, plane.position.z);
    if (r > 4200) { const back = Math.atan2(-plane.position.x, -plane.position.z); this.respawn(plane.position.clone().setLength(4000).setY(Math.max(plane.position.y, 300)), back); this.say('Zona límite: volviendo ↩', 2); }
    if (plane.position.y > 1600) plane.position.y = 1600;
    plane.userData.prop.rotation.z += dt * (20 + flyer.speed * 0.8);

    // colisión con el suelo o agua
    const gy = Math.max(this.H(plane.position.x, plane.position.z), 0);
    if (plane.position.y < gy + 1.5) return this.crash();

    // aros
    const ring = this.rings[this.next];
    if (ring) {
      const d = plane.position.distanceTo(ring.position);
      if (d < ring.userData.radius * 1.15) {
        this.next++; this.score += 100 + Math.round(flyer.speed);
        ring.children[0].material.emissive.set(0x33ff88); ring.children[0].material.color.set(0x33ff88);
        this.particles.emit(ring.position, 160, { speed: 25, color: 0xffe066, life: 1.4 });
        this.fx.sound('ding'); this.fx.vibrate([30, 30, 30]);
        flyer.boost = Math.max(flyer.boost, 15);
        if (this.next === this.rings.length) { this.say(`🏆 ¡Completaste el circuito! ${fmt(this.time)}`, 6); this.fx.sound('win'); this.fx.vibrate([100, 60, 100, 60, 300]); }
      }
      this.arrow.visible = true;
      this.arrow.position.copy(plane.position).addScaledVector(flyer.up, 4.5);
      this.arrow.lookAt(ring.position);
    } else this.arrow.visible = false;
    this.rings.forEach((rg, i) => { rg.children[0].rotation.z += dt * (i === this.next ? 1.5 : 0.3); rg.visible = i >= this.next - 1; });

    // estelas de punta de ala
    if (flyer.gload > 2.2 || flyer.boost > 1) {
      [-7.2, 7.2].forEach((x) => { const p = new THREE.Vector3(x, 0, 0.5).applyMatrix4(plane.matrixWorld); this.trail.emit(p, 1, { speed: 0.5, color: 0x9aa4b0, life: 1.6 }); });
    }

    // cámara
    if (this.camMode === 0) this.cam.update(dt, plane.position, flyer.fwd, flyer.up, (flyer.speed - 60) * 0.18 + flyer.boost * 0.3);
    else {
      const cp = new THREE.Vector3(0, 1.15, 0.4).applyMatrix4(plane.matrixWorld);
      world.camera.position.copy(cp); world.camera.up.copy(flyer.up);
      world.camera.lookAt(cp.clone().add(flyer.fwd));
      world.camera.fov = 75; world.camera.updateProjectionMatrix();
    }
    plane.updateMatrixWorld();
    world.followShadow(plane.position);

    // sonido y vibración
    const load = 0.3 + inp.gas * 0.7;
    this.engine.set(flyer.speed / 120 + flyer.boost / 80, load);
    this.wind.set(Math.min(1, flyer.speed / 110) * 0.8, 300 + flyer.speed * 10);
    const buffet = Math.max(0, flyer.gload - 2) * 0.15 + Math.max(0, 30 - (plane.position.y - gy)) / 60;
    this.fx.rumble(Math.min(1, 0.06 + inp.gas * 0.12 + buffet + flyer.boost / 60));

    const alt = Math.round(plane.position.y - gy);
    this.hud.L.innerHTML = `<div class="g"><b>${Math.round(flyer.speed * 3.6)}</b> km/h</div><div class="g"><b>${alt}</b> m altura</div><div class="g">G ${flyer.gload.toFixed(1)}</div>`;
    this.hud.R.innerHTML = `<div class="g">🟡 <b>${this.next}</b>/${this.rings.length}</div><div class="g">⭐ ${this.score}</div><div class="g">⏱ ${fmt(this.time)}</div>`;
  }
  padHud() { return `🟡 ${this.next}/${this.rings.length} · ${Math.round(this.flyer.speed * 3.6)} km/h`; }

  crash() {
    const p = this.plane.position.clone();
    this.plane.visible = false; this.arrow.visible = false;
    this.particles.emit(p, 400, { speed: 35, color: 0xff7a1a, life: 1.6, up: 10 });
    this.particles.emit(p, 200, { speed: 18, color: 0xffee88, life: 0.8 });
    this.smoke.emit(p, 180, { speed: 10, color: 0x444444, life: 3, up: 8 });
    this.fx.sound('crash'); this.fx.vibrate([400, 100, 200, 100, 100]);
    this.dead = 3; this.score = Math.max(0, this.score - 50);
    this.say('💥 ¡Choque! Reapareciendo…', 2.5);
  }
  dispose() { this.fx.rumble(0); }
}
export const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

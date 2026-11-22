import * as THREE from 'three';
import { makeNoise, smoothstep } from '../engine/noise.js';
import { buildTerrain, naturalColor, scatterTrees, buildClouds, buildWater, Particles, terrainSlope, getDot } from '../engine/terrain.js';
import { Flyer, ChaseCam } from './flyer.js';
import { fmt } from './plane.js';

function buildOwl() {
  const g = new THREE.Group();
  const brown = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85 });
  const light = new THREE.MeshStandardMaterial({ color: 0xe9dcc4, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), brown); body.scale.set(0.95, 0.85, 1.25); g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), light); belly.scale.set(0.85, 0.7, 1.1); belly.position.set(0, -0.15, 0.05); g.add(belly);
  const head = new THREE.Group(); head.position.set(0, 0.35, 0.75); g.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), brown); hm.scale.set(1.05, 0.95, 0.95); head.add(hm);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), light); face.scale.set(1, 0.9, 0.35); face.position.z = 0.35; head.add(face);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xffb21a, emissive: 0xff9900, emissiveIntensity: 1.6, roughness: 0.2 });
  const pupM = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.5 });
  [-0.2, 0.2].forEach((x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), eyeM); e.position.set(x, 0.05, 0.5); head.add(e);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), pupM); p.position.set(x, 0.05, 0.62); head.add(p);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.35, 8), dark); tuft.position.set(x * 1.6, 0.5, 0.05); tuft.rotation.z = -x * 1.5; head.add(tuft);
  });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 8), new THREE.MeshStandardMaterial({ color: 0x3b3b3b })); beak.rotation.x = Math.PI / 2 + 0.6; beak.position.set(0, -0.1, 0.6); head.add(beak);
  // alas con "plumas"
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.3); wingShape.bezierCurveTo(1.0, 0.6, 1.9, 0.4, 2.6, 0.1);
  for (let i = 0; i < 5; i++) { const x = 2.6 - i * 0.45; wingShape.lineTo(x - 0.1, -0.45 - (i < 2 ? 0.2 : 0)); wingShape.lineTo(x - 0.35, -0.2); }
  wingShape.lineTo(0, -0.4); wingShape.closePath();
  const wg = new THREE.ExtrudeGeometry(wingShape, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 });
  wg.rotateX(Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.85, side: THREE.DoubleSide });
  const wings = [];
  [1, -1].forEach((s) => {
    const pivot = new THREE.Group(); pivot.position.set(0.45 * s, 0.2, 0.15);
    const w = new THREE.Mesh(wg, wingMat); w.scale.x = s; w.scale.multiplyScalar(1.05);
    pivot.add(w); g.add(pivot); wings.push({ pivot, s });
  });
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 12, 1, false, 0, Math.PI), dark);
  tail.rotation.x = -Math.PI / 2; tail.scale.set(1.1, 1, 0.15); tail.position.set(0, 0, -1.1); g.add(tail);
  g.traverse((o) => o.isMesh && (o.castShadow = true));
  g.userData.wings = wings; g.userData.head = head;
  g.scale.setScalar(1.4);
  return g;
}

function fireflies(heightFn, count, area, rnd) {
  const pos = new Float32Array(count * 3), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * area, z = (rnd() - 0.5) * area;
    pos.set([x, heightFn(x, z) + 1 + rnd() * 18, z], i * 3); ph[i] = rnd() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, map: { value: getDot() }, scale: { value: window.innerHeight / 2 } },
    vertexShader: `attribute float phase; uniform float time; uniform float scale; varying float vA;
      void main(){ vec3 p = position + vec3(sin(time*0.7+phase)*2.5, sin(time*1.3+phase*2.)*1.2, cos(time*0.6+phase)*2.5);
      vec4 mv = modelViewMatrix*vec4(p,1.); vA = 0.35 + 0.65*pow(0.5+0.5*sin(time*2.5+phase*7.), 3.);
      gl_PointSize = clamp(scale*0.9/ -mv.z, 1., 40.); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D map; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.,0.95,0.45)*2.*vA, t.a*vA); }`,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false;
  return p;
}

export default class OwlGame {
  constructor({ world, synth, fx, hud }) {
    Object.assign(this, { world, synth, fx, hud });
    const scene = world.scene;
    world.setupAtmosphere({ mode: 'night', elevation: 28, azimuth: 200, fog: 0.0011, fogColor: 0x0d1630, exposure: 1.0, shadowRange: 50, sunIntensity: 1.1, bloom: { strength: 0.9, radius: 0.6, threshold: 0.55 } });
    const N = makeNoise(21);
    const H = (x, z) => {
      const r = Math.hypot(x, z);
      let h = N.fbm(x * 0.0011, z * 0.0011, 5) * 70 + 40 + Math.pow(N.ridged(x * 0.0007, z * 0.0007, 4), 2) * 160;
      const river = Math.abs(N.fbm(x * 0.0005 + 9, z * 0.0005, 2)); h -= (1 - smoothstep(0.02, 0.12, river)) * 55;
      return THREE.MathUtils.lerp(h, 260, smoothstep(2400, 3200, r));
    };
    this.H = H;
    scene.add(buildTerrain({ size: 7000, segments: world.q.segments, heightFn: H, colorFn: naturalColor(N, { snowLine: 9999, night: true }) }));
    this.water = buildWater(world, { level: 5, color: 0x0a1a33, night: true }); scene.add(this.water);
    const nT = Math.floor(14000 * world.q.trees);
    this.trees = scatterTrees({ count: nT, area: 5200, heightFn: H, rnd: N.rnd, kind: 'pine', palette: [0x1d3a24, 0x23422a, 0x162e1c, 0x2a4a2c],
      accept: (x, z, y) => y > 9 && terrainSlope(H, x, z) < 0.7 && N.fbm(x * 0.003, z * 0.003, 2) > -0.25, scale: [2.2, 4.2], castShadow: false });
    scene.add(this.trees);
    // grilla de árboles para colisión
    this.grid = new Map();
    const tp = this.trees.userData.positions;
    for (let i = 0; i < tp.length; i += 4) { const k = `${Math.floor(tp[i] / 20)},${Math.floor(tp[i + 2] / 20)}`; (this.grid.get(k) || this.grid.set(k, []).get(k)).push(i); }
    this.tp = tp;
    scene.add(buildClouds({ count: Math.floor(50 * world.q.clouds), area: 5000, height: [60, 140], tint: 0x6a7aa8, shade: 0x1a2140, rnd: N.rnd, puffSize: 90 }));
    this.ff = fireflies(H, Math.floor(7000 * (0.4 + world.q.trees * 0.6)), 2600, N.rnd); scene.add(this.ff);

    // orbes mágicos
    this.orbs = [];
    const orbGeo = new THREE.IcosahedronGeometry(1.4, 2);
    const cols = [0x6ef3ff, 0xff7af5, 0xb6ff6e, 0xffd36e];
    for (let i = 0; i < 40; i++) {
      const a = N.rnd() * Math.PI * 2, rr = 200 + N.rnd() * 1800;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const c = cols[i % cols.length];
      const o = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 3, roughness: 0.3 }));
      o.position.set(x, Math.max(H(x, z), 5) + 14 + N.rnd() * 30, z);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getDot(), color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
      halo.scale.setScalar(10); o.add(halo);
      scene.add(o); this.orbs.push(o);
    }
    this.particles = new Particles(scene, 1500, { size: 1.5 }); this.particles.gravity = -1;

    this.owl = buildOwl(); scene.add(this.owl);
    const glow = new THREE.PointLight(0xb8ccff, 60, 22, 1.2); glow.position.set(0, 3, -4); this.owl.add(glow);
    const sx = 0, sz = -300; this.owl.position.set(sx, Math.max(H(sx, sz), 5) + 45, sz);
    this.flyer = new Flyer(this.owl, { minSpeed: 9, maxSpeed: 34, cruise: 17, rollRate: 2.4, pitchRate: 1.4, turn: 1.6, gravity: 0.45, stall: 11, accel: 8 });
    this.cam = new ChaseCam(world.camera, { dist: 9, height: 2.6, look: 12, stiff: 5, roll: 0.25 });
    this.flap = 0; this.flapPhase = 0; this.score = 0; this.time = 0; this.msgT = 0; this.hit = 0;
    this.wind = synth.noiseLoop('wind', { type: 'bandpass', freq: 400, q: 0.5, vol: 0.25 });
    this.crick = synth.noiseLoop('crickets', { type: 'bandpass', freq: 4800, q: 18, vol: 0.18 });
    this.say('🦉 Atrapá los orbes mágicos · ALETEAR para subir', 4);
  }
  say(t, d = 2) { this.hud.C.innerHTML = `<div class="msg">${t}</div>`; this.msgT = d; }

  nearestTree(p) {
    const cx = Math.floor(p.x / 20), cz = Math.floor(p.z / 20); const tp = this.tp;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = this.grid.get(`${cx + i},${cz + j}`); if (!l) continue;
      for (const k of l) { const dx = p.x - tp[k], dz = p.z - tp[k + 2], s = tp[k + 3]; const top = tp[k + 1] + 9.5 * s;
        if (p.y < top && dx * dx + dz * dz < (2.4 * s * (1 - (p.y - tp[k + 1]) / (9.5 * s))) ** 2 + 1) return k; }
    }
    return -1;
  }

  update(dt, inp) {
    const { owl, flyer, world } = this;
    this.time += dt;
    this.ff.material.uniforms.time.value += dt;
    this.water.userData.animate(dt);
    this.particles.update(dt);
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    // aleteo
    const flapping = inp.a > 0;
    if (flapping) this.flap = Math.min(1, this.flap + dt * 4); else this.flap = Math.max(0, this.flap - dt * 2);
    const prevPhase = this.flapPhase;
    this.flapPhase += dt * (flapping ? 11 : 1.2);
    if (flapping && Math.floor(prevPhase / Math.PI / 2) !== Math.floor(this.flapPhase / Math.PI / 2)) { this.fx.sound('flap', 'tv'); this.fx.vibrate(25); }
    const amp = 0.15 + this.flap * 0.85;
    owl.userData.wings.forEach(({ pivot, s }) => { pivot.rotation.z = s * (Math.sin(this.flapPhase) * amp * 0.9 + 0.05); pivot.rotation.y = s * Math.cos(this.flapPhase) * 0.15 * amp; });
    if (inp.bPressed) {
      this.fx.sound('hoot'); this.fx.vibrate([60, 500, 80]);
      owl.userData.head.rotation.y = 0.001; this.headTurn = 1.4;
    }
    if (this.headTurn > 0) { this.headTurn -= dt; owl.userData.head.rotation.y = Math.sin(this.headTurn * 4) * 0.6; }
    if (flapping) flyer.boost = Math.min(10, flyer.boost + dt * 25);
    flyer.update(dt, { steer: inp.steer, pitch: -inp.tilt, gas: inp.gas, brake: inp.brake }, flapping ? 7 : -1.0);

    // suelo, agua, árboles y límites
    const p = owl.position;
    const gy = Math.max(this.H(p.x, p.z), 5.5);
    if (p.y < gy + 1.2) { p.y = gy + 1.2; if (this.hit <= 0) { this.fx.vibrate([120, 40, 60]); this.fx.sound('bump'); this.hit = 0.6; flyer.speed *= 0.7; owl.rotateOnAxis(new THREE.Vector3(1, 0, 0), -0.4); } }
    if (this.hit <= 0 && this.nearestTree(p) >= 0) { this.hit = 0.8; flyer.speed *= 0.55; p.y += 3; this.fx.vibrate([150, 50, 80]); this.fx.sound('bump'); this.particles.emit(p, 40, { speed: 6, color: 0x55aa44, life: 1 }); this.say('🌲 ¡Uy, una rama!', 1.2); }
    this.hit -= dt;
    if (p.y > 420) p.y = 420;
    if (Math.hypot(p.x, p.z) > 2500) { const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dt * 1.5); owl.quaternion.premultiply(yaw); if (this.msgT <= 0) this.say('Volviendo al bosque ↩', 1.5); }

    // orbes
    for (const o of this.orbs) {
      if (!o.visible) continue;
      o.rotation.y += dt; o.position.y += Math.sin(this.time * 2 + o.id) * dt * 0.8;
      if (o.position.distanceTo(p) < 5.5) {
        o.visible = false; this.score++;
        this.particles.emit(o.position, 120, { speed: 12, color: o.material.color.getHex(), life: 1.5 });
        this.fx.sound('ding'); this.fx.vibrate([25, 25, 25, 25, 60]);
        if (this.score === this.orbs.length) { this.say(`🏆 ¡Todos los orbes! ${fmt(this.time)}`, 6); this.fx.sound('win'); }
        else this.say(`✨ ${this.score} / ${this.orbs.length}`, 1);
      }
    }
    // orbe más cercano para orientar
    let best = null, bd = 1e9; for (const o of this.orbs) if (o.visible) { const d = o.position.distanceTo(p); if (d < bd) { bd = d; best = o; } }

    this.cam.update(dt, p, flyer.fwd, flyer.up, (flyer.speed - 17) * 0.5);
    world.followShadow(p);
    this.wind.set(0.25 + flyer.speed / 34, 250 + flyer.speed * 25);
    this.crick.set(0.5 + 0.5 * Math.sin(this.time * 9) * Math.sin(this.time * 0.7), 4800);
    this.fx.rumble(Math.min(1, this.flap * 0.35 + Math.max(0, 6 - (p.y - gy)) / 12));
    let arrow = '';
    if (best) { const v = best.position.clone().sub(p); const ang = Math.atan2(v.x, v.z) - Math.atan2(flyer.fwd.x, flyer.fwd.z); arrow = `<div class="compass" style="transform:rotate(${-ang}rad)">▲</div><div class="g">${Math.round(bd)} m</div>`; }
    this.hud.L.innerHTML = `<div class="g"><b>${Math.round(flyer.speed * 3.6)}</b> km/h</div><div class="g"><b>${Math.round(p.y - gy)}</b> m</div>`;
    this.hud.R.innerHTML = `<div class="g">✨ <b>${this.score}</b>/${this.orbs.length}</div><div class="g">⏱ ${fmt(this.time)}</div>${arrow}`;
  }
  padHud() { return `✨ ${this.score}/${this.orbs.length}`; }
  dispose() {}
}

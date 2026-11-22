import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin, UnloadTilesPlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Flyer, ChaseCam } from './flyer.js';
import { buildPlaneModel, fmt } from './plane.js';
import { loadModel } from '../engine/assets.js';
import { Particles } from '../engine/terrain.js';

export const PLACES = [
  { name: 'San Nicolás', lat: -33.3335, lon: -60.2105, alt: 30, heading: 30 },
  { name: 'Rosario · Monumento a la Bandera', lat: -32.9476, lon: -60.6304, alt: 30, heading: 90 },
  { name: 'Buenos Aires · Obelisco', lat: -34.6037, lon: -58.3816, alt: 30, heading: 0 },
  { name: 'Cataratas del Iguazú', lat: -25.6953, lon: -54.4367, alt: 200, heading: 200 },
  { name: 'Bariloche · Cerro Catedral', lat: -41.1700, lon: -71.4400, alt: 1200, heading: 300 },
  { name: 'Río de Janeiro · Cristo Redentor', lat: -22.9519, lon: -43.2105, alt: 650, heading: 120 },
  { name: 'Nueva York · Manhattan', lat: 40.7484, lon: -73.9857, alt: 20, heading: 30 },
  { name: 'París · Torre Eiffel', lat: 48.8584, lon: 2.2945, alt: 40, heading: 120 },
  { name: 'Gran Cañón', lat: 36.0544, lon: -112.1401, alt: 2100, heading: 90 },
];

const KEY_LS = 'gmaps-key';
export function getKey() { return localStorage.getItem(KEY_LS) || import.meta.env.VITE_GMAPS_KEY || ''; }

export default class RealWorldGame {
  constructor({ world, synth, fx, hud }) {
    Object.assign(this, { world, synth, fx, hud });
    this.idx = +(sessionStorage.getItem('rw-place') || 0) % PLACES.length;
    this.place = PLACES[this.idx];
    const key = getKey();
    world.setupAtmosphere({ mode: 'day', lat: this.place.lat, lon: this.place.lon, height: this.place.alt, hour: 16.5, shadowRange: 40,
      clouds: { coverage: 0.32 }, env: 'skies_1k.hdr', ao: { radius: 8, intensity: 1.4 }, bloom: { strength: 0.4, threshold: 1 } });
    const scene = world.scene;
    this.plane = new THREE.Group(); scene.add(this.plane);
    this.plane.add(buildPlaneModel());
    this.flyer = new Flyer(this.plane, { minSpeed: 30, maxSpeed: 160, cruise: 70, rollRate: 2.0, pitchRate: 1.1, turn: 1.0, stall: 25 });
    this.cam = new ChaseCam(world.camera, { dist: 22, height: 6, look: 30 });
    this.particles = new Particles(scene, 1500, { size: 3 });
    this.plane.position.set(0, 450, -600);
    this.plane.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(this.place.heading));
    this.time = 0; this.dead = 0; this.rayT = 0; this.groundKnown = false; this.msgT = 0;
    this.engine = synth.engine('engine', { type: 'sawtooth', base: 38, vol: 0.14 });
    this.wind = synth.noiseLoop('wind', { type: 'bandpass', freq: 600, q: 0.6, vol: 0.35 });
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;

    this.ready = loadModel('/assets/models/plane.glb').then((g) => {
      if (!g) return;
      const m = g.scene; m.scale.setScalar(0.52); m.position.set(0, -0.4, 1.2);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
      this.plane.clear(); this.plane.add(m);
      this.mixer = new THREE.AnimationMixer(m); g.animations.forEach((a) => this.mixer.clipAction(a).play());
    });

    if (!key) { this.askKey(); return; }
    this.startTiles(key);
    this.say(`🌎 ${this.place.name}<br><small>LUGAR (botón violeta) para cambiar de ciudad</small>`, 4);
  }

  startTiles(key) {
    const { world } = this;
    const tiles = new TilesRenderer();
    tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath('/draco/') }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new UnloadTilesPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.errorTarget = world.q.name === 'low' ? 20 : world.q.name === 'ultra' ? 4 : 8;
    // las teselas vienen en ECEF: las llevamos a nuestro marco local (Y arriba en el lugar elegido)
    tiles.group.matrixAutoUpdate = false;
    tiles.group.matrix.copy(world.worldToECEF).invert();
    tiles.group.matrixWorldNeedsUpdate = true;
    const k = world.E * 2.6;
    tiles.addEventListener('load-model', ({ scene }) => {
      scene.traverse((o) => {
        if (!o.isMesh) return;
        const old = o.material;
        o.material = new THREE.MeshBasicMaterial({ map: old.map, color: new THREE.Color(k, k, k) });
        o.material.userData.cal = true;
        old.dispose();
        o.receiveShadow = true;
      });
    });
    tiles.addEventListener('load-error', (e) => {
      const msg = String(e.error?.message || e.error || '');
      if (/40[13]/.test(msg)) this.say('❌ La API key no tiene acceso a "Map Tiles API". Revisá la consola de Google Cloud.', 8);
    });
    tiles.setCamera(world.camera);
    tiles.setResolutionFromRenderer(world.camera, world.renderer);
    world.scene.add(tiles.group);
    this.tiles = tiles;
  }

  askKey() {
    this.hud.C.innerHTML = `<div class="msg keybox">
      <b>🌎 Para volar sobre el mundo real hace falta una API key de Google</b>
      <ol><li>Entrá a <u>console.cloud.google.com</u>, creá un proyecto y activá <b>Map Tiles API</b>.</li>
      <li>En <b>Credenciales</b> creá una API key (podés restringirla a este sitio).</li>
      <li>Pegala acá abajo. Queda guardada en este navegador.</li></ol>
      <input id="gkey" placeholder="AIza..." autocomplete="off"><button id="gkeyok">Guardar y volar</button></div>`;
    this.hud.C.style.pointerEvents = 'auto';
    document.getElementById('gkeyok').onclick = () => {
      const v = document.getElementById('gkey').value.trim();
      if (v.length < 20) return;
      localStorage.setItem(KEY_LS, v); this.hud.C.style.pointerEvents = ''; this.hud.C.innerHTML = '';
      this.startTiles(v); this.say(`🌎 ${this.place.name}`, 3);
    };
  }

  say(t, d = 2) { this.hud.C.innerHTML = `<div class="msg">${t}</div>`; this.msgT = d; }

  nextPlace() {
    sessionStorage.setItem('rw-place', String((this.idx + 1) % PLACES.length));
    window.__simu.launch('world');
  }

  probe(origin, dir, far) {
    if (!this.tiles) return null;
    this.ray.set(origin, dir); this.ray.far = far;
    const hit = this.ray.intersectObject(this.tiles.group, true)[0];
    return hit ? hit.distance : null;
  }

  update(dt, inp) {
    const { world, plane, flyer } = this;
    this.time += dt;
    this.particles.update(dt);
    if (this.msgT > 0 && (this.msgT -= dt) <= 0) this.hud.C.innerHTML = '';
    if (inp.bPressed) return this.nextPlace();
    if (this.tiles) { world.camera.updateMatrixWorld(); this.tiles.update(); } else { this.cam.update(dt, plane.position, flyer.fwd, flyer.up, 0); world.followShadow(plane.position); return; }

    if (this.dead > 0) {
      this.dead -= dt; world.camera.lookAt(plane.position);
      if (this.dead <= 0) { plane.position.y += 150; plane.visible = true; flyer.speed = flyer.target = 70; this.cam.init = false; }
      world.followShadow(plane.position);
      return;
    }
    if (inp.aPressed && flyer.boost < 5) { flyer.boost = 50; this.fx.sound('boost'); this.fx.vibrate([80, 40, 120]); }
    flyer.update(dt, { steer: inp.steer, pitch: -inp.tilt, gas: inp.gas, brake: inp.brake, assist: inp.assist });
    this.mixer?.update(dt * (1 + flyer.speed / 40));
    if (plane.position.y > 3000) plane.position.y = 3000;
    // colisiones con el mundo real (rayos contra las teselas)
    this.rayT -= dt;
    if (this.rayT <= 0) {
      this.rayT = 0.12;
      const down = this.probe(plane.position, new THREE.Vector3(0, -1, 0), 2000);
      if (down != null) { this.groundKnown = true; this.alt = down; }
      const fwd = this.probe(plane.position, flyer.fwd, Math.max(10, flyer.speed * 0.25));
      if ((down != null && down < 3) || fwd != null) return this.crash();
      if (!this.groundKnown && this.time > 1) this.alt = null;
    }
    this.cam.update(dt, plane.position, flyer.fwd, flyer.up, (flyer.speed - 70) * 0.15 + flyer.boost * 0.3);
    world.followShadow(plane.position);
    this.engine.set(flyer.speed / 140 + flyer.boost / 80, 0.3 + inp.gas * 0.7);
    this.wind.set(Math.min(1, flyer.speed / 130), 300 + flyer.speed * 10);
    this.fx.rumble(Math.min(1, 0.06 + inp.gas * 0.12 + Math.max(0, flyer.gload - 2) * 0.15 + (this.alt != null && this.alt < 40 ? 0.3 : 0) + flyer.boost / 60));
    const att = this.tiles ? this.tiles.getAttributions().map((a) => a.value).filter((v) => typeof v === 'string').join(' · ') : '';
    this.hud.L.innerHTML = `<div class="g"><b>${Math.round(flyer.speed * 3.6)}</b> km/h</div><div class="g"><b>${this.alt != null ? Math.round(this.alt) : '—'}</b> m sobre el suelo</div>`;
    this.hud.R.innerHTML = `<div class="g">📍 ${this.place.name}</div><div class="g">⏱ ${fmt(this.time)}</div><div class="attrib">Google${att ? ' · ' + att.slice(0, 140) : ''}</div>`;
  }
  padHud() { return `📍 ${this.place.name}`; }
  crash() {
    const p = this.plane.position.clone();
    this.plane.visible = false;
    this.particles.emit(p, 300, { speed: 30, color: 0xff7a1a, life: 1.5, up: 10 });
    this.fx.sound('crash'); this.fx.vibrate([400, 100, 200]);
    this.dead = 2.5; this.say('💥 ¡Choque! Reapareciendo más arriba…', 2.5);
  }
  dispose() { this.tiles?.dispose(); }
}

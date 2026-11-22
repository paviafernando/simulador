import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { smoothstep } from './noise.js';

// Textura de detalle procedural (multiplica los colores de vértice)
let detailTex = null;
export function getDetailTexture() {
  if (detailTex) return detailTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = 200 + Math.random() * 55;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // manchas suaves
  for (let k = 0; k < 120; k++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 6 + Math.random() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = Math.random() > 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    grd.addColorStop(0, a); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  detailTex = new THREE.CanvasTexture(c);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.colorSpace = THREE.SRGBColorSpace;
  detailTex.anisotropy = 8;
  detailTex.userData.keep = true;
  return detailTex;
}

/**
 * heightFn(x,z) -> y ; colorFn(x,z,y,slope,color) setea color
 */
export function buildTerrain({ size, segments, heightFn, colorFn, receiveShadow = true }) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    colorFn(x, z, y, slope, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 18, uv.getY(i) * size / 18);
  const tex = getDetailTexture();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, map: tex, envMapIntensity: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

export function terrainSlope(heightFn, x, z, e = 2) {
  const dx = heightFn(x + e, z) - heightFn(x - e, z);
  const dz = heightFn(x, z + e) - heightFn(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

// Paleta natural
const C = {
  sand: new THREE.Color(0xd8c28a), grass: new THREE.Color(0x4f7a2b), grass2: new THREE.Color(0x6f8f34),
  dark: new THREE.Color(0x2f4d1e), rock: new THREE.Color(0x6e665c), rock2: new THREE.Color(0x8a8378), snow: new THREE.Color(0xf4f7fb),
};
export function naturalColor(noise, opts = {}) {
  const water = opts.waterLevel ?? 0, snowLine = opts.snowLine ?? 380;
  const tmp = new THREE.Color();
  return (x, z, y, slope, out) => {
    const n = noise.fbm(x * 0.004, z * 0.004, 3) * 0.5 + 0.5;
    out.copy(C.grass).lerp(C.grass2, n).lerp(C.dark, smoothstep(0.5, 0.9, noise.fbm(x * 0.0015 + 7, z * 0.0015, 2) * 0.5 + 0.5) * 0.6);
    out.lerp(C.sand, 1 - smoothstep(water + 1.5, water + 6, y));
    tmp.copy(C.rock).lerp(C.rock2, n);
    out.lerp(tmp, smoothstep(0.22, 0.45, slope));
    const sn = smoothstep(snowLine - 40, snowLine + 40, y + n * 60) * (1 - smoothstep(0.4, 0.7, slope));
    out.lerp(C.snow, sn);
    if (opts.night) out.multiplyScalar(0.55);
  };
}

// ---------- Árboles instanciados ----------
function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 3, 6); trunk.translate(0, 1.5, 0);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.ConeGeometry(2.6 - i * 0.7, 3.4, 8); cone.translate(0, 3.4 + i * 1.8, 0); parts.push(cone);
  }
  return { foliage: mergeGeometries(parts), trunk };
}
function roundTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.3, 0.45, 3.5, 6); trunk.translate(0, 1.75, 0);
  const a = new THREE.IcosahedronGeometry(2.6, 1); a.translate(0, 5, 0);
  const b = new THREE.IcosahedronGeometry(1.9, 1); b.translate(1.3, 4.2, 0.6);
  const c = new THREE.IcosahedronGeometry(1.8, 1); c.translate(-1.2, 4.4, -0.7);
  return { foliage: mergeGeometries([a, b, c]), trunk };
}

export function scatterTrees({ count, area, center = new THREE.Vector2(), heightFn, accept, kind = 'pine', palette, rnd = Math.random, castShadow = false, scale = [0.8, 1.6] }) {
  const { foliage, trunk } = kind === 'pine' ? pineGeometry() : roundTreeGeometry();
  const fm = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: kind !== 'pine', envMapIntensity: 0.3 });
  const tm = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 });
  const F = new THREE.InstancedMesh(foliage, fm, count);
  const T = new THREE.InstancedMesh(trunk, tm, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const pal = palette || [0x2d5a27, 0x3b6b2e, 0x24481f, 0x456f2a];
  const positions = [];
  let n = 0, tries = 0;
  while (n < count && tries < count * 20) {
    tries++;
    const x = center.x + (rnd() - 0.5) * area, z = center.y + (rnd() - 0.5) * area;
    const y = heightFn(x, z);
    if (!accept(x, z, y)) continue;
    const sc = scale[0] + rnd() * (scale[1] - scale[0]);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rnd() * 0.3), sc);
    p.set(x, y - 0.3, z);
    m.compose(p, q, s);
    F.setMatrixAt(n, m); T.setMatrixAt(n, m);
    col.set(pal[Math.floor(rnd() * pal.length)]).multiplyScalar(0.8 + rnd() * 0.4);
    F.setColorAt(n, col);
    positions.push(x, y, z, sc);
    n++;
  }
  F.count = T.count = n;
  F.castShadow = T.castShadow = castShadow;
  F.receiveShadow = true;
  F.instanceMatrix.needsUpdate = T.instanceMatrix.needsUpdate = true;
  const g = new THREE.Group(); g.add(F, T);
  g.userData.positions = positions;
  return g;
}

// ---------- Nubes billboard instanciadas ----------
let puffTex = null;
function getPuff() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = 34 + Math.random() * 60, y = 34 + Math.random() * 60, r = 18 + Math.random() * 28;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  }
  puffTex = new THREE.CanvasTexture(c); puffTex.userData.keep = true;
  return puffTex;
}
export function buildClouds({ count = 60, area = 7000, height = [350, 700], tint = 0xffffff, shade = 0x9aa8bf, rnd = Math.random, puffSize = 150 }) {
  const puffsPer = 14;
  const N = count * puffsPer;
  const geo = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
  const offs = new Float32Array(N * 4);
  let k = 0;
  for (let c = 0; c < count; c++) {
    const cx = (rnd() - 0.5) * area, cz = (rnd() - 0.5) * area, cy = height[0] + rnd() * (height[1] - height[0]);
    const w = 1 + rnd() * 1.5;
    for (let i = 0; i < puffsPer; i++) {
      offs[k++] = cx + (rnd() - 0.5) * puffSize * 3 * w;
      offs[k++] = cy + (rnd() - 0.3) * puffSize * 0.6;
      offs[k++] = cz + (rnd() - 0.5) * puffSize * 1.6 * w;
      offs[k++] = puffSize * (0.8 + rnd() * 1.2);
    }
  }
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offs, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: getPuff() }, tint: { value: new THREE.Color(tint) }, shade: { value: new THREE.Color(shade) }, opacity: { value: 0.85 },
    }]),
    vertexShader: `attribute vec4 offset; varying vec2 vUv; varying float vH;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vH = position.y + 0.5; vec4 mvPosition = viewMatrix * vec4(offset.xyz,1.);
      mvPosition.xy += position.xy * offset.w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; uniform vec3 shade; uniform float opacity; varying vec2 vUv; varying float vH;
      #include <fog_pars_fragment>
      void main(){ vec4 t = texture2D(map, vUv); vec3 c = mix(shade, tint, smoothstep(0.1,0.9,vH)); gl_FragColor = vec4(c, t.a*opacity);
      if(gl_FragColor.a<0.01) discard;
      #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

// ---------- Agua ----------
function waterNormals() {
  const S = 256, data = new Uint8Array(S * S * 4);
  const h = new Float32Array(S * S);
  for (let w = 0; w < 24; w++) {
    const kx = Math.round((Math.random() - 0.5) * 16), ky = Math.round((Math.random() - 0.5) * 16), ph = Math.random() * 6.28, a = 1 / (1 + Math.hypot(kx, ky));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] += a * Math.sin((kx * x + ky * y) / S * Math.PI * 2 + ph);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
    const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const v = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
    const i = (y * S + x) * 4;
    data[i] = (v.x * 0.5 + 0.5) * 255; data[i + 1] = (v.y * 0.5 + 0.5) * 255; data[i + 2] = (v.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
export function buildWater(world, { size = 20000, level = 0, color = 0x1d4a6a, sunColor = 0xffffff, night = false } = {}) {
  const geo = new THREE.PlaneGeometry(size, size);
  let mesh;
  if (world.q.water) {
    mesh = new Water(geo, {
      textureWidth: 512, textureHeight: 512, waterNormals: waterNormals(),
      sunDirection: world.sunDir.clone(), sunColor, waterColor: color, distortionScale: 3.2, fog: true,
    });
    mesh.material.uniforms.size.value = 4;
    mesh.userData.animate = (dt) => { mesh.material.uniforms.time.value += dt * 0.6; };
  } else {
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.92 }));
    mesh.userData.animate = () => {};
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = level;
  if (night) mesh.material.uniforms && (mesh.material.uniforms.sunColor.value.set(0x8899cc));
  return mesh;
}

// ---------- Partículas (explosiones, chispas) ----------
let dotTex = null;
export function getDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c); dotTex.userData.keep = true; return dotTex;
}
export class Particles {
  constructor(scene, max = 1500, { size = 2, additive = true } = {}) {
    this.max = max; this.n = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size, map: getDot(), vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.gravity = -6; this.drag = 0.6;
  }
  emit(p, count, { speed = 10, color = 0xffaa33, life = 1.2, spread = 1, up = 0, dir = null } = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const k = this.n % this.max; this.n++;
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7) * spread);
      if (dir) v.addScaledVector(dir, speed);
      v.y += up;
      this.pos.set([p.x, p.y, p.z], k * 3); this.vel.set([v.x, v.y, v.z], k * 3);
      this.baseCol.set([c.r, c.g, c.b], k * 3);
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.6);
    }
  }
  update(dt) {
    const d = Math.exp(-this.drag * dt);
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) { this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0; continue; }
      this.life[k] -= dt;
      const f = Math.max(0, this.life[k] / this.maxLife[k]);
      this.vel[k * 3] *= d; this.vel[k * 3 + 1] = this.vel[k * 3 + 1] * d + this.gravity * dt; this.vel[k * 3 + 2] *= d;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.col[k * 3] = this.baseCol[k * 3] * f; this.col[k * 3 + 1] = this.baseCol[k * 3 + 1] * f; this.col[k * 3 + 2] = this.baseCol[k * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

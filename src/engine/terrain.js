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

// ---------- Texturas PBR reales (ambientCG, CC0) ----------
const TL = new THREE.TextureLoader();
const texCache = {};
export function tex(name, srgb = true, repeat = true) {
  if (texCache[name]) return texCache[name];
  const t = TL.load(`/assets/tex/${name}`);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.userData.keep = true;
  texCache[name] = t; return t;
}
export const SHARED = { time: { value: 0 }, wind: { value: 1 } };

/** Material de terreno: mezcla pasto / roca (triplanar) / nieve / arena con normal maps reales. */
export function terrainMaterial({ night = false, sand = 0xcbb68a, scale = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: night ? 0.25 : 0.5 });
  const U = {
    gAlb: { value: tex('grass_Color.jpg') }, gNrm: { value: tex('grass_Normal.jpg', false) },
    rAlb: { value: tex('rock_Color.jpg') }, rNrm: { value: tex('rock_Normal.jpg', false) },
    sandCol: { value: new THREE.Color(sand) }, tScale: { value: scale },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vSplat = splat; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D gAlb, gNrm, rAlb, rNrm; uniform vec3 sandCol; uniform float tScale;
        varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;
        vec3 tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z; }
        vec3 triN(sampler2D t, vec3 p, vec3 w, vec3 n, float k) {
          vec3 tx = texture2D(t, p.zy).xyz * 2. - 1., ty = texture2D(t, p.xz).xyz * 2. - 1., tz = texture2D(t, p.xy).xyz * 2. - 1.;
          tx.xy *= k; ty.xy *= k; tz.xy *= k;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x); ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y); tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
        }`)
      .replace('#include <map_fragment>', `
        vec3 nW = normalize(vWNrm);
        vec3 bw = pow(abs(nW), vec3(6.)); bw /= (bw.x + bw.y + bw.z);
        vec3 pA = vWPos / (5.5 * tScale), pB = vWPos / (21.0 * tScale) + 0.37, pR = vWPos / (14.0 * tScale);
        vec3 grass = mix(texture2D(gAlb, pA.xz).rgb, texture2D(gAlb, pB.xz).rgb, 0.45);
        vec3 rock = mix(tri(rAlb, pR, bw), tri(rAlb, pR * 0.27 + 0.5, bw), 0.4);
        float rl = dot(rock, vec3(0.3, 0.59, 0.11));
        vec3 sandC = sandCol * (0.75 + 0.6 * rl);
        vec3 snowC = vec3(0.86, 0.9, 0.97) * (0.85 + 0.25 * rl);
        vec4 w4 = vSplat / max(1e-3, dot(vSplat, vec4(1.)));
        diffuseColor.rgb *= grass * w4.x * 0.72 + rock * w4.y * 1.05 + snowC * w4.z + sandC * w4.w * 0.8;`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = dot(w4, vec4(0.95, 0.82, 0.55, 0.92));`)
      .replace('#include <normal_fragment_maps>', `
        vec3 topW = vec3(0., 1., 0.);
        vec3 nGr = triN(gNrm, pA, vec3(0.05, 0.9, 0.05), nW, 0.9);
        vec3 nRk = triN(rNrm, pR, bw, nW, 1.2);
        vec3 nSo = triN(rNrm, pR, bw, nW, 0.35);
        vec3 nWorld = normalize(nGr * w4.x + nRk * w4.y + nSo * (w4.z + w4.w));
        normal = normalize((viewMatrix * vec4(nWorld, 0.)).xyz);`);
  };
  mat.customProgramCacheKey = () => 'terrain-v2';
  return mat;
}

/**
 * Terreno: heightFn(x,z) -> y. Calcula pesos de textura según altura/pendiente.
 * opts: waterLevel, snowLine, rockSlope, tintFn(x,z,y,out), splatFn(x,z,y,slope,w) para personalizar
 */
export function buildTerrain({ size, segments, heightFn, colorFn, noise, waterLevel = 0, snowLine = 9999, rockSlope = 0.32, night = false, splatFn, receiveShadow = true, sand }) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3), splat = new Float32Array(pos.count * 4);
  const c = new THREE.Color(), w = [0, 0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = noise ? noise.fbm(x * 0.01, z * 0.01, 2) : 0;
    let rock = smoothstep(rockSlope - 0.1, rockSlope + 0.12, slope + n * 0.06);
    let snow = smoothstep(snowLine - 50, snowLine + 30, y + n * 50) * (1 - smoothstep(0.55, 0.85, slope));
    let sandW = 1 - smoothstep(waterLevel + 1.5, waterLevel + 5 + n * 2, y);
    w[3] = sandW * (1 - rock * 0.6); w[2] = snow; w[1] = rock * (1 - snow * 0.7); w[0] = Math.max(0, 1 - w[1] - w[2] - w[3]);
    if (splatFn) splatFn(x, z, y, slope, w);
    splat.set(w, i * 4);
    c.setRGB(1, 1, 1);
    if (colorFn) colorFn(x, z, y, slope, c);
    if (night) c.multiplyScalar(0.6);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  const mesh = new THREE.Mesh(geo, terrainMaterial({ night, sand }));
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

export function terrainSlope(heightFn, x, z, e = 2) {
  const dx = heightFn(x + e, z) - heightFn(x - e, z);
  const dz = heightFn(x, z + e) - heightFn(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

// Tinte macro (variación de color a gran escala sobre las texturas)
export function naturalColor(noise, opts = {}) {
  const dry = new THREE.Color(opts.dry ?? 0xd6c48e), lush = new THREE.Color(opts.lush ?? 0x6f9a48);
  const white = new THREE.Color(1, 1, 1);
  return (x, z, y, slope, out) => {
    const n = noise.fbm(x * 0.0025, z * 0.0025, 3) * 0.5 + 0.5;
    const m = noise.fbm(x * 0.0009 + 5, z * 0.0009, 2) * 0.5 + 0.5;
    out.copy(white).lerp(lush, 0.25 + smoothstep(0.5, 0.9, n) * 0.4).lerp(dry, smoothstep(0.55, 0.85, m) * 0.4);
    out.multiplyScalar(0.92 + n * 0.16);
  };
}

// ---------- Árboles instanciados ----------
function jagged(geo, amp, seed) {
  const p = geo.attributes.position; let k = seed;
  const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    if (r > 0.05) { const f = 1 + (rnd() - 0.5) * amp; p.setX(i, x * f); p.setZ(i, z * f); p.setY(i, p.getY(i) + (rnd() - 0.5) * amp * 0.6); }
  }
  geo.computeVertexNormals();
  return geo;
}
function shade(geo, top, bottom, inner = 0.55) {
  geo.computeBoundingBox(); const bb = geo.boundingBox; const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y + 1e-6);
    const r = Math.min(1, Math.hypot(p.getX(i), p.getZ(i)) / 2.2);
    const v = THREE.MathUtils.lerp(bottom, top, t) * THREE.MathUtils.lerp(inner, 1, r);
    col.set([v, v, v], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.42, 4, 7); trunk.translate(0, 2, 0);
  const layers = 6;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const r = THREE.MathUtils.lerp(2.9, 0.7, t), h = THREE.MathUtils.lerp(2.8, 1.8, t);
    const cone = new THREE.ConeGeometry(r, h, 11, 2, true); cone.translate(0, 2.4 + i * 1.35 + h / 2, 0);
    parts.push(jagged(cone, 0.35, 7 + i * 13));
  }
  const tip = new THREE.ConeGeometry(0.4, 1.6, 7); tip.translate(0, 2.4 + layers * 1.35 + 0.6, 0); parts.push(tip);
  const foliage = shade(mergeGeometries(parts.map((g) => g.toNonIndexed())), 1.05, 0.55);
  return { foliage, trunk };
}
function roundTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.25, 0.45, 4, 7); trunk.translate(0, 2, 0);
  const blobs = [];
  const spots = [[0, 5.4, 0, 2.5], [1.5, 4.6, 0.5, 1.9], [-1.4, 4.8, -0.6, 1.9], [0.3, 6.6, -0.4, 1.7], [-0.4, 4.3, 1.4, 1.6], [0.6, 4.4, -1.5, 1.6]];
  spots.forEach(([x, y, z, r], i) => { const g = new THREE.IcosahedronGeometry(r, 2); g.translate(x, y, z); blobs.push(jagged(g, 0.28, 31 + i * 17)); });
  const foliage = shade(mergeGeometries(blobs.map((g) => g.toNonIndexed())), 1.1, 0.6, 0.7);
  return { foliage, trunk };
}
function windify(mat, amount = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = SHARED.time; sh.uniforms.uWind = SHARED.wind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float sway = pow(max(0., position.y) / 9., 1.6) * uWind * ${amount.toFixed(2)};
          transformed.x += sin(uTime * 1.3 + ip.x * 0.05 + ip.z * 0.03) * 0.35 * sway + sin(uTime * 4.1 + position.y + ip.z) * 0.06 * sway;
          transformed.z += cos(uTime * 1.1 + ip.z * 0.05) * 0.25 * sway;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'wind' + amount;
  return mat;
}

export function scatterTrees({ count, area, center = new THREE.Vector2(), heightFn, accept, kind = 'pine', palette, rnd = Math.random, castShadow = false, scale = [0.8, 1.6] }) {
  const { foliage, trunk } = kind === 'pine' ? pineGeometry() : roundTreeGeometry();
  const fm = windify(new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true, flatShading: true, envMapIntensity: 0.3, side: THREE.DoubleSide }));
  const tm = new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 1, map: tex('rock_Color.jpg') });
  const F = new THREE.InstancedMesh(foliage, fm, count);
  const T = new THREE.InstancedMesh(trunk, tm, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const pal = palette || [0x2b4f22, 0x36602a, 0x1f3e1a, 0x41652a];
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
export function buildClouds({ count = 60, area = 7000, height = [350, 700], tint = 0xffffff, shade = 0x9aa8bf, rnd = Math.random, puffSize = 150, E = 1 }) {
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
      map: { value: getPuff() }, tint: { value: new THREE.Color(tint).multiplyScalar(E * 1.4) }, shade: { value: new THREE.Color(shade).multiplyScalar(E * 1.4) }, opacity: { value: 0.85 },
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
      textureWidth: world.q.name === 'ultra' ? 1024 : 512, textureHeight: world.q.name === 'ultra' ? 1024 : 512, waterNormals: tex('waternormals.jpg', false),
      sunDirection: world.sunDir.clone(), sunColor: new THREE.Color(sunColor).multiplyScalar(world.E * 3), waterColor: new THREE.Color(color).multiplyScalar(world.E), distortionScale: 3.2, fog: !!world.scene.fog,
    });
    mesh.material.uniforms.size.value = 4;
    mesh.userData.animate = (dt) => { mesh.material.uniforms.time.value += dt * 0.6; };
  } else {
    mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.94 }));
    mesh.userData.animate = () => {};
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = level;
  if (night && mesh.material.uniforms) mesh.material.uniforms.sunColor.value.set(0x8899cc);
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

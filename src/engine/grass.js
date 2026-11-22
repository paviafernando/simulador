import * as THREE from 'three';
import { SHARED } from './terrain.js';

/**
 * Pasto en GPU: miles de hojas instanciadas que "siguen" a la cámara (se re-envuelven en un cuadrado),
 * con altura del terreno y máscara horneadas en una textura, y viento en el vertex shader.
 * heightFn(x,z) -> y ; maskFn(x,z) -> 0..1 (densidad)
 */
export function buildGrass({ heightFn, maskFn, area, center = new THREE.Vector2(), res = 512, count = 120000, radius = 70, color = 0x5d8a2e, tip = 0xc8d27a, E = 1, bladeH = 0.7 }) {
  // hornear altura + máscara
  const data = new Float32Array(res * res * 4);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = center.x + (i / (res - 1) - 0.5) * area, z = center.y + (j / (res - 1) - 0.5) * area;
    const k = (j * res + i) * 4;
    data[k] = heightFn(x, z); data[k + 1] = maskFn ? maskFn(x, z) : 1;
  }
  const hm = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
  hm.minFilter = hm.magFilter = THREE.LinearFilter; hm.needsUpdate = true;

  // hoja: 3 segmentos que se afinan
  const blade = new THREE.BufferGeometry();
  const w = 0.1, pos = [], idx = [];
  const segs = 4;
  for (let s = 0; s <= segs; s++) { const t = s / segs, ww = w * (1 - t * 0.9); pos.push(-ww, t, 0, ww, t, 0); }
  for (let s = 0; s < segs; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); blade.setIndex(idx);
  const g = new THREE.InstancedBufferGeometry(); g.index = blade.index; g.attributes.position = blade.attributes.position;
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) off.set([Math.random(), Math.random(), Math.random() * 6.283, 0.6 + Math.random() * 0.8], i * 4);
  g.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 4));
  g.instanceCount = count;

  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, side: THREE.DoubleSide });
  const U = { hm: { value: hm }, area: { value: area }, center: { value: center.clone() }, radius: { value: radius }, camXZ: { value: new THREE.Vector2() },
    tipCol: { value: new THREE.Color(tip) }, bladeH: { value: bladeH }, uTime: SHARED.time, uWind: SHARED.wind };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 offset; uniform sampler2D hm; uniform float area; uniform vec2 center; uniform float radius; uniform vec2 camXZ;
      uniform float bladeH; uniform float uTime; uniform float uWind; varying float vT; varying float vFade;`)
      .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0., 1., 0.);`)
      .replace('#include <begin_vertex>', `
        vec2 cell = vec2(radius * 2.);
        vec2 p = camXZ + (fract(offset.xy - camXZ / cell) - 0.5) * cell;
        vec2 uvh = (p - center) / area + 0.5;
        vec4 h = texture2D(hm, uvh);
        float d = length(p - camXZ) / radius;
        float dens = h.y * step(0.0, uvh.x) * step(uvh.x, 1.0) * step(0.0, uvh.y) * step(uvh.y, 1.0);
        float keep = step(fract(offset.w * 13.7), dens);
        vFade = 1.0 - smoothstep(0.65, 1.0, d);
        float hgt = bladeH * offset.w * keep * vFade;
        float t = position.y; vT = t;
        float c = cos(offset.z), s = sin(offset.z);
        vec3 local = vec3(position.x * c, t * hgt, position.x * s);
        float wv = sin(uTime * 1.8 + p.x * 0.15 + p.y * 0.1) * 0.5 + sin(uTime * 3.7 + p.x * 0.6) * 0.2;
        local.x += wv * t * t * hgt * 0.45 * uWind; local.z += wv * t * t * hgt * 0.2 * uWind;
        vec3 transformed = vec3(p.x, h.x, p.y) + local;`)
      .replace('#include <project_vertex>', `vec4 mvPosition = viewMatrix * vec4(transformed, 1.0); gl_Position = projectionMatrix * mvPosition;`)
      .replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 tipCol; varying float vT; varying float vFade;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb * 0.7, tipCol, smoothstep(0.0, 1.0, vT) * 0.85);`);
  };
  mat.customProgramCacheKey = () => 'grass-v1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  mesh.userData.update = (camera) => U.camXZ.value.set(camera.position.x, camera.position.z);
  void E;
  return mesh;
}

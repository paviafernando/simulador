import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = {};

/** Carga un glTF una sola vez y devuelve { scene, animations } (clonar con cloneModel). */
export function loadModel(url) {
  if (!cache[url]) cache[url] = new Promise((res) => loader.load(url, (g) => res(g), undefined, (e) => { console.warn('No se pudo cargar', url, e); res(null); }));
  return cache[url];
}
export async function tryModel(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); if (!r.ok || !(r.headers.get('content-type') || '').match(/octet|gltf|model|binary/)) return null; } catch (e) { return null; }
  return loadModel(url);
}
export function cloneModel(gltf) {
  const s = gltf.scene.clone(true);
  s.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = true; o.receiveShadow = true; } });
  return s;
}
/** Escala un objeto para que su dimensión mayor mida `size` y lo centra en el origen (base en y=0 si ground). */
export function fitObject(obj, size, ground = false) {
  const box = new THREE.Box3().setFromObject(obj);
  const dim = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = size / Math.max(dim.x, dim.y, dim.z);
  obj.scale.multiplyScalar(s);
  obj.position.sub(c.multiplyScalar(s));
  if (ground) obj.position.y += (dim.y * s) / 2;
  const g = new THREE.Group(); g.add(obj); return g;
}

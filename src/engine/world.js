import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, bloom: false, water: false, trees: 0.35, segments: 160, clouds: 0.4 },
  medium: { pixelRatio: 1.25, shadows: true, shadowSize: 1024, bloom: true, water: true, trees: 0.65, segments: 220, clouds: 0.7 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, bloom: true, water: true, trees: 1, segments: 300, clouds: 1 },
};

export class World {
  constructor(canvas, qualityName = 'high') {
    this.canvas = canvas;
    this.setQualityName(qualityName);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 30000);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.composer = null;
    this.shadowTarget = new THREE.Vector3();
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQualityName(name) { this.qualityName = name; this.q = QUALITY[name] || QUALITY.high; }

  applyQuality() {
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) this.composer.dispose?.();
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.6, 0.85);
    this.bloom.enabled = this.q.bloom;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio?.(this.renderer.getPixelRatio());
  }

  clear() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        for (const k in m) if (m[k] && m[k].isTexture && !m[k].userData.keep) m[k].dispose();
        m.dispose();
      });
    });
    this.scene.clear();
    this.scene.fog = null;
    this.scene.background = null;
    this.scene.environment = null;
    this.sun = null;
  }

  /**
   * opts: { mode:'day'|'sunset'|'night', elevation, azimuth, fog, fogColor, exposure, bloom:{strength,radius,threshold} }
   */
  setupAtmosphere(opts) {
    const scene = this.scene;
    const mode = opts.mode || 'day';
    this.renderer.toneMappingExposure = opts.exposure ?? (mode === 'night' ? 0.9 : 0.55);
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1,
      THREE.MathUtils.degToRad(90 - (opts.elevation ?? 25)), THREE.MathUtils.degToRad(opts.azimuth ?? 180));
    this.sunDir = sunDir;

    if (mode !== 'night') {
      const sky = new Sky();
      sky.scale.setScalar(20000);
      const u = sky.material.uniforms;
      u.turbidity.value = opts.turbidity ?? (mode === 'sunset' ? 6 : 4);
      u.rayleigh.value = opts.rayleigh ?? (mode === 'sunset' ? 2.2 : 1.4);
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.85;
      u.sunPosition.value.copy(sunDir);
      // env map desde el cielo
      const envScene = new THREE.Scene();
      const sky2 = new Sky(); sky2.scale.setScalar(1000);
      Object.keys(u).forEach((k) => (sky2.material.uniforms[k].value = u[k].value));
      envScene.add(sky2);
      const rt = this.pmrem.fromScene(envScene, 0.02);
      scene.environment = rt.texture;
      sky2.geometry.dispose(); sky2.material.dispose();
      scene.add(sky);
      this.skyMesh = sky;
    } else {
      // Noche: gradiente + estrellas + luna
      const g = new THREE.SphereGeometry(18000, 32, 16);
      const m = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new THREE.Color(0x020414) }, bottom: { value: new THREE.Color(0x1a2a55) }, moonDir: { value: sunDir } },
        vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 moonDir; varying vec3 vP;
          void main(){ float h = clamp(vP.y*1.6+0.15,0.,1.); vec3 c = mix(bottom, top, pow(h,0.6));
          float md = max(dot(normalize(vP), normalize(moonDir)),0.); c += vec3(0.35,0.45,0.7)*pow(md,40.)*0.6 + vec3(0.2,0.25,0.4)*pow(md,6.)*0.25;
          gl_FragColor = vec4(c,1.); }`,
      });
      const skyMesh = new THREE.Mesh(g, m); skyMesh.renderOrder = -10; scene.add(skyMesh);
      this.skyMesh = skyMesh;
      // estrellas
      const N = 4000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.05; v.normalize().multiplyScalar(16000);
        pos.set([v.x, v.y, v.z], i * 3);
        const t = Math.random(); col.set([0.8 + t * 0.2, 0.85 + t * 0.1, 1], i * 3);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
      skyMesh.add(stars);
      // luna
      const moon = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false }));
      moon.position.copy(sunDir).multiplyScalar(15000);
      skyMesh.add(moon);
      const env = new THREE.Scene(); env.background = new THREE.Color(0x0b1230);
      const rt = this.pmrem.fromScene(env, 0); scene.environment = rt.texture;
    }

    // Luces
    const sunColor = mode === 'sunset' ? 0xffb070 : mode === 'night' ? 0x9db4ff : 0xfff2e0;
    const sun = new THREE.DirectionalLight(sunColor, opts.sunIntensity ?? (mode === 'night' ? 0.9 : mode === 'sunset' ? 2.6 : 3.2));
    sun.castShadow = this.q.shadows;
    const sc = sun.shadow.camera; const S = opts.shadowRange ?? 120;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 1500;
    sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(
      mode === 'night' ? 0x3a4a80 : mode === 'sunset' ? 0xffc9a0 : 0xbfd8ff,
      mode === 'night' ? 0x0a0a14 : 0x5a4a35, mode === 'night' ? 0.5 : 0.9);
    scene.add(hemi);
    const fogColor = new THREE.Color(opts.fogColor ?? (mode === 'night' ? 0x101a38 : mode === 'sunset' ? 0xe8a882 : 0xbcd3ea));
    scene.fog = new THREE.FogExp2(fogColor, opts.fog ?? 0.00028);
    const b = opts.bloom || {};
    this.bloom.strength = b.strength ?? 0.35; this.bloom.radius = b.radius ?? 0.5; this.bloom.threshold = b.threshold ?? 0.9;
  }

  followShadow(target) {
    if (!this.sun) return;
    this.sun.position.copy(target).addScaledVector(this.sunDir, 600);
    this.sun.target.position.copy(target);
    if (this.skyMesh) this.skyMesh.position.copy(this.camera.position);
  }

  render() {
    if (this.q.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { AerialPerspectiveEffect, PrecomputedTexturesLoader, SkyMaterial, SunDirectionalLight, SkyLightProbe, getSunDirectionECEF, getMoonDirectionECEF } from '@takram/three-atmosphere';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { Ellipsoid, Geodetic, radians, DataTextureLoader, parseUint8Array, STBNLoader } from '@takram/three-geospatial';

// Presets de calidad: deciden resolución, sombras, oclusión ambiental, nubes volumétricas, densidad de vegetación…
export const QUALITY = {
  low: { name: 'low', pixelRatio: 1, shadows: false, shadowSize: 1024, ao: false, clouds: null, smaa: false, water: false, trees: 0.35, segments: 150, grass: 0, billboardClouds: 0.5 },
  medium: { name: 'medium', pixelRatio: 1, shadows: true, shadowSize: 1024, ao: 'half', clouds: 'low', smaa: true, water: true, trees: 0.6, segments: 220, grass: 0.45, billboardClouds: 0 },
  high: { name: 'high', pixelRatio: 1.5, shadows: true, shadowSize: 2048, ao: 'full', clouds: 'medium', smaa: true, water: true, trees: 1, segments: 300, grass: 1, billboardClouds: 0 },
  ultra: { name: 'ultra', pixelRatio: 2, shadows: true, shadowSize: 4096, ao: 'full', clouds: 'high', smaa: true, water: true, trees: 1.3, segments: 380, grass: 1.6, billboardClouds: 0 },
};

// San Nicolás de los Arroyos: el "origen" del mundo para el cálculo de la atmósfera y el sol
export const HOME = { lat: -33.33, lon: -60.22, height: 25 };
const ATMO_EXPOSURE = 10;

const texCache = {};
const rgbe = new RGBELoader();

export class World {
  constructor(canvas, qualityName = 'high') {
    this.canvas = canvas;
    this.setQualityName(qualityName);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 60000);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.E = 1; // escala de emisivos (en modo atmósfera la escena está en radiancia física)
    this.worldToECEF = new THREE.Matrix4();
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.sunDirECEF = new THREE.Vector3();
    this.moonDirECEF = new THREE.Vector3();
    this.atmo = null;
    this.loadAtmosphereData();
    this.applyQuality();
    window.addEventListener('resize', () => this.resize());
  }

  setQualityName(name) { this.qualityName = QUALITY[name] ? name : 'high'; this.q = QUALITY[this.qualityName]; }

  applyQuality() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.shadowMap.enabled = this.q.shadows;
    if (this.lastOpts) this.buildComposer(this.lastOpts);
    this.resize();
  }

  // ---------- Datos precomputados de la atmósfera y nubes (se cargan una vez) ----------
  loadAtmosphereData() {
    this.atmoTextures = new PrecomputedTexturesLoader().setType(this.renderer).load('/atmosphere');
    const cfg = (t, three = false) => {
      t.minFilter = three ? THREE.LinearFilter : THREE.LinearMipMapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; if (three) { t.wrapR = THREE.RepeatWrapping; t.format = THREE.RedFormat; }
      t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t;
    };
    this.cloudTex = {};
    const tl = new THREE.TextureLoader();
    tl.load('/clouds/local_weather.png', (t) => (this.cloudTex.localWeatherTexture = cfg(t)));
    tl.load('/clouds/turbulence.png', (t) => (this.cloudTex.turbulenceTexture = cfg(t)));
    new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, { width: CLOUD_SHAPE_TEXTURE_SIZE, height: CLOUD_SHAPE_TEXTURE_SIZE, depth: CLOUD_SHAPE_TEXTURE_SIZE })
      .load('/clouds/shape.bin', (t) => (this.cloudTex.shapeTexture = cfg(t, true)));
    new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, { width: CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, height: CLOUD_SHAPE_DETAIL_TEXTURE_SIZE, depth: CLOUD_SHAPE_DETAIL_TEXTURE_SIZE })
      .load('/clouds/shape_detail.bin', (t) => (this.cloudTex.shapeDetailTexture = cfg(t, true)));
    new STBNLoader().load('/core/stbn.bin', (t) => (this.cloudTex.stbnTexture = t));
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  clear() {
    this.scene.traverse((o) => {
      if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m.userData.keep) return;
        for (const k in m) if (m[k] && m[k].isTexture && !m[k].userData.keep) m[k].dispose();
        m.dispose();
      });
    });
    this.scene.clear();
    this.scene.fog = null; this.scene.background = null; this.scene.environment = null;
    this.sun = null; this.atmo = null; this.skyMesh = null;
    this.composer?.dispose(); this.composer = null;
    this.camera.fov = 70; this.camera.up.set(0, 1, 0); this.camera.updateProjectionMatrix();
  }

  /** Mapa de entorno HDRI para reflejos (auto, agua, metales) */
  async loadEnv(name, intensity = 1) {
    const key = 'env:' + name;
    if (!texCache[key]) {
      texCache[key] = new Promise((res) => rgbe.load(`/assets/hdri/${name}`, (t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        const rt = this.pmrem.fromEquirectangular(t); t.dispose(); rt.texture.userData.keep = true; res(rt.texture);
      }, undefined, () => res(null)));
    }
    const env = await texCache[key];
    if (env) { this.scene.environment = env; this.scene.environmentIntensity = intensity; }
    return env;
  }

  /**
   * opts: { mode:'day'|'sunset'|'night', hour, lat, lon, clouds:{coverage, altitude, height}|false,
   *         env:'archivo.hdr', envIntensity, shadowRange, bloom:{strength,threshold}, ao:{radius,intensity} }
   */
  setupAtmosphere(opts) {
    this.lastOpts = opts;
    const scene = this.scene, mode = opts.mode || 'day';
    if (mode === 'night') this.setupNight(opts);
    else this.setupPhysicalSky(opts);
    if (opts.env) this.loadEnv(opts.env, (opts.envIntensity ?? 1) * (mode === 'night' ? 1 : 0.06));
    this.buildComposer(opts);
    void scene;
  }

  setupPhysicalSky(opts) {
    const scene = this.scene;
    this.E = 1 / ATMO_EXPOSURE;
    this.renderer.toneMappingExposure = (opts.exposure ?? 0.5) * ATMO_EXPOSURE;
    // marco local: X norte, Y arriba, Z este, con el origen en el lugar elegido
    const g = new Geodetic(radians(opts.lon ?? HOME.lon), radians(opts.lat ?? HOME.lat), opts.height ?? HOME.height);
    Ellipsoid.WGS84.getNorthUpEastFrame(g.toECEF(new THREE.Vector3()), this.worldToECEF);
    // fecha/hora local (UTC-3)
    const now = new Date();
    const hour = opts.hour ?? 11;
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0) + (hour + 3) * 3600e3);
    getSunDirectionECEF(date, this.sunDirECEF);
    getMoonDirectionECEF(date, this.moonDirECEF);
    const rot = new THREE.Matrix3().setFromMatrix4(this.worldToECEF).transpose();
    this.sunDir.copy(this.sunDirECEF).applyMatrix3(rot).normalize();

    const T = this.atmoTextures;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new SkyMaterial());
    sky.frustumCulled = false;
    Object.assign(sky.material, T);
    sky.material.sunDirection.copy(this.sunDirECEF);
    sky.material.moonDirection.copy(this.moonDirECEF);
    sky.material.worldToECEFMatrix.copy(this.worldToECEF);
    sky.material.groundAlbedo?.set(0x4a5a3a);
    scene.add(sky); this.skyMesh = sky;

    const sun = new SunDirectionalLight({ distance: 800 });
    sun.transmittanceTexture = T.transmittanceTexture;
    sun.sunDirection.copy(this.sunDirECEF); sun.worldToECEFMatrix.copy(this.worldToECEF);
    sun.castShadow = this.q.shadows;
    const S = opts.shadowRange ?? 120, sc = sun.shadow.camera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 2000;
    sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.5;
    scene.add(sun, sun.target);
    const skyLight = new SkyLightProbe();
    skyLight.irradianceTexture = T.irradianceTexture;
    skyLight.sunDirection.copy(this.sunDirECEF); skyLight.worldToECEFMatrix.copy(this.worldToECEF);
    scene.add(skyLight);
    this.sun = sun; this.skyLight = skyLight;

    const ap = new AerialPerspectiveEffect(this.camera, { correctAltitude: true });
    Object.assign(ap, T);
    ap.sunDirection.copy(this.sunDirECEF); ap.worldToECEFMatrix.copy(this.worldToECEF);
    ap.inscatter = opts.haze !== false;
    this.atmo = { ap, clouds: null };

    if (this.q.clouds && opts.clouds !== false && !new URLSearchParams(location.search).has('noclouds')) {
      const c = new CloudsEffect(this.camera);
      c.qualityPreset = this.q.clouds;
      Object.assign(c, T);
      c.sunDirection.copy(this.sunDirECEF); c.worldToECEFMatrix.copy(this.worldToECEF);
      const co = opts.clouds || {};
      c.coverage = co.coverage ?? 0.4;
      c.localWeatherVelocity.set(0.0008, 0.0002);
      if (co.layers) co.layers.forEach((l, i) => { const L = c.cloudLayers[i]; if (L) Object.assign(L, l); });
      const apply = () => { Object.assign(c, this.cloudTex); if (this.cloudTex.stbnTexture) ap.stbnTexture = this.cloudTex.stbnTexture; };
      apply(); this._cloudsRetry = setInterval(() => { apply(); if (Object.keys(this.cloudTex).length >= 5) clearInterval(this._cloudsRetry); }, 300);
      c.events.addEventListener('change', (e) => {
        if (e.property === 'atmosphereOverlay') ap.overlay = c.atmosphereOverlay;
        if (e.property === 'atmosphereShadow') ap.shadow = c.atmosphereShadow;
        if (e.property === 'atmosphereShadowLength') ap.shadowLength = c.atmosphereShadowLength;
      });
      this.atmo.clouds = c;
    }
  }

  setupNight(opts) {
    const scene = this.scene;
    this.E = 1;
    this.renderer.toneMappingExposure = opts.exposure ?? 1.2;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - (opts.elevation ?? 28)), THREE.MathUtils.degToRad(opts.azimuth ?? 200));
    this.sunDir.copy(sunDir);
    const g = new THREE.SphereGeometry(18000, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0x01020a) }, bottom: { value: new THREE.Color(0x14204a) }, moonDir: { value: sunDir } },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 moonDir; varying vec3 vP;
        void main(){ float h = clamp(vP.y*1.6+0.15,0.,1.); vec3 c = mix(bottom, top, pow(h,0.55));
        float md = max(dot(normalize(vP), normalize(moonDir)),0.); c += vec3(0.35,0.45,0.7)*pow(md,60.)*0.8 + vec3(0.2,0.25,0.45)*pow(md,8.)*0.22;
        gl_FragColor = vec4(c,1.); }`,
    });
    const skyMesh = new THREE.Mesh(g, m); skyMesh.renderOrder = -10; scene.add(skyMesh);
    this.skyMesh = skyMesh;
    const N = 5000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const v = new THREE.Vector3().randomDirection(); v.y = Math.abs(v.y) * 0.95 + 0.04; v.normalize().multiplyScalar(16000);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random(), b = 0.4 + Math.pow(Math.random(), 4) * 2.5; col.set([(0.8 + t * 0.2) * b, (0.85 + t * 0.1) * b, b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    skyMesh.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false })));
    const moon = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6d8).multiplyScalar(2.5), fog: false }));
    moon.position.copy(sunDir).multiplyScalar(15000); skyMesh.add(moon);
    const sun = new THREE.DirectionalLight(0x9db4ff, opts.sunIntensity ?? 1.1);
    sun.castShadow = this.q.shadows;
    const S = opts.shadowRange ?? 60, sc = sun.shadow.camera;
    sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; sc.near = 1; sc.far = 2000;
    sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
    scene.add(sun, sun.target); this.sun = sun;
    scene.add(new THREE.HemisphereLight(0x3a4a88, 0x0a0a14, 0.45));
    scene.fog = new THREE.FogExp2(new THREE.Color(opts.fogColor ?? 0x0d1630), opts.fog ?? 0.0011);
  }

  buildComposer(opts) {
    this.composer?.dispose();
    const r = this.renderer, cam = this.camera, scene = this.scene, q = this.q;
    const c = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    c.addPass(new RenderPass(scene, cam));
    const dbg = new URLSearchParams(location.search);
    if (q.ao && !dbg.has('noao')) {
      const ao = new N8AOPostPass(scene, cam, window.innerWidth, window.innerHeight);
      ao.configuration.aoRadius = opts.ao?.radius ?? 3;
      ao.configuration.distanceFalloff = opts.ao?.falloff ?? 1.2;
      ao.configuration.intensity = opts.ao?.intensity ?? 2.2;
      ao.configuration.halfRes = q.ao === 'half';
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode(q.ao === 'half' ? 'Low' : 'Medium');
      c.addPass(ao); this.aoPass = ao;
    }
    if (this.atmo) {
      const fx = this.atmo.clouds ? [this.atmo.clouds, this.atmo.ap] : [this.atmo.ap];
      c.addPass(new EffectPass(cam, ...fx));
    }
    const b = opts.bloom || {};
    const effects = [
      new BloomEffect({ intensity: b.strength ?? 0.8, luminanceThreshold: b.threshold ?? 0.9, luminanceSmoothing: 0.25, mipmapBlur: true, radius: b.radius ?? 0.7 }),
      new ToneMappingEffect({ mode: opts.toneMapping === 'agx' ? ToneMappingMode.AGX : ToneMappingMode.ACES_FILMIC }),
      new VignetteEffect({ darkness: 0.45, offset: 0.3 }),
    ];
    if (q.smaa) effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
    c.addPass(new EffectPass(cam, ...effects));
    this.composer = c;
    this.resize();
  }

  /** En modo atmósfera la escena está en radiancia física: escala emisivos y materiales "básicos". */
  calibrate(root = this.scene) {
    if (this.E === 1) return;
    const k = this.E * 3;
    root.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      ms.forEach((m) => {
        if (m.userData.cal || m.userData.raw || m.isShaderMaterial) return;
        m.userData.cal = true;
        if (m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) m.emissiveIntensity *= k;
        else if (m.isMeshBasicMaterial || m.isPointsMaterial || m.isSpriteMaterial) m.color.multiplyScalar(k);
      });
    });
  }

  followShadow(target) {
    if (!this.sun) return;
    if (this.sun.isSunDirectionalLight || this.sun.sunDirection) {
      this.sun.target.position.copy(target); this.sun.target.updateMatrixWorld(); this.sun.update();
      if (this.skyLight) { this.skyLight.position.copy(this.camera.position); this.skyLight.update(); }
    } else {
      this.sun.position.copy(target).addScaledVector(this.sunDir, 600);
      this.sun.target.position.copy(target);
    }
    if (this.skyMesh && !this.atmo) this.skyMesh.position.copy(this.camera.position);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}

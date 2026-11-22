# 🎢 Simulador Familiar

Simulador 3D en el navegador que usa el **celular como mando**: giroscopio como volante, vibración y sonidos propios en el teléfono. La imagen va en la TV / PC.

## Juegos
- 🌎 **Mundo real** — volá sobre ciudades reales en 3D (Google Photorealistic 3D Tiles): San Nicolás, Rosario, Obelisco, Iguazú, Bariloche, Río, Nueva York, París, Gran Cañón. Necesita una API key de Google con *Map Tiles API* habilitada (se pega en el juego o se define `VITE_GMAPS_KEY` en Vercel).
- ✈️ **Avión** — vuelo entre montañas, lagos y nubes; pasá por 25 aros dorados.
- 🦉 **Lechuza** — vuelo nocturno sobre el bosque con luna, estrellas y luciérnagas; atrapá 40 orbes mágicos.
- 🎢 **Montaña rusa** — viaje en primera persona al atardecer (subida con cadena, caída de 60 m, rizo, curvas peraltadas). Mové el celular para mirar alrededor.
- 🏎️ **Carrera** — 3 vueltas contra 5 autos de la computadora, nitro, derrape y minimapa.

## Cómo se juega
1. Abrí la página en la TV o PC (navegador de Smart TV, Chromecast/duplicar pantalla o una compu conectada a la tele).
2. Escaneá el QR con el celular → **Activar mando** → elegí el juego en el celu.
3. Sostené el celular horizontal como un volante. **Centrar** recalibra la posición neutra.

Sin TV: entrá a `/#solo` en el celular y jugás ahí mismo con el giroscopio.
Sin celular: teclado (flechas, W/S, Espacio, C, Esc).

## Calidad gráfica
Selector en la pantalla principal: **Ultra** (PC con placa de video), **Alta**, **Media**, **Baja** (Smart TV). Las nubes volumétricas, la oclusión ambiental y el pasto se activan desde Media.

## Técnica
- Three.js + [postprocessing](https://github.com/pmndrs/postprocessing): HDR, ACES, bloom, SMAA, viñeta.
- Atmósfera física y **nubes volumétricas** con [@takram/three-atmosphere / three-clouds](https://github.com/takram-design-engineering/three-geospatial): el sol está en la posición real según la hora y el lugar (San Nicolás por defecto).
- Oclusión ambiental con [N8AO](https://github.com/N8python/n8ao).
- Terreno con texturas PBR reales (pasto y roca de ambientCG, CC0) mezcladas por pendiente/altura con proyección triplanar; árboles instanciados con viento; pasto en GPU.
- Carrera con física real de vehículo ([Rapier](https://rapier.rs): suspensión, fricción por rueda, derrape, choques).
- Mundo real con [3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) (NASA JPL) + Google Photorealistic 3D Tiles.
- Conexión celular ↔ pantalla por WebRTC (PeerJS) con un canal no confiable de baja latencia para los sensores (60 Hz) y otro confiable para eventos.
- Audio 100% sintetizado con Web Audio (motores, viento, rieles, efectos).
- Vibración con `navigator.vibrate` (Android) y haptics del switch nativo en iOS 18+.

```bash
npm install
npm run dev     # http://localhost:5173 (para probar el giroscopio hace falta HTTPS)
npm run build
```

## Créditos de modelos y texturas
- Ferrari 458 Italia: modelo de los ejemplos de three.js (por vicent091036, CC-BY).
- Avión Cesium Air: modelo de muestra de CesiumJS (Apache 2.0).
- Texturas de pasto/roca y HDRIs: ambientCG / Poly Haven (CC0), vía pmndrs/market-assets y gkjohnson/3d-demo-data.
- Lechuza: procedural. Si querés una lechuza animada de verdad, poné un archivo `public/assets/models/owl.glb` (por ejemplo una descargada de Sketchfab) y se usa automáticamente.

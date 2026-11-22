// Interfaz del mando (celular). Sirve tanto como mando remoto como superpuesto en modo "solo celular".
import { MotionSensor, haptic } from './sensors.js';
import { Synth } from './engine/synth.js';
import { GAMES } from './games/catalog.js';
import { enterFullscreen, fullscreenButton, keepLandscape, iosHint, toast } from './screen.js';

// grados de giro del celu para llegar al tope (según sensibilidad)
const SENS = { baja: { steer: 45, tilt: 40 }, media: { steer: 32, tilt: 28 }, alta: { steer: 22, tilt: 18 } };

export function createPad(root, { send, sendFast, solo = false }) {
  const sensor = new MotionSensor();
  const synth = new Synth();
  const saved = JSON.parse(localStorage.getItem('simu-pad') || '{}');
  const st = { gas: 0, brake: 0, a: 0, b: 0, touch: false, tx: 0, ty: 0, rumble: 0, game: null, menu: true,
    sens: saved.sens || 'media', assist: saved.assist ?? true, fs: 0, ft: 0 };
  const save = () => localStorage.setItem('simu-pad', JSON.stringify({ sens: st.sens, assist: st.assist }));
  let started = false;

  root.classList.add('pad', 'in-menu'); if (solo) root.classList.add('solo');
  root.innerHTML = `
    <div class="pad-top">
      <span class="dot" id="pDot"></span><span id="pTitle">${solo ? '' : 'Conectando…'}</span>
      <span class="sp"></span>
      <button id="pCal" class="cal">🎯 Centrar</button>
      <span id="pFs"></span>
      <button id="pSnd">🔊</button>
      <button id="pCfg">⚙️</button>
      <button id="pMenu">☰ Juegos</button>
    </div>
    <div class="pad-cfg" id="pCfgBox">
      <div class="row3"><span>Sensibilidad</span>${Object.keys(SENS).map((k) => `<button data-s="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <div class="row3"><span>Ayudas de manejo</span><button id="pAssist"></button></div>
      <div class="row3"><span>Control táctil (sin giroscopio)</span><button id="pTouch"></button></div>
      <p class="hint">Con <b>ayudas</b>: el auto acelera solo y el avión copia la inclinación del celu (no se da vuelta).</p>
    </div>
    <div class="pad-menu" id="pMenuView">
      <h2>¿A qué jugamos?</h2>
      <div class="cards">${GAMES.map((g) => `<button class="card" data-g="${g.id}" style="--c:${g.color}"><span class="em">${g.emoji}</span><b>${g.name}</b><small>${g.short}</small></button>`).join('')}</div>
      <p class="hint">Sostené el celu horizontal como un volante. Para centrar, <b>tocá el volante</b> en cualquier momento.</p>
    </div>
    <div class="pad-play" id="pPlay">
      <button class="big brake" id="bBrake"><span id="lBrake">FRENO</span></button>
      <div class="mid">
        <div class="wheel" id="pWheel"><div class="spoke"></div><div class="tiltbar" id="pTiltBar"></div><span class="wtxt">TOCÁ PARA<br>CENTRAR</span></div>
        <div class="row"><button class="act b" id="bB"><span id="lB">CÁMARA</span></button><button class="act a" id="bA"><span id="lA">TURBO</span></button></div>
        <div class="phud" id="pHud"></div>
      </div>
      <button class="big gas" id="bGas"><span id="lGas">ACELERAR</span></button>
    </div>
    <div class="pad-count" id="pCount"></div>
    <div class="pad-start" id="pStart">
      <button id="pGo">${solo ? '▶ Empezar' : '🎮 Activar mando'}</button>
      <p>Se pone en pantalla completa y horizontal. Hace falta un toque para habilitar sensores, vibración y sonido.</p>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  $('pFs').appendChild(fullscreenButton('fsbtn'));
  const hold = (el, key) => {
    const on = (e) => { e.preventDefault(); st[key] = 1; el.classList.add('on'); haptic(12); if (key === 'a' || key === 'b') send({ t: 'btn', k: key }); };
    const off = (e) => { e.preventDefault(); st[key] = 0; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
  };
  hold($('bGas'), 'gas'); hold($('bBrake'), 'brake'); hold($('bA'), 'a'); hold($('bB'), 'b');

  const center = () => {
    sensor.calibrate(); st.tx = st.ty = 0; st.fs = st.ft = 0;
    haptic([20, 40, 20]); synth.play('select');
    const w = $('pWheel'); w.classList.remove('flash'); void w.offsetWidth; w.classList.add('flash');
    if (!st.menu) keepLandscape(true, sensor.angle);
    send({ t: 'cal' });
  };
  $('pCal').onclick = center;
  const cfgSync = () => {
    root.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === st.sens));
    $('pAssist').textContent = st.assist ? 'Sí' : 'No'; $('pAssist').classList.toggle('on', st.assist);
    $('pTouch').textContent = st.touch ? 'Sí' : 'No'; $('pTouch').classList.toggle('on', st.touch);
  };
  $('pCfg').onclick = () => { $('pCfgBox').classList.toggle('show'); cfgSync(); };
  root.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { st.sens = b.dataset.s; save(); cfgSync(); }));
  $('pAssist').onclick = () => { st.assist = !st.assist; save(); cfgSync(); send({ t: 'assist', on: st.assist }); };
  $('pTouch').onclick = () => { st.touch = !st.touch; cfgSync(); };
  $('pSnd').onclick = () => { synth.enabled = !synth.enabled; $('pSnd').textContent = synth.enabled ? '🔊' : '🔇'; send({ t: 'snd', on: synth.enabled }); };
  $('pMenu').onclick = () => send({ t: 'menu' });
  root.querySelectorAll('.card').forEach((c) => (c.onclick = () => { haptic(25); synth.play('select'); send({ t: 'pick', g: c.dataset.g }); }));

  // volante: un toque = centrar; arrastrar = modo táctil
  const wheel = $('pWheel');
  let drag = null;
  wheel.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; wheel.setPointerCapture(e.pointerId); });
  wheel.addEventListener('pointermove', (e) => {
    if (!drag) return;
    let dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (document.body.classList.contains('force-land')) { const r = document.body.classList.contains('rot-ccw') ? -1 : 1; [dx, dy] = [dy * r, -dx * r]; }
    if (Math.hypot(dx, dy) > 14) drag.moved = true;
    if (st.touch && drag.moved) { st.tx = Math.max(-1, Math.min(1, dx / 90)); st.ty = Math.max(-1, Math.min(1, dy / 90)); }
  });
  const endDrag = () => { if (drag && !drag.moved) center(); drag = null; st.tx = 0; st.ty = 0; };
  wheel.addEventListener('pointerup', endDrag); wheel.addEventListener('pointercancel', () => { drag = null; st.tx = st.ty = 0; });

  $('pGo').onclick = async () => {
    synth.ensure();
    const ok = await sensor.start();
    if (!ok) st.touch = true;
    try { await navigator.wakeLock?.request('screen'); } catch (e) {}
    await enterFullscreen();
    iosHint();
    haptic([30, 50, 30]);
    $('pStart').style.display = 'none';
    started = true;
    send({ t: 'assist', on: st.assist });
    setTimeout(() => { if (!sensor.has) { st.touch = true; toast('No se detectó el giroscopio: usá el volante táctil (arrastrá el círculo).', 4000); } }, 1500);
  };

  // cuenta regresiva al empezar un juego: se centra solo
  let countT = null;
  function startCountdown() {
    clearInterval(countT);
    let n = 3; const box = $('pCount');
    box.innerHTML = `<div>Sostené el celu como un <b>volante</b><br>en una posición cómoda…</div><b class="n">${n}</b>`; box.classList.add('show');
    countT = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(countT); box.classList.remove('show'); center(); toast(solo ? '🎯 Centrado. Tocá «Centrar» arriba para volver a centrar.' : '🎯 Centrado. Tocá el volante para volver a centrar.', 2200); return; }
      box.querySelector('.n').textContent = n; haptic(30);
    }, 800);
  }

  const shape = (x, dz = 0.05) => { const a = Math.abs(x); if (a < dz) return 0; const y = Math.min(1, (a - dz) / (1 - dz)); return Math.sign(x) * (y * 0.7 + y * y * y * 0.3); };
  const input = () => {
    const o = sensor.out, S = SENS[st.sens];
    let steer, tilt;
    if (st.touch) { steer = st.tx; tilt = st.ty; }
    else {
      steer = shape(clamp(o.steer / (S.steer * Math.PI / 180)));
      tilt = shape(clamp(o.tilt / (S.tilt * Math.PI / 180)), 0.08);
    }
    st.fs += (steer - st.fs) * 0.45; st.ft += (tilt - st.ft) * 0.4; // suavizado
    return { t: 'in', s: +st.fs.toFixed(3), f: +st.ft.toFixed(3), y: +clamp(o.yaw / 1.2).toFixed(3), l: +clamp(o.look / 0.9).toFixed(3), g: st.gas, b: st.brake, a: st.a, a2: st.b };
  };

  const loop = () => {
    const inp = input();
    if (started) sendFast(inp);
    wheel.style.transform = `rotate(${inp.s * 90}deg)`;
    $('pTiltBar').style.transform = `translateY(${inp.f * 30}px)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  setInterval(() => { if (started && st.rumble > 0.06) haptic(Math.round(12 + st.rumble * 80)); }, 110);

  function handle(m) {
    switch (m.t) {
      case 'cfg': {
        const wasMenu = st.menu, prevGame = st.game;
        st.menu = !!m.menu; st.game = m.game || null; root.classList.toggle('in-menu', st.menu);
        if (m.labels) { $('lA').textContent = m.labels.a; $('lB').textContent = m.labels.b; $('lGas').textContent = m.labels.gas; $('lBrake').textContent = m.labels.brake; }
        $('pTitle').textContent = m.title || 'Simulador';
        if (!st.menu) synth.ensure();
        st.rumble = 0; synth.loops.rumble?.set(0);
        keepLandscape(!st.menu, sensor.angle);
        if (!st.menu && started && (wasMenu || prevGame !== st.game)) startCountdown();
        break;
      }
      case 'vib': if (started) haptic(m.p); break;
      case 'snd': synth.play(m.n); break;
      case 'rmb':
        st.rumble = m.v;
        if (synth.ctx) synth.noiseLoop('rumble', { type: 'lowpass', freq: 200, q: 1, vol: 0.5 }).set(m.v, 120 + m.v * 500);
        break;
      case 'hud': $('pHud').innerHTML = m.h; break;
      case 'center': center(); break;
      case 'status': $('pDot').className = 'dot ' + m.s; if (m.s === 'connected' && !st.game) $('pTitle').textContent = 'Conectado ✔'; break;
    }
  }
  return { handle, input, st, synth, sensor, center };
}
const clamp = (x) => Math.max(-1, Math.min(1, x));

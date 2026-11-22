// Interfaz del mando (celular). Sirve tanto como mando remoto como superpuesto en modo "solo celular".
import { MotionSensor, haptic } from './sensors.js';
import { Synth } from './engine/synth.js';
import { GAMES } from './games/catalog.js';

export function createPad(root, { send, sendFast, solo = false }) {
  const sensor = new MotionSensor();
  const synth = new Synth();
  const st = { gas: 0, brake: 0, a: 0, b: 0, touch: false, tx: 0, ty: 0, rumble: 0, game: null, menu: true };
  let started = false;

  root.classList.add('pad', 'in-menu'); if (solo) root.classList.add('solo');
  root.innerHTML = `
    <div class="pad-top">
      <span class="dot" id="pDot"></span><span id="pTitle">${solo ? '' : 'Conectando…'}</span>
      <span class="sp"></span>
      <button id="pCal">⟳ Centrar</button>
      <button id="pTouch">✋ Táctil</button>
      <button id="pSnd">🔊</button>
      <button id="pMenu">☰ Juegos</button>
    </div>
    <div class="pad-menu" id="pMenuView">
      <h2>¿A qué jugamos?</h2>
      <div class="cards">${GAMES.map((g) => `<button class="card" data-g="${g.id}" style="--c:${g.color}"><span class="em">${g.emoji}</span><b>${g.name}</b><small>${g.short}</small></button>`).join('')}</div>
      <p class="hint">Sostené el celu horizontal como un volante. Tocá <b>Centrar</b> cuando estés cómodo.</p>
    </div>
    <div class="pad-play" id="pPlay">
      <button class="big brake" id="bBrake"><span id="lBrake">FRENO</span></button>
      <div class="mid">
        <div class="wheel" id="pWheel"><div class="spoke"></div><div class="tiltbar" id="pTiltBar"></div></div>
        <div class="row"><button class="act b" id="bB"><span id="lB">CÁMARA</span></button><button class="act a" id="bA"><span id="lA">TURBO</span></button></div>
        <div class="phud" id="pHud"></div>
      </div>
      <button class="big gas" id="bGas"><span id="lGas">ACELERAR</span></button>
    </div>
    <div class="pad-start" id="pStart"><button id="pGo">${solo ? '▶ Empezar' : '🎮 Activar mando'}</button><p>Hace falta un toque para habilitar sensores, vibración y sonido.</p></div>
    <div class="rotate-hint">↻ Girá el celular a horizontal</div>`;

  const $ = (id) => root.querySelector('#' + id);
  const hold = (el, key) => {
    const on = (e) => { e.preventDefault(); st[key] = 1; el.classList.add('on'); haptic(12); if (key === 'a' || key === 'b') send({ t: 'btn', k: key }); };
    const off = (e) => { e.preventDefault(); st[key] = 0; el.classList.remove('on'); };
    el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
  };
  hold($('bGas'), 'gas'); hold($('bBrake'), 'brake'); hold($('bA'), 'a'); hold($('bB'), 'b');

  $('pCal').onclick = () => { sensor.calibrate(); st.tx = st.ty = 0; haptic([20, 40, 20]); synth.play('select'); };
  $('pTouch').onclick = () => { st.touch = !st.touch; $('pTouch').classList.toggle('on', st.touch); };
  $('pSnd').onclick = () => { synth.enabled = !synth.enabled; $('pSnd').textContent = synth.enabled ? '🔊' : '🔇'; send({ t: 'snd', on: synth.enabled }); };
  $('pMenu').onclick = () => send({ t: 'menu' });
  root.querySelectorAll('.card').forEach((c) => (c.onclick = () => { haptic(25); synth.play('select'); send({ t: 'pick', g: c.dataset.g }); }));

  // volante táctil (si no hay giroscopio)
  const wheel = $('pWheel');
  let drag = null;
  wheel.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; st.touch = true; $('pTouch').classList.add('on'); wheel.setPointerCapture(e.pointerId); });
  wheel.addEventListener('pointermove', (e) => { if (!drag) return; st.tx = Math.max(-1, Math.min(1, (e.clientX - drag.x) / 90)); st.ty = Math.max(-1, Math.min(1, (e.clientY - drag.y) / 90)); });
  const endDrag = () => { drag = null; st.tx = 0; st.ty = 0; };
  wheel.addEventListener('pointerup', endDrag); wheel.addEventListener('pointercancel', endDrag);

  $('pGo').onclick = async () => {
    synth.ensure();
    const ok = await sensor.start();
    if (!ok) { st.touch = true; $('pTouch').classList.add('on'); }
    try { await navigator.wakeLock?.request('screen'); } catch (e) {}
    if (!solo) {
      try { await document.documentElement.requestFullscreen?.(); } catch (e) {}
      try { await screen.orientation?.lock?.('landscape'); } catch (e) {}
    }
    haptic([30, 50, 30]);
    $('pStart').style.display = 'none';
    started = true;
    setTimeout(() => { if (!sensor.has) { st.touch = true; $('pTouch').classList.add('on'); } }, 1500);
  };

  const input = () => {
    const o = sensor.out;
    const steer = st.touch ? st.tx : clamp(o.steer / 0.7);
    const tilt = st.touch ? st.ty : clamp(o.tilt / 0.6);
    return { t: 'in', s: +steer.toFixed(3), f: +tilt.toFixed(3), y: +clamp(o.yaw / 1.2).toFixed(3), l: +clamp(o.look / 0.9).toFixed(3), g: st.gas, b: st.brake, a: st.a, a2: st.b };
  };

  // envío a 60 Hz + indicador visual
  const loop = () => {
    const inp = input();
    if (started) sendFast(inp);
    wheel.style.transform = `rotate(${inp.s * 90}deg)`;
    $('pTiltBar').style.transform = `translateY(${inp.f * 30}px)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // vibración continua proporcional al "rumble"
  setInterval(() => { if (started && st.rumble > 0.06) haptic(Math.round(12 + st.rumble * 80)); }, 110);

  function handle(m) {
    switch (m.t) {
      case 'cfg':
        st.menu = !!m.menu; root.classList.toggle('in-menu', st.menu);
        if (m.labels) { $('lA').textContent = m.labels.a; $('lB').textContent = m.labels.b; $('lGas').textContent = m.labels.gas; $('lBrake').textContent = m.labels.brake; }
        $('pTitle').textContent = m.title || 'Simulador';
        if (!st.menu) synth.ensure();
        st.rumble = 0; synth.loops.rumble?.set(0);
        break;
      case 'vib': if (started) haptic(m.p); break;
      case 'snd': synth.play(m.n); break;
      case 'rmb':
        st.rumble = m.v;
        if (synth.ctx) synth.noiseLoop('rumble', { type: 'lowpass', freq: 200, q: 1, vol: 0.5 }).set(m.v, 120 + m.v * 500);
        break;
      case 'hud': $('pHud').innerHTML = m.h; break;
      case 'status': $('pDot').className = 'dot ' + m.s; if (m.s === 'connected' && !st.game) $('pTitle').textContent = 'Conectado ✔'; break;
    }
  }
  return { handle, input, st, synth, sensor };
}
const clamp = (x) => Math.max(-1, Math.min(1, x));

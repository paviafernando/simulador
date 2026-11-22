import QRCode from 'qrcode';
import { World } from './engine/world.js';
import { Synth } from './engine/synth.js';
import { HostLink } from './net.js';
import { GAMES } from './games/catalog.js';
import { createPad } from './pad.js';
import { haptic } from './sensors.js';
import { SHARED } from './engine/terrain.js';
import { fullscreenButton, enterFullscreen, fsEl, toast } from './screen.js';

const loaders = {
  plane: () => import('./games/plane.js'),
  world: () => import('./games/realworld.js'),
  owl: () => import('./games/owl.js'),
  coaster: () => import('./games/coaster.js'),
  race: () => import('./games/race.js'),
};

const HUB = new URLSearchParams(location.search).get('hub');
const HUB_URL = 'https://pf-juegos.vercel.app';

export async function startHost({ solo = false } = {}) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <canvas id="gl"></canvas>
    <div id="hud"><div id="hudL"></div><div id="hudC"></div><div id="hudR"></div><canvas id="minimap" width="200" height="200"></canvas></div>
    <div id="lobby">
      <div class="bg"></div>
      <div class="lob-in">
        <h1>Simulador <span>Familiar</span></h1>
        <p class="sub">Vuelos, carreras y montañas rusas con el celular como mando</p>
        <div class="lob-grid">
          <div class="join ${solo ? 'hide' : ''}">
            <div id="qr"></div>
            <div class="code">Código <b id="code">····</b></div>
            <div class="url" id="url"></div>
            <div class="pstatus" id="pstatus">Escaneá el QR con el celular</div>
          </div>
          <div class="games">${GAMES.map((g) => `<button class="gcard" data-g="${g.id}" style="--c:${g.color}"><span class="em">${g.emoji}</span><b>${g.name}</b><small>${g.short}</small></button>`).join('')}</div>
        </div>
        <div class="lob-foot">
          <label>Calidad <select id="quality"><option value="ultra">Ultra (PC potente)</option><option value="high">Alta</option><option value="medium">Media</option><option value="low">Baja (Smart TV)</option></select></label>
          ${solo ? '' : '<a class="solo-link" href="/#solo">📱 Jugar solo en este celular</a>'}
          ${HUB ? '<button class="hub-link" id="hubHome">🏠 Todos los juegos</button>' : ''}
          <span id="fsSlot" class="fs-slot"></span>
          <span class="keys">Teclado: flechas · W/S · Espacio · C · Esc</span>
        </div>
      </div>
    </div>
    <div id="loading" class="hide"><div class="spin"></div><span>Generando mundo…</span></div>
    <div id="tapsound" class="hide">🔇 Tocá la pantalla para activar el sonido</div>
    <div id="padRoot" class="${solo ? '' : 'hide'}"></div>
    <div id="gameFs"></div>`;
  document.getElementById('fsSlot').appendChild(fullscreenButton('fsbtn big-fs', { landscape: solo }, 'Pantalla completa'));
  if (!solo) document.getElementById('gameFs').appendChild(fullscreenButton('fsbtn game-fs'));
  let assist = true;

  const isMobile = matchMedia('(pointer:coarse)').matches;
  const qSel = document.getElementById('quality');
  const savedQ = localStorage.getItem('simu-q') || (isMobile ? 'low' : 'high');
  qSel.value = savedQ;
  const world = new World(document.getElementById('gl'), savedQ);
  qSel.onchange = () => { localStorage.setItem('simu-q', qSel.value); world.setQualityName(qSel.value); world.applyQuality(); };

  const synth = new Synth();
  let game = null, gameId = null, link = null, pad = null;
  const remote = { s: 0, f: 0, y: 0, l: 0, g: 0, b: 0, a: 0, a2: 0, last: 0 };
  const edges = { a: false, b: false };
  const keys = new Set();

  // ---- efectos hacia el celular ----
  let lastRumble = 0, rumbleVal = 0;
  const toPad = (m, fast) => { if (solo) pad?.handle(m); else if (link) fast ? link.sendFast(m) : link.send(m); };
  const fx = {
    vibrate: (p) => { toPad({ t: 'vib', p }); },
    rumble: (v) => { rumbleVal = v; },
    sound: (n, where = 'both') => { if (where !== 'pad') synth.play(n); if (where !== 'tv' && !solo) toPad({ t: 'snd', n }); },
    padSound: (n) => toPad({ t: 'snd', n }),
  };

  // ---- audio necesita gesto ----
  const unlock = () => { synth.ensure(); document.getElementById('tapsound').classList.add('hide'); };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);

  // ---- red ----
  if (!solo) {
    link = new HostLink({
      onInput: (d) => { Object.assign(remote, d); remote.last = performance.now(); },
      onMsg: (m) => padMsg(m),
      onStatus: async (s, code) => {
        const ps = document.getElementById('pstatus');
        if (s === 'ready') {
          document.getElementById('code').textContent = code;
          const url = `${location.origin}/?c=${code}`;
          document.getElementById('url').textContent = url.replace(/^https?:\/\//, '');
          document.getElementById('qr').innerHTML = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b1020', light: '#ffffff' } });
        } else if (s === 'connected') {
          ps.textContent = '✔ Mando conectado — elegí un juego en el celular'; ps.classList.add('ok');
          sendCfg(); synth.ensure(); synth.play('ding');
        } else if (s === 'lost') { ps.textContent = 'Mando desconectado. Volvé a escanear.'; ps.classList.remove('ok'); }
        else if (s === 'error') ps.textContent = 'Error de conexión (' + code + '). Recargá la página.';
      },
    });
  } else {
    pad = createPad(document.getElementById('padRoot'), {
      solo: true,
      send: (m) => padMsg(m),
      sendFast: (d) => { Object.assign(remote, d); remote.last = performance.now(); },
    });
    pad.handle({ t: 'status', s: 'connected' });
  }

  function padMsg(m) {
    if (m.t === 'pick') launch(m.g);
    else if (m.t === 'menu') backToMenu();
    else if (m.t === 'btn') edges[m.k] = true;
    else if (m.t === 'hello') sendCfg();
    else if (m.t === 'snd') synth.enabled = m.on;
    else if (m.t === 'assist') assist = !!m.on;
    else if (m.t === 'cal' && game && !solo) toast('🎯 Mando centrado', 1200);
  }
  function sendCfg() {
    const g = GAMES.find((x) => x.id === gameId);
    toPad({ t: 'cfg', menu: !game, game: game ? gameId : null, title: g ? `${g.emoji} ${g.name}` : 'Elegí un juego', labels: g?.labels });
  }

  document.querySelectorAll('.gcard').forEach((b) => (b.onclick = () => { unlock(); if (!fsEl()) enterFullscreen({ landscape: solo }); launch(b.dataset.g); }));

  // ---- índice PF Juegos ----
  const goHub = () => { toPad({ t: 'home' }); setTimeout(() => { location.href = `${HUB_URL}/?tv`; }, 250); };
  if (HUB) {
    document.getElementById('hubHome').onclick = goHub;
    window.addEventListener('keydown', (e) => { if (e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') { if (!game) { e.preventDefault(); goHub(); } } });
    const g0 = new URLSearchParams(location.search).get('g');
    if (g0 && loaders[g0]) setTimeout(() => launch(g0), 300);
  }

  // ---- teclado ----
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (e.code === 'Space') edges.a = true;
    if (e.code === 'KeyC') edges.b = true;
    if (e.code === 'Escape') backToMenu();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const kb = { s: 0, f: 0 };

  function readInput(dt) {
    const k = (c) => (keys.has(c) ? 1 : 0);
    const ts = k('ArrowRight') - k('ArrowLeft'), tf = k('ArrowDown') - k('ArrowUp');
    kb.s += (ts - kb.s) * Math.min(1, dt * 5); kb.f += (tf - kb.f) * Math.min(1, dt * 5);
    const useKb = keys.size > 0 || performance.now() - remote.last > 1500;
    const inp = {
      steer: useKb && Math.abs(kb.s) > 0.01 ? kb.s : remote.s,
      tilt: useKb && Math.abs(kb.f) > 0.01 ? kb.f : remote.f,
      yaw: remote.y, look: remote.l,
      gas: Math.max(remote.g, k('KeyW'), k('KeyZ')), brake: Math.max(remote.b, k('KeyS'), k('KeyX')),
      a: Math.max(remote.a, k('Space')), b: Math.max(remote.a2, k('KeyC')),
      aPressed: edges.a, bPressed: edges.b, assist,
    };
    edges.a = edges.b = false;
    return inp;
  }

  // ---- juegos ----
  async function launch(id) {
    if (!loaders[id]) return;
    disposeGame();
    gameId = id;
    document.getElementById('loading').classList.remove('hide');
    document.getElementById('lobby').classList.add('hide');
    await new Promise((r) => setTimeout(r, 50));
    const mod = await loaders[id]();
    world.clear();
    const hudEls = { L: document.getElementById('hudL'), C: document.getElementById('hudC'), R: document.getElementById('hudR'), map: document.getElementById('minimap') };
    hudEls.map.style.display = 'none';
    try {
      const g = new mod.default({ world, synth, fx, hud: hudEls, quality: world.q, solo });
      if (g.ready) await g.ready;
      game = g;
      world.calibrate();
    } catch (e) { console.error(e); document.getElementById('loading').querySelector('span').textContent = 'Error: ' + e.message; return; }
    document.getElementById('loading').classList.add('hide');
    document.getElementById('hud').classList.add('on');
    if (!synth.ctx || synth.ctx.state !== 'running') document.getElementById('tapsound').classList.remove('hide');
    sendCfg();
    fx.vibrate([40, 60, 40]);
  }
  function disposeGame() {
    if (game) { game.dispose?.(); game = null; }
    synth.stopAll();
    rumbleVal = 0; toPad({ t: 'rmb', v: 0 }, true);
    ['hudL', 'hudC', 'hudR'].forEach((i) => (document.getElementById(i).innerHTML = ''));
  }
  function backToMenu() {
    disposeGame(); gameId = null; world.clear();
    document.getElementById('hud').classList.remove('on');
    document.getElementById('lobby').classList.remove('hide');
    sendCfg();
  }

  // ---- loop ----
  let last = performance.now(), hudT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!game) return;
    SHARED.time.value += dt;
    const inp = readInput(dt);
    game.update(dt, inp);
    world.render();
    if (now - lastRumble > 100) {
      lastRumble = now; toPad({ t: 'rmb', v: +rumbleVal.toFixed(2) }, true);
      if (solo && rumbleVal > 0.06) { /* el pad local ya vibra */ }
    }
    hudT += dt;
    if (hudT > 0.5 && game.padHud) { hudT = 0; toPad({ t: 'hud', h: game.padHud() }, true); }
  }
  requestAnimationFrame(frame);
  window.__simu = { launch, world, get game() { return game; } };
  void haptic;
}

// Pantalla completa (como en el piano) + "horizontal forzado" mientras se juega.
export const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
export const fsSupported = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
export const isStandalone = () => matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function toast(msg, ms = 2500) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.getElementById('app').appendChild(t); }
  t.innerHTML = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
export function iosHint() {
  if (isIOS() && !isStandalone()) toast('En iPhone: tocá <b>Compartir → "Agregar a inicio"</b> y abrilo desde ahí para jugar en pantalla completa.', 6000);
}
export async function lockLandscape() { try { await screen.orientation?.lock?.('landscape'); return true; } catch (e) { return false; } }
export async function enterFullscreen({ landscape = true } = {}) {
  const de = document.documentElement;
  try {
    if (de.requestFullscreen) await de.requestFullscreen({ navigationUI: 'hide' });
    else if (de.webkitRequestFullscreen) de.webkitRequestFullscreen();
    else { iosHint(); return false; }
    if (landscape) await lockLandscape();
    return true;
  } catch (e) { iosHint(); return false; }
}
export async function exitFullscreen() {
  try { screen.orientation?.unlock?.(); } catch (e) {}
  if (document.exitFullscreen) await document.exitFullscreen().catch(() => {});
  else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
}
export const toggleFullscreen = (o) => (fsEl() ? exitFullscreen() : enterFullscreen(o));

/** Botón de pantalla completa que se mantiene sincronizado */
export function fullscreenButton(className = 'fsbtn', opts, label = '') {
  const b = document.createElement('button');
  b.className = className; b.title = 'Pantalla completa';
  const sync = () => { const on = !!fsEl(); b.innerHTML = (on ? '🗗' : '⛶') + (label ? ` <span>${on ? 'Salir de pantalla completa' : label}</span>` : ''); b.classList.toggle('on', on); };
  b.onclick = (e) => { e.stopPropagation(); toggleFullscreen(opts); };
  document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
  sync();
  if (isStandalone() || (!fsSupported() && !isIOS())) b.style.display = 'none';
  if (!fsSupported() && isIOS()) b.onclick = (e) => { e.stopPropagation(); iosHint(); };
  return b;
}

// ---- Horizontal forzado ----
// Si durante el juego el sistema pone la pantalla en vertical, giramos el contenido 90° para
// que se siga viendo horizontal (los controles usan la gravedad, así que no cambian).
const state = { want: false, rot: 90 };
export function viewSize() {
  const forced = document.body.classList.contains('force-land');
  return forced ? { w: innerHeight, h: innerWidth } : { w: innerWidth, h: innerHeight };
}
function applyForce() {
  const portrait = innerHeight > innerWidth;
  const on = state.want && portrait;
  const was = document.body.classList.contains('force-land');
  document.body.classList.toggle('force-land', on);
  document.body.classList.toggle('rot-cw', on && state.rot !== 270);
  document.body.classList.toggle('rot-ccw', on && state.rot === 270);
  if (was !== on) window.dispatchEvent(new Event('simu-resize'));
}
export function keepLandscape(want, holdAngle = 90) {
  state.want = want; state.rot = holdAngle;
  if (want) lockLandscape();
  applyForce();
}
window.addEventListener('resize', applyForce);
window.addEventListener('orientationchange', () => setTimeout(applyForce, 200));

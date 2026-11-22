import './style.css';
import { startHost } from './host.js';
import { createPad } from './pad.js';
import { PadLink } from './net.js';

const params = new URLSearchParams(location.search);
const code = params.get('c');

if (code) startController(code);
else if (location.hash === '#solo') startHost({ solo: true });
else if (location.hash === '#mando') askCode();
else startHost();

window.addEventListener('hashchange', () => location.reload());

function startController(code) {
  document.body.classList.add('controller');
  const app = document.getElementById('app');
  app.innerHTML = '<div id="padRoot"></div>';
  let link;
  const pad = createPad(document.getElementById('padRoot'), {
    send: (m) => link?.send(m),
    sendFast: (m) => link?.sendFast(m),
  });
  link = new PadLink(code, {
    onMsg: (m) => pad.handle(m),
    onStatus: (s) => pad.handle({ t: 'status', s }),
  });
}

function askCode() {
  document.getElementById('app').innerHTML = `<div class="ask"><h2>Código de la pantalla</h2>
    <input id="cin" maxlength="4" autocapitalize="characters" placeholder="ABCD"><button id="cgo">Conectar</button></div>`;
  document.getElementById('cgo').onclick = () => { const v = document.getElementById('cin').value.trim(); if (v.length === 4) location.href = '/?c=' + v.toUpperCase(); };
}

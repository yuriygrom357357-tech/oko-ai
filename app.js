/* ОКО-ШІ (EYE-AI) — аналіз відео з БпЛА у браузері. Працює офлайн після першого завантаження. */
'use strict';

// ------------------------------------------------------------ мови
const I18N = {
  uk: {
    subtitle: 'Аналіз відео з БпЛА', chooseSource: 'Оберіть джерело відео',
    chooseHint: 'ШІ підсвітить піхоту, техніку й дрони в небі',
    srcFile: 'Відеозапис', srcFileS: 'файл з дрона', srcScreen: 'Екран', srcScreenS: 'наживо, вікно пульта',
    srcCam: 'Камера', srcCamS: 'HDMI-грабер, вебкамера', demo: 'Демо:', demoDrone: 'дрон у небі', demoInf: 'піхота і техніка',
    loadingModel: 'Завантаження ШІ…', inf: 'ПІХОТА', veh: 'ТЕХНІКА', air: 'ДРОНИ', mov: 'РУХ',
    show: 'Показувати', smallInf: 'Дрібна піхота (з висоти)', sens: 'Чутливість', log: 'Журнал виявлень',
    csv: 'CSV', clear: 'Очистити', logEmpty: 'Поки що нічого не виявлено', foot: 'Прототип. Рішення приймає оператор.',
    stReady: 'ШІ готовий', stLoad: 'Завантаження ШІ…', stErr: 'Помилка ШІ', stRun: 'Аналіз',
    lInf: 'ПІХОТА', lVeh: 'ТЕХНІКА', lAir: 'ДРОН', lMov: 'РУХ', hidden: 'схований?',
    tRecOn: 'Запис увімкнено', tRecSaved: 'Запис збережено', tShot: 'Знімок збережено', tEnd: 'Кінець запису',
    tNoCam: 'Немає доступу до камери', tNoScreen: 'Захоплення екрана скасовано', tCleared: 'Журнал очищено',
    tCsv: 'Журнал збережено', tSmallOn: 'Режим дрібної піхоти: точніше, але повільніше', tNothing: 'Журнал порожній',
    fps: 'к/с', pause: 'Пауза', rec: 'Запис', shot: 'Знімок', stop: 'Стоп', confirmClear: 'Очистити журнал виявлень?',
  },
  en: {
    subtitle: 'UAV video analysis', chooseSource: 'Choose a video source',
    chooseHint: 'AI highlights infantry, vehicles and drones in the sky',
    srcFile: 'Video file', srcFileS: 'drone recording', srcScreen: 'Screen', srcScreenS: 'live, controller window',
    srcCam: 'Camera', srcCamS: 'HDMI grabber, webcam', demo: 'Demo:', demoDrone: 'drone in the sky', demoInf: 'infantry & vehicles',
    loadingModel: 'Loading AI…', inf: 'INFANTRY', veh: 'VEHICLES', air: 'DRONES', mov: 'MOTION',
    show: 'Show', smallInf: 'Small infantry (high altitude)', sens: 'Sensitivity', log: 'Detection log',
    csv: 'CSV', clear: 'Clear', logEmpty: 'Nothing detected yet', foot: 'Prototype. The operator makes the decision.',
    stReady: 'AI ready', stLoad: 'Loading AI…', stErr: 'AI error', stRun: 'Analysing',
    lInf: 'INFANTRY', lVeh: 'VEHICLE', lAir: 'DRONE', lMov: 'MOTION', hidden: 'hidden?',
    tRecOn: 'Recording', tRecSaved: 'Recording saved', tShot: 'Snapshot saved', tEnd: 'End of video',
    tNoCam: 'No camera access', tNoScreen: 'Screen capture cancelled', tCleared: 'Log cleared',
    tCsv: 'Log saved', tSmallOn: 'Small-infantry mode: more accurate, slower', tNothing: 'Log is empty',
    fps: 'fps', pause: 'Pause', rec: 'Record', shot: 'Snapshot', stop: 'Stop', confirmClear: 'Clear the detection log?',
  },
};
const CLS = ['INF', 'VEH', 'AIR', 'MOV'];
const COL = { INF: '#ff4b3e', VEH: '#ffcf33', AIR: '#45f07a', MOV: '#ff9a1f' };
const LBL = { INF: 'lInf', VEH: 'lVeh', AIR: 'lAir', MOV: 'lMov' };
// COCO → наші класи
const COCO = { 0: 'INF', 1: 'VEH', 2: 'VEH', 3: 'VEH', 5: 'VEH', 6: 'VEH', 7: 'VEH', 8: 'VEH', 4: 'AIR', 14: 'AIR', 33: 'AIR' };
const COCO_IDX = Object.keys(COCO).map(Number);

// ------------------------------------------------------------ налаштування
const S = { lang: 'uk', show: { INF: true, VEH: true, AIR: true, MOV: true }, small: false, sens: 25 };
try { Object.assign(S, JSON.parse(localStorage.getItem('oko.settings') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('oko.settings', JSON.stringify(S)); } catch (e) {} };
const t = k => (I18N[S.lang] && I18N[S.lang][k]) || I18N.uk[k] || k;

const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const video = $('video');

// ------------------------------------------------------------ ШІ-модель
let session = null, ep = 'CPU', modelPromise = null;
const IN = 640;
function setStatus(kind, text) { const c = $('status'); c.className = 'chip ' + kind; $('statusText').textContent = text; }
// ШІ працює у фоновому потоці (worker). Якщо GPU зависає — потік обриваємо і запускаємо CPU.
function makeWorker(epName) {
  return new Promise((resolve, reject) => {
    const w = new Worker('worker.js'); const pend = new Map(); let seq = 0;
    const api = {
      w, run(data) { return new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); w.postMessage({ type: 'run', id, data, size: IN }, [data.buffer]); }); },
      kill() { w.terminate(); pend.forEach(p => p.rej(new Error('stopped'))); pend.clear(); },
    };
    const to = setTimeout(() => { api.kill(); reject(new Error('init timeout')); }, 60000);
    w.onmessage = e => {
      const m = e.data;
      if (m.type === 'ready') { clearTimeout(to); resolve(api); }
      else if (m.type === 'out') { const p = pend.get(m.id); if (p) { pend.delete(m.id); p.res(m); } }
      else if (m.type === 'error') { if (m.id && pend.has(m.id)) { pend.get(m.id).rej(new Error(m.msg)); pend.delete(m.id); } else { clearTimeout(to); api.kill(); reject(new Error(m.msg)); } }
    };
    w.onerror = e => { clearTimeout(to); api.kill(); reject(new Error(e.message || 'worker error')); };
    const threads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    w.postMessage({ type: 'init', ep: epName, threads, base: new URL('./', location.href).href });
  });
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function loadModel() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    setStatus('busy', t('stLoad'));
    let gpuBad = false; try { gpuBad = localStorage.getItem('oko.gpuBad') === '1'; } catch (e) {}
    const forceCpu = /[?&]cpu\b/.test(location.search) || gpuBad;
    if (navigator.gpu && !forceCpu) {
      let w = null;
      try {
        w = await makeWorker('webgpu');
        await withTimeout(w.run(new Float32Array(3 * IN * IN)), 20000);      // компіляція
        const t0 = performance.now();
        await withTimeout(w.run(new Float32Array(3 * IN * IN)), 3000);       // швидкість
        if (performance.now() - t0 > 900) throw new Error('GPU slow');
        session = w; ep = 'GPU';
      } catch (e) { console.warn('WebGPU → CPU:', e.message); if (w) w.kill(); try { localStorage.setItem('oko.gpuBad', '1'); } catch (x) {} }
    }
    if (!session) { session = await makeWorker('wasm'); ep = 'CPU'; await session.run(new Float32Array(3 * IN * IN)); }
    setStatus('ok', `${t('stReady')} · ${ep}`);
    return session;
  })().catch(e => { console.error(e); setStatus('err', t('stErr')); modelPromise = null; throw e; });
  return modelPromise;
}

const pre = document.createElement('canvas'); pre.width = pre.height = IN;
const pctx = pre.getContext('2d', { willReadFrequently: true });
async function inferRegion(src, sx, sy, sw, sh, conf) {
  const r = Math.min(IN / sw, IN / sh), nw = Math.round(sw * r), nh = Math.round(sh * r);
  const px = (IN - nw) >> 1, py = (IN - nh) >> 1;
  pctx.fillStyle = '#727272'; pctx.fillRect(0, 0, IN, IN);
  pctx.drawImage(src, sx, sy, sw, sh, px, py, nw, nh);
  const d = pctx.getImageData(0, 0, IN, IN).data, N = IN * IN, f = new Float32Array(3 * N);
  for (let i = 0, j = 0; i < N; i++, j += 4) { f[i] = d[j] / 255; f[i + N] = d[j + 1] / 255; f[i + 2 * N] = d[j + 2] / 255; }
  const o = await session.run(f);
  const a = o.data, A = o.dims[2]; // [1, 84, 8400]
  const res = [];
  for (let i = 0; i < A; i++) {
    let best = 0, bc = -1;
    for (const c of COCO_IDX) { const v = a[(4 + c) * A + i]; if (v > best) { best = v; bc = c; } }
    if (best < conf) continue;
    const cx = a[i], cy = a[A + i], w = a[2 * A + i], h = a[3 * A + i];
    const x1 = (cx - w / 2 - px) / r + sx, y1 = (cy - h / 2 - py) / r + sy;
    res.push({ cls: COCO[bc], box: [x1, y1, x1 + w / r, y1 + h / r], conf: best });
  }
  return res;
}
async function detect(src, W, H, conf, tiles) {
  let dets = await inferRegion(src, 0, 0, W, H, conf);
  if (tiles) {
    const tw = Math.round(W * 0.6), th = Math.round(H * 0.6);
    for (const oy of [0, H - th]) for (const ox of [0, W - tw]) dets = dets.concat(await inferRegion(src, ox, oy, tw, th, conf));
  }
  dets.sort((p, q) => q.conf - p.conf);
  const keep = [];
  for (const d of dets) if (keep.every(k => k.cls !== d.cls || iou(k.box, d.box) < 0.45)) keep.push(d);
  return keep;
}

// ------------------------------------------------------------ рух + небо (з компенсацією руху камери)
const MW = 256;
const mcan = document.createElement('canvas'); const mctx = mcan.getContext('2d', { willReadFrequently: true });
let prevGray = null;
function grayOf(src, W, H) {
  const mh = Math.round(H * MW / W); mcan.width = MW; mcan.height = mh;
  mctx.drawImage(src, 0, 0, W, H, 0, 0, MW, mh);
  const d = mctx.getImageData(0, 0, MW, mh).data, g = new Uint8Array(MW * mh);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return { g, w: MW, h: mh };
}
function skyMask(G) {
  const { g, w, h } = G, m = new Uint8Array(w * h);
  const sorted = Array.from(g).sort((a, b) => a - b), thrV = Math.max(90, sorted[(sorted.length * 0.55) | 0]);
  const cand = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    const gr = Math.abs(g[i + 2] - g[i - 2]) + Math.abs(g[i + 2 * w] - g[i - 2 * w]);
    cand[i] = (gr < 14 && g[i] > thrV) ? 1 : 0;
  }
  // по стовпцях: небо тягнеться від верху, дрібні "дірки" (дрон) теж небо
  for (let x = 0; x < w; x++) {
    let last = -1, gap = 0;
    for (let y = 2; y < h; y++) {
      if (cand[y * w + x]) { last = y; gap = 0; } else if (++gap > 10) break;
    }
    if (last > h * 0.04) for (let y = 0; y <= last; y++) m[y * w + x] = 1;
  }
  return m;
}
function estimateShift(a, b, w, h, R = 12) {
  let best = 1e18, bx = 0, by = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    let s = 0;
    for (let y = R; y < h - R; y += 4) {
      const ry = y * w, py = (y - dy) * w;
      for (let x = R; x < w - R; x += 4) s += Math.abs(b[ry + x] - a[py + x - dx]);
    }
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  return [bx, by];
}
function motion(src, W, H) {
  const G = grayOf(src, W, H), out = [];
  const sky = skyMask(G);
  if (prevGray && prevGray.w === G.w && prevGray.h === G.h) {
    const { w, h } = G, a = prevGray.g, b = G.g;
    const [dx, dy] = estimateShift(a, b, w, h);
    const bin = new Uint8Array(w * h);
    const sens = S.sens / 25; // більша чутливість → нижчий поріг
    const tS = 14 / Math.sqrt(sens), tG = 28 / Math.sqrt(sens);
    for (let y = 1; y < h - 1; y++) {
      const sy = y - dy; if (sy < 1 || sy >= h - 1) continue;
      for (let x = 1; x < w - 1; x++) {
        const sx = x - dx; if (sx < 1 || sx >= w - 1) continue;
        const i = y * w + x, bi = b[i], q = sy * w + sx;
        let v = Math.abs(bi - a[q]);
        if (v > (sky[i] ? tS : tG)) { // стійкість до дрібного зсуву: беремо найменшу різницю серед сусідів
          for (let oy = -w; oy <= w && v > 0; oy += w) for (let ox = -1; ox <= 1; ox++) { const u = Math.abs(bi - a[q + oy + ox]); if (u < v) v = u; }
        }
        if (v > (sky[i] ? tS : tG)) bin[i] = 1;
      }
    }
    // злиття сусідніх пікселів + пошук плям
    const lab = new Int32Array(w * h), st = [];
    let id = 0;
    for (let i = 0; i < bin.length; i++) {
      if (!bin[i] || lab[i]) continue;
      id++; let x1 = 1e9, y1 = 1e9, x2 = -1, y2 = -1, n = 0, s = 0; st.push(i); lab[i] = id;
      while (st.length) {
        const k = st.pop(), x = k % w, y = (k / w) | 0; n++; s += sky[k];
        if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
        for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
          const X = x + xx, Y = y + yy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const q = Y * w + X; if (bin[q] && !lab[q]) { lab[q] = id; st.push(q); }
        }
      }
      if (n < 3 || n > 0.04 * w * h) continue;
      const nearSky = s / n <= 0.5 && y1 > 0 && sky[Math.max(0, y1 - 3) * w + ((x1 + x2) >> 1)];
      if (nearSky) continue;
      const sc = W / w;
      out.push({ box: [x1 * sc, y1 * sc, (x2 + 1) * sc, (y2 + 1) * sc], sky: s / n > 0.5, n });
    }
  }
  prevGray = G;
  return out;
}

// ------------------------------------------------------------ трекер
function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1), u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
  return u > 0 ? i / u : 0;
}
const cdist = (a, b) => Math.hypot((a[0] + a[2] - b[0] - b[2]) / 2, (a[1] + a[3] - b[1] - b[3]) / 2);
let nextId = 1, tracks = [];
function trackStep(dets, maxMiss) {
  for (const k of tracks) { k.box = k.box.map((v, i) => v + k.vel[i % 2]); }
  const pairs = [];
  tracks.forEach((k, ti) => dets.forEach((d, di) => {
    if (d.cls !== k.cls) return;
    const size = Math.max(d.cls === 'AIR' || d.cls === 'MOV' ? 40 : 20, (d.box[2] - d.box[0] + d.box[3] - d.box[1]) / 2), s = iou(k.box, d.box), dd = cdist(k.box, d.box);
    if (s > 0.1 || dd < 1.5 * size) pairs.push([s - dd / (10 * size), ti, di]);
  }));
  pairs.sort((p, q) => q[0] - p[0]);
  const tu = new Set(), du = new Set();
  for (const [, ti, di] of pairs) {
    if (tu.has(ti) || du.has(di)) continue;
    const k = tracks[ti], d = dets[di];
    const c0 = [(k.box[0] + k.box[2]) / 2, (k.box[1] + k.box[3]) / 2], c1 = [(d.box[0] + d.box[2]) / 2, (d.box[1] + d.box[3]) / 2];
    k.vel = [0.6 * k.vel[0] + 0.4 * (c1[0] - c0[0]), 0.6 * k.vel[1] + 0.4 * (c1[1] - c0[1])];
    k.box = k.box.map((v, i) => 0.4 * v + 0.6 * d.box[i]);
    k.conf = k.hits > 1 ? 0.7 * k.conf + 0.3 * d.conf : d.conf;
    k.hits++; k.miss = 0; k.trail.push(c1); if (k.trail.length > 30) k.trail.shift();
    tu.add(ti); du.add(di);
  }
  tracks.forEach((k, ti) => { if (!tu.has(ti)) { k.miss++; k.vel = k.vel.map(v => v * 0.9); } });
  dets.forEach((d, di) => { if (!du.has(di)) tracks.push({ id: nextId++, cls: d.cls, box: d.box.slice(), conf: d.conf, vel: [0, 0], hits: 1, miss: 0, trail: [], logged: false }); });
  tracks = tracks.filter(k => k.miss <= maxMiss);
}
const shownConf = k => Math.max(0, Math.min(0.99, (k.conf + Math.min(0.15, 0.02 * (k.hits - 1))) * Math.pow(0.85, k.miss)));
const confirmed = k => k.hits >= (k.cls === 'MOV' ? 4 : k.cls === 'AIR' ? 3 : 2) && (k.miss === 0 || (k.cls !== 'MOV' && k.hits >= 5));

// ------------------------------------------------------------ журнал
let logRows = [];
function addLog(k) {
  const now = new Date(), ts = now.toTimeString().slice(0, 8), p = Math.round(shownConf(k) * 100);
  logRows.push({ ts, date: now.toISOString(), cls: k.cls, id: k.id, p, box: k.box.map(Math.round) });
  if (logRows.length > 5000) logRows.shift();
  const ul = $('log'); const empty = ul.querySelector('.empty'); if (empty) empty.remove();
  const li = document.createElement('li'); li.className = k.cls + ' fresh';
  li.innerHTML = `<span class="t">${ts}</span><span class="k">${t(LBL[k.cls])} #${k.id}</span><span class="p">${p}%</span>`;
  ul.prepend(li); while (ul.children.length > 200) ul.lastChild.remove();
  if (window.OKO_STATS) OKO_STATS.record(k, grab, srcLabel);
}
function renderLogEmpty() { $('log').innerHTML = `<li class="empty">${t('logEmpty')}</li>`; }

// ------------------------------------------------------------ малювання
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawOverlay() {
  const W = canvas.width, k2 = W / Math.max(1, canvas.clientWidth || W); // пікселів кадру на 1 CSS-піксель
  const fs = Math.round(Math.max(W / 75, 12 * k2)), lw = Math.max(2, Math.round(Math.max(W / 450, 2 * k2)));
  ctx.font = `700 ${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif`;
  ctx.textBaseline = 'middle';
  const vis = tracks.filter(k => confirmed(k) && S.show[k.cls]);
  const live = vis.filter(k => k.miss === 0);
  const list = vis.filter(k => k.miss === 0 || !live.some(v => v.cls === k.cls && (iou(v.box, k.box) > 0.05 || cdist(v.box, k.box) < 60)));
  list.sort((a, b) => (a.cls === 'INF' ? 1 : 0) - (b.cls === 'INF' ? 1 : 0)); // піхота малюється поверх
  const placed = [];
  for (const k of list) {
    const col = COL[k.cls], pad = (k.cls === 'AIR' || k.cls === 'MOV') ? 5 : 0;
    let [x1, y1, x2, y2] = k.box; x1 -= pad; y1 -= pad; x2 += pad; y2 += pad;
    const hid = k.miss > 0;
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = k.cls === 'MOV' ? 1.5 : lw; ctx.globalAlpha = hid ? 0.55 : 1;
    if (hid) ctx.setLineDash([8, 6]);
    if (!hid && k.cls !== 'MOV') { ctx.shadowColor = col; ctx.shadowBlur = 8; }
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    // кутові мітки
    if (!hid && k.cls !== 'MOV') {
      ctx.setLineDash([]); ctx.lineWidth = lw + 1.5; const c = Math.min(14, (x2 - x1) / 3, (y2 - y1) / 3);
      ctx.beginPath();
      [[x1, y1, 1, 1], [x2, y1, -1, 1], [x1, y2, 1, -1], [x2, y2, -1, -1]].forEach(([x, y, sx, sy]) => { ctx.moveTo(x + sx * c, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * c); });
      ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.setLineDash([]);
    if (k.trail.length > 2 && k.cls !== 'MOV') {
      ctx.globalAlpha = 0.45; ctx.lineWidth = 1.5; ctx.beginPath();
      k.trail.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    }
    if (k.cls !== 'MOV') {
      const main = `${t(LBL[k.cls])} ${Math.round(shownConf(k) * 100)}%`, sub = `  #${k.id}${hid ? ' · ' + t('hidden') : ''}`;
      const mw = ctx.measureText(main).width, sw = ctx.measureText(sub).width, tw = mw + sw + 16, th = fs + 8;
      let lx = Math.min(Math.max(2, x1), canvas.width - tw - 2), ly = y1 - th - 4; if (ly < 2) ly = y2 + 4;
      for (let n = 0; n < 6; n++) { // розсуваємо підписи, щоб не накладались
        const hit = placed.find(r => lx < r[0] + r[2] && lx + tw > r[0] && ly < r[1] + r[3] && ly + th > r[1]);
        if (!hit) break; ly = hit[1] + hit[3] + 2;
      }
      placed.push([lx, ly, tw, th]);
      ctx.globalAlpha = hid ? 0.7 : 0.92; ctx.fillStyle = 'rgba(8,12,9,.84)';
      roundRect(ctx, lx, ly, tw, th, th / 2); ctx.fill();
      ctx.globalAlpha = hid ? 0.75 : 1; ctx.fillStyle = col; ctx.fillText(main, lx + 8, ly + th / 2 + 1);
      ctx.fillStyle = 'rgba(220,228,215,.75)'; ctx.fillText(sub, lx + 8 + mw, ly + th / 2 + 1);
    }
    ctx.restore();
  }
}

// ------------------------------------------------------------ керування джерелом
let srcLabel = '';
let running = false, paused = false, srcKind = null, stream = null, aFps = 0, aBusy = false, lastA = 0;
const SRC_W_MAX = 1920;
function frameSize() { return [video.videoWidth, video.videoHeight]; }
function show(el, on) { $(el).hidden = !on; }
function toast(msg) { const el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => el.hidden = true, 2200); }

async function startSource(kind, payload, label) {
  try {
    show('loading', true);
    const modelP = loadModel();
    stopSource(true);
    srcKind = kind;
    srcLabel = label || ({ screen: S.lang === 'en' ? 'screen' : 'екран', cam: S.lang === 'en' ? 'camera' : 'камера' }[kind]) || '';
    if (kind === 'file' || kind === 'demo') {
      video.srcObject = null; video.src = payload; video.loop = false;
    } else if (kind === 'screen') {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      stream.getVideoTracks()[0].addEventListener('ended', () => stopSource());
      video.removeAttribute('src'); video.srcObject = stream;
    } else if (kind === 'cam') {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.removeAttribute('src'); video.srcObject = stream;
    }
    await new Promise((res, rej) => { if (video.readyState >= 1) res(); else { video.onloadedmetadata = res; video.onerror = rej; } });
    await modelP;
    let [W, H] = frameSize(); const sc = Math.min(1, SRC_W_MAX / W);
    canvas.width = Math.round(W * sc); canvas.height = Math.round(H * sc);
    await video.play();
    show('start', false); show('loading', false); show('controls', true);
    running = true; paused = false; tracks = []; prevGray = null; nextId = 1; aFps = 0;
    updPause(); setStatus('ok', `${t('stRun')} · ${ep}`);
    requestAnimationFrame(render); analyse();
  } catch (e) {
    console.warn(e); show('loading', false);
    if (kind === 'screen') toast(t('tNoScreen')); else if (kind === 'cam') toast(t('tNoCam')); else toast(String(e.message || e));
    stopSource();
  }
}
function stopSource(silent) {
  running = false; paused = false;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (stream) { stream.getTracks().forEach(x => x.stop()); stream = null; }
  try { video.pause(); } catch (e) {}
  if (video.src && video.src.startsWith('blob:')) URL.revokeObjectURL(video.src);
  video.removeAttribute('src'); video.srcObject = null;
  tracks = []; updCounts();
  if (!silent) {
    show('controls', false); show('start', true);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (session) setStatus('ok', `${t('stReady')} · ${ep}`);
  }
}
video.addEventListener('ended', () => { if (running) { paused = true; updPause(); toast(t('tEnd')); } });

function render() {
  if (!running) return;
  if (!paused || srcKind === 'file' || srcKind === 'demo') {
    if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  drawOverlay();
  requestAnimationFrame(render);
}
const grab = document.createElement('canvas'); const gctx = grab.getContext('2d', { willReadFrequently: true });
async function analyse() {
  while (running) {
    if (paused || video.readyState < 2) { await new Promise(r => setTimeout(r, 100)); continue; }
    const t0 = performance.now();
    const W = canvas.width, H = canvas.height;
    grab.width = W; grab.height = H; gctx.drawImage(video, 0, 0, W, H);
    const thr = Math.max(0.08, (60 - S.sens) / 100);           // чутливість 25% → поріг 0.35; 60% → 0.08; 10% → 0.5
    let dets;
    try { dets = await detect(grab, W, H, thr, S.small); } catch (e) { console.error(e); setStatus('err', t('stErr')); await new Promise(r => setTimeout(r, 500)); continue; }
    if (!running) break;
    const mots = motion(grab, W, H);
    for (const m of mots) {
      if (dets.some(d => iou(d.box, m.box) > 0.05 || cdist(d.box, m.box) < W / 40)) continue;
      const area = (m.box[2] - m.box[0]) * (m.box[3] - m.box[1]);
      if (m.sky) dets.push({ cls: 'AIR', box: m.box, conf: Math.min(0.75, 0.35 + m.n / 60) });
      else if (area < 0.003 * W * H) dets.push({ cls: 'MOV', box: m.box, conf: Math.min(0.6, 0.2 + m.n / 80) });
    }
    const dt = (performance.now() - t0) / 1000;
    aFps = aFps ? 0.8 * aFps + 0.2 / Math.max(dt, 0.001) : 1 / Math.max(dt, 0.001);
    trackStep(dets, Math.max(4, Math.round(aFps * 1.5)));
    for (const k of tracks) if (confirmed(k) && !k.logged && k.miss === 0) { k.logged = true; if (S.show[k.cls] && k.cls !== 'MOV') addLog(k); }
    updCounts();
    $('ctlInfo').textContent = `${aFps.toFixed(1)} ${t('fps')}${recorder && recorder.state === 'recording' ? ' · ● REC' : ''}`;
    await new Promise(r => setTimeout(r, 0));
  }
}
function updCounts() {
  const n = { INF: 0, VEH: 0, AIR: 0, MOV: 0 };
  for (const k of tracks) if (confirmed(k) && k.miss === 0 && S.show[k.cls]) n[k.cls]++;
  $('cInf').textContent = n.INF; $('cVeh').textContent = n.VEH; $('cAir').textContent = n.AIR; $('cMov').textContent = n.MOV;
  $('stage').classList.toggle('alert', running && (n.INF > 0 || n.AIR > 0));
  $('tInf').classList.toggle('alert', n.INF > 0); $('tAir').classList.toggle('alert', n.AIR > 0); $('tVeh').classList.toggle('alert', n.VEH > 0);
}

// ------------------------------------------------------------ запис / знімок / CSV
let recorder = null, chunks = [];
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function toggleRec() {
  if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const type = types.find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || '';
  recorder = new MediaRecorder(canvas.captureStream(25), type ? { mimeType: type, videoBitsPerSecond: 6e6 } : {});
  chunks = [];
  recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    $('btnRec').classList.remove('on');
    if (chunks.length) { download(new Blob(chunks, { type: recorder.mimeType }), `oko_${stamp()}.${recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'}`); toast(t('tRecSaved')); }
  };
  recorder.start(1000); $('btnRec').classList.add('on'); toast(t('tRecOn'));
}
function snapshot() { canvas.toBlob(b => { download(b, `oko_${stamp()}.png`); toast(t('tShot')); }, 'image/png'); }
function exportCsv() {
  if (!logRows.length) { toast(t('tNothing')); return; }
  const head = ['time', 'datetime', 'type', 'track', 'confidence_%', 'x1', 'y1', 'x2', 'y2'];
  const name = { INF: t('lInf'), VEH: t('lVeh'), AIR: t('lAir'), MOV: t('lMov') };
  const rows = logRows.map(r => [r.ts, r.date, name[r.cls], r.id, r.p, ...r.box].join(';'));
  download(new Blob(['﻿' + [head.join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }), `oko_log_${stamp()}.csv`);
  toast(t('tCsv'));
}
function updPause() {
  $('icoPause').setAttribute('d', paused ? 'M8 5l11 7-11 7z' : 'M8 5v14M16 5v14');
  $('btnPause').classList.toggle('on', paused);
  $('btnPause').title = t('pause');
}

// ------------------------------------------------------------ мова й налаштування в UI
function applyLang() {
  document.documentElement.lang = S.lang;
  document.querySelectorAll('[data-i18n]').forEach(el => el.textContent = t(el.dataset.i18n));
  $('langUk').classList.toggle('on', S.lang === 'uk'); $('langEn').classList.toggle('on', S.lang === 'en');
  $('btnRec').title = t('rec'); $('btnShot').title = t('shot'); $('btnStop').title = t('stop'); $('btnPause').title = t('pause');
  if (session) setStatus('ok', `${running ? t('stRun') : t('stReady')} · ${ep}`);
  if (!logRows.length) renderLogEmpty();
  if (window.OKO_STATS) OKO_STATS.applyLang();
}
function applyToggles() {
  document.querySelectorAll('.tg').forEach(b => b.classList.toggle('on', !!S.show[b.dataset.cls]));
  $('swSmall').checked = !!S.small; $('sens').value = S.sens; $('sensVal').textContent = S.sens + '%';
}

// ------------------------------------------------------------ події
$('btnFile').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { const f = e.target.files[0]; if (f) startSource('file', URL.createObjectURL(f), f.name); e.target.value = ''; };
$('btnScreen').onclick = () => startSource('screen');
$('btnCam').onclick = () => startSource('cam');
$('btnDemoDrone').onclick = () => startSource('demo', 'demo/drone.mp4', 'demo: drone.mp4');
$('btnDemoInf').onclick = () => startSource('demo', 'demo/infantry.mp4', 'demo: infantry.mp4');
$('btnPause').onclick = () => {
  paused = !paused;
  if (srcKind === 'file' || srcKind === 'demo') { if (paused) video.pause(); else { if (video.ended) { video.currentTime = 0; tracks = []; prevGray = null; } video.play(); } }
  updPause();
};
$('btnRec').onclick = toggleRec;
$('btnShot').onclick = snapshot;
$('btnStop').onclick = () => stopSource();
$('btnCsv').onclick = exportCsv;
$('btnClear').onclick = () => { if (!logRows.length) { toast(t('tNothing')); return; } if (!confirmClear()) return; logRows = []; renderLogEmpty(); toast(t('tCleared')); };
function confirmClear() { try { return window.confirm(t('confirmClear')); } catch (e) { return true; } }
document.querySelectorAll('.tg').forEach(b => b.onclick = () => { S.show[b.dataset.cls] = !S.show[b.dataset.cls]; save(); applyToggles(); updCounts(); });
$('swSmall').onchange = e => { S.small = e.target.checked; save(); if (S.small) toast(t('tSmallOn')); };
$('sens').oninput = e => { S.sens = +e.target.value; $('sensVal').textContent = S.sens + '%'; save(); };
$('langUk').onclick = () => { S.lang = 'uk'; save(); applyLang(); };
$('langEn').onclick = () => { S.lang = 'en'; save(); applyLang(); };
document.addEventListener('keydown', e => {
  if (!running || e.target.tagName === 'INPUT' || !$('stats').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); $('btnPause').click(); }
  else if (e.key === 'r' || e.key === 'к') $('btnRec').click();
  else if (e.key === 's' || e.key === 'і') $('btnShot').click();
  else if (e.key === 'Escape') $('btnStop').click();
});

// пристрої без захоплення екрана (iPhone, Android) — кнопку не показуємо
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { $('btnScreen').remove(); document.querySelector('.src-grid').style.gridTemplateColumns = 'repeat(2,minmax(140px,200px))'; }
if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) $('btnCam').setAttribute('disabled', '');

applyLang(); applyToggles();
loadModel().catch(() => {});
// Service worker: офлайн-режим + заголовки ізоляції (вмикають багатопотоковий CPU-режим ШІ)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').then(() => {
    if (!self.crossOriginIsolated) {
      let tried = false; try { tried = sessionStorage.getItem('oko.coi') === '1'; } catch (e) {}
      if (!tried) navigator.serviceWorker.ready.then(() => { try { sessionStorage.setItem('oko.coi', '1'); } catch (e) {} if (!running) location.reload(); });
    }
  }).catch(() => {});
}

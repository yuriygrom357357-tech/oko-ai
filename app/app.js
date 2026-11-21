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
    show: 'Показувати', smallInf: 'Дрібна піхота (з висоти)', sens: 'Піхота, техніка', sensAir: 'Дрони', sensH: 'Чутливість', log: 'Журнал виявлень',
    csv: 'CSV', clear: 'Очистити', logEmpty: 'Поки що нічого не виявлено', foot: 'Для внутрішнього користування. Рішення приймає оператор.', credit: 'Розробник: Юрій Мельничук, 158 навчальний центр, позивний «Композитор»',
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
    show: 'Show', smallInf: 'Small infantry (high altitude)', sens: 'Infantry, vehicles', sensAir: 'Drones', sensH: 'Sensitivity', log: 'Detection log',
    csv: 'CSV', clear: 'Clear', logEmpty: 'Nothing detected yet', foot: 'For internal use. The operator makes the decision.', credit: 'Developer: Yuriy Melnychuk, 158th Training Centre, callsign “Kompozytor”',
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
const S = { lang: 'uk', show: { INF: true, VEH: true, AIR: true, MOV: true }, small: false, sens: 25, sensAir: 15 };
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
let lastSky = null;
const mcan = document.createElement('canvas'); const mctx = mcan.getContext('2d', { willReadFrequently: true });
let prevGray = null;
function grayOf(src, W, H) {
  const mh = Math.round(H * MW / W); mcan.width = MW; mcan.height = mh;
  mctx.drawImage(src, 0, 0, W, H, 0, 0, MW, mh);
  const d = mctx.getImageData(0, 0, MW, mh).data, g = new Uint8Array(MW * mh), c = new Int16Array(MW * mh);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; c[i] = d[j + 2] - d[j]; }
  return { g, c, w: MW, h: mh };
}
function skyMask(G) {
  const { g, w, h } = G, m = new Uint8Array(w * h);
  const sorted = Array.from(g).sort((a, b) => a - b), thrV = Math.max(90, sorted[(sorted.length * 0.55) | 0]);
  const cand = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    const gr = Math.abs(g[i + 2] - g[i - 2]) + Math.abs(g[i + 2 * w] - g[i - 2 * w]);
    cand[i] = (gr < 14 && g[i] > thrV && G.c[i] >= -6) ? 1 : 0; // світле, однорідне, холодного/нейтрального відтінку (не тепла стіна)
  }
  // по стовпцях: небо тягнеться від верху, дрібні "дірки" (дрон) теж небо
  for (let x = 0; x < w; x++) {
    let last = -1, gap = 0;
    for (let y = 2; y < h; y++) {
      if (cand[y * w + x]) { last = y; gap = 0; } else if (++gap > 10) break;
    }
    if (last > h * 0.04 && cand[3 * w + x]) for (let y = 0; y <= Math.min(last, h * 0.75); y++) m[y * w + x] = 1; // небо починається від верхнього краю
  }
  // небо — лише велика суцільна ділянка зверху (≥25% ширини, ≥6% кадру); інакше вважаємо, що неба в кадрі немає
  let cols = 0, tot = 0; for (let x = 0; x < w; x++) if (m[2 * w + x]) cols++; for (let i = 0; i < m.length; i++) tot += m[i];
  if (cols < w * 0.25 || tot < w * h * 0.06) m.fill(0);
  lastSky = { m, w, h };
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
    const tS = 18 / Math.sqrt(Math.max(5, S.sensAir) / 15), tG = 28 / Math.sqrt(sens);
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


// ------------------------------------------------------------ злиття детектора й руху; суворі правила для дронів
function inSky(box, W, H) {
  if (!lastSky) return false;
  const { m, w, h } = lastSky, cx = Math.round((box[0] + box[2]) / 2 / W * w), cy = Math.round((box[1] + box[3]) / 2 / H * h);
  let n = 0, k = 0; for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { if (x < 0 || y < 0 || x >= w || y >= h) continue; k++; n += m[y * w + x]; }
  return k > 0 && n / k > 0.7;
}
function fuse(dets, mots, W, H) {
  const airK = Math.max(5, S.sensAir) / 15;                       // 15% — стандарт; менше → суворіше
  // ПТАХ/ЛІТАК/ЗМІЙ від моделі — тільки на небі й з високою впевненістю
  dets = dets.filter(d => d.cls !== 'AIR' || (inSky(d.box, W, H) && d.conf >= Math.min(0.8, 0.55 / Math.sqrt(airK))));
  const people = dets.filter(d => d.cls === 'INF' || d.cls === 'VEH');
  for (const m of mots) {
    if (dets.some(d => iou(d.box, m.box) > 0.05 || cdist(d.box, m.box) < W / 40)) continue;
    const bw = m.box[2] - m.box[0], bh = m.box[3] - m.box[1], area = bw * bh;
    if (m.sky) {
      // рух на небі: маленька компактна точка, не поруч із людиною/технікою
      if (area > 0.012 * W * H || bw / bh > 4 || bh / bw > 1.6) continue; // дрон компактний і не «високий» (людина — висока й вузька)
      if (!inSky(m.box, W, H)) continue;                                 // довкола точки — справжнє небо
      if (people.some(p => cdist(p.box, m.box) < 3 * Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]))) continue;
      if (m.n < 4 / airK) continue;
      dets.push({ cls: 'AIR', box: m.box, conf: Math.min(0.7, 0.3 + m.n / 80), mot: true });
    } else if (area < 0.003 * W * H) dets.push({ cls: 'MOV', box: m.box, conf: Math.min(0.6, 0.2 + m.n / 80) });
  }
  return dets;
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
    k.hits++; k.miss = 0; k.trail.push(c1); if (k.trail.length > 30) k.trail.shift(); if (!d.mot) k.mot = false;
    tu.add(ti); du.add(di);
  }
  tracks.forEach((k, ti) => { if (!tu.has(ti)) { k.miss++; k.vel = k.vel.map(v => v * 0.9); } });
  dets.forEach((d, di) => { if (!du.has(di)) tracks.push({ id: nextId++, cls: d.cls, box: d.box.slice(), conf: d.conf, vel: [0, 0], hits: 1, miss: 0, trail: [], logged: false, mot: !!d.mot }); });
  tracks = tracks.filter(k => k.miss <= maxMiss);
}
const shownConf = k => Math.max(0, Math.min(0.99, (k.conf + Math.min(0.15, 0.02 * (k.hits - 1))) * Math.pow(0.85, k.miss)));
const flies = k => { if (k.trail.length < 5) return false; const a = k.trail[0], b = k.trail[k.trail.length - 1], sz = Math.max(k.box[2] - k.box[0], k.box[3] - k.box[1], 8); return Math.hypot(b[0] - a[0], b[1] - a[1]) > 1.2 * sz; };
const confirmed = k => (k.cls === 'AIR' && k.mot ? k.hits >= 6 && flies(k) : k.hits >= (k.cls === 'MOV' ? 4 : k.cls === 'AIR' ? 3 : 2)) && (k.miss === 0 || (k.cls !== 'MOV' && k.hits >= 5));

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
function drawOverlay(src = tracks) {
  const W = canvas.width, k2 = W / Math.max(1, canvas.clientWidth || W); // пікселів кадру на 1 CSS-піксель
  const fs = Math.round(Math.max(W / 75, 12 * k2)), lw = Math.max(2, Math.round(Math.max(W / 450, 2 * k2)));
  ctx.font = `700 ${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif`;
  ctx.textBaseline = 'middle';
  const vis = src.filter(k => confirmed(k) && S.show[k.cls]);
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


// ------------------------------------------------------------ дозволи (камера, екран) і вибір камери
const PM = {
  uk: { camT: 'Немає доступу до камери', scrT: 'Потрібен дозвіл «Запис екрана»', nfT: 'Камеру не знайдено', busyT: 'Камера зайнята', pickT: 'Яку камеру використати?',
    openCam: 'Відкрити налаштування камери', openScr: 'Відкрити налаштування', retry: 'Спробувати знову', allowCam: 'Дозволити камеру', allowScr: 'Дозволити запис екрана', wsT: 'Екран не вдалося захопити', ws: '<p>Можливі причини:</p><ol><li><b>У вікні вибору натиснули «Скасувати»</b> — натисніть «Спробувати знову» й оберіть <b>вікно програми з відео</b> або весь екран, потім «Поділитися».</li><li><b>macOS не дозволяє браузеру записувати екран.</b> Відкрийте <b>Системні параметри → Конфіденційність і безпека → Запис екрана</b>, увімкніть свій браузер (Chrome або Safari) і <b>перезапустіть браузер</b>.</li></ol><p style="color:#9dbb63">Найзручніше — <b>програма ОКО-ШІ для Mac/Windows</b>: там просто обводите ділянку відео мишею, без цих вікон.</p>', wsTry: 'Спробувати знову', wsDl: 'Скачати програму', askT: 'Дозволити ОКО-ШІ використовувати камеру?', askB: '<p>Камера або HDMI-грабер потрібні, щоб ШІ аналізував відео з пульта.</p>', always: 'Завжди дозволяти', once: 'Тільки зараз', never: 'Ніколи', neverT: 'Камеру вимкнено', neverB: '<p>Раніше ви обрали «Ніколи». Дозволити камеру зараз?</p>', setT: 'Увімкніть OKO-AI у налаштуваннях', setB: '<p>Я відкрив потрібний розділ налаштувань. Увімкніть перемикач навпроти <b>OKO-AI</b> — камера <b>запуститься сама</b>, повертатися й натискати нічого не треба.</p>', setW: 'Чекаю, поки ви увімкнете…', openAgain: 'Відкрити налаштування ще раз', waiting: 'Чекаю на ваше «Дозволити» у вікні macOS…', restart: 'Перезапустити ОКО-ШІ', close: 'Закрити', ok: 'Зрозуміло',
    macCam: '<p>Натисніть <b>«Дозволити камеру»</b> — з\'явиться вікно macOS. Натисніть у ньому <b>«Дозволити»</b>, і камера одразу запрацює.</p><p style="color:#8c9a88;font-size:13px">Якщо вікно не з\'явилося — «Відкрити налаштування камери» і увімкніть OKO-AI.</p>',
    winCam: '<p>Windows не дає програмам камеру.</p><ol><li>Натисніть <b>«Відкрити налаштування камери»</b>.</li><li>Увімкніть <b>«Доступ до камери»</b> і <b>«Дозволити класичним програмам доступ до камери»</b>.</li><li>Натисніть <b>«Спробувати знову»</b>.</li></ol>',
    macScr: '<p>Щоб зони бачили відео на екрані, потрібен дозвіл «Запис екрана». Натисніть <b>«Дозволити запис екрана»</b> і у вікні macOS увімкніть <b>OKO-AI</b> — ОКО-ШІ перезапуститься сама.</p><p style="color:#8c9a88;font-size:13px">Якщо вікно не з\'явилося — «Відкрити налаштування» і увімкніть OKO-AI.</p>',
    andApp: '<p>Дозвольте камеру для застосунку:</p><ol><li>Відкрийте <b>Налаштування → Додатки → ОКО-ШІ → Дозволи</b>.</li><li><b>Камера → Дозволити</b>.</li><li>Поверніться й натисніть <b>«Спробувати знову»</b>.</li></ol>',
    iosWeb: '<p>Safari заблокував камеру.</p><ol><li>Натисніть <b>«аА»</b> (або значок ліворуч в адресному рядку) → <b>Параметри вебсайту → Камера → Дозволити</b>.</li><li>Або: <b>Параметри iPhone → Safari → Камера → Дозволити</b>.</li><li>Натисніть <b>«Спробувати знову»</b>.</li></ol>',
    andWeb: '<p>Браузер заблокував камеру.</p><ol><li>Натисніть <b>значок замка</b> ліворуч в адресному рядку → <b>Дозволи → Камера → Дозволити</b>.</li><li>Натисніть <b>«Спробувати знову»</b>.</li></ol>',
    deskWeb: '<p>Браузер заблокував камеру.</p><ol><li>Натисніть <b>значок камери або замка</b> в адресному рядку → <b>Камера → Дозволити</b>.</li><li>На Mac також: <b>Системні параметри → Конфіденційність і безпека → Камера</b> → увімкніть свій браузер.</li><li>Натисніть <b>«Спробувати знову»</b>.</li></ol>',
    nf: '<p>Пристрій не бачить жодної камери.</p><ol><li>Підключіть <b>HDMI-грабер</b> або вебкамеру (для грабера — кабелем від пульта).</li><li>Зачекайте кілька секунд і натисніть <b>«Спробувати знову»</b>.</li></ol>',
    busy: '<p>Камеру зараз використовує інша програма (Zoom, FaceTime, OBS, Telegram…). Закрийте її й натисніть <b>«Спробувати знову»</b>.</p>',
    pick: 'Знайдено кілька камер. Для відео з пульта оберіть <b>HDMI-грабер</b> (часто називається «USB Video», «Capture», «HDMI»).' },
  en: { camT: 'No camera access', scrT: 'Screen Recording permission needed', nfT: 'No camera found', busyT: 'Camera is busy', pickT: 'Which camera to use?',
    openCam: 'Open camera settings', openScr: 'Open settings', retry: 'Try again', allowCam: 'Allow camera', allowScr: 'Allow screen recording', wsT: 'Could not capture the screen', ws: '<p>Possible reasons:</p><ol><li><b>You pressed “Cancel” in the picker</b> — press “Try again” and choose the <b>window with the video</b> or the whole screen, then “Share”.</li><li><b>macOS does not let the browser record the screen.</b> Open <b>System Settings → Privacy & Security → Screen Recording</b>, enable your browser (Chrome or Safari) and <b>restart the browser</b>.</li></ol><p style="color:#9dbb63">Easiest — the <b>OKO-AI app for Mac/Windows</b>: just draw around the video with the mouse.</p>', wsTry: 'Try again', wsDl: 'Download the app', askT: 'Allow OKO-AI to use the camera?', askB: '<p>The camera or HDMI grabber lets the AI analyse the controller video.</p>', always: 'Always allow', once: 'Only this time', never: 'Never', neverT: 'Camera is off', neverB: '<p>You chose “Never” before. Allow the camera now?</p>', setT: 'Turn on OKO-AI in settings', setB: '<p>I opened the right settings page. Turn on <b>OKO-AI</b> — the camera <b>starts by itself</b>, no need to come back.</p>', setW: 'Waiting for you to turn it on…', openAgain: 'Open settings again', waiting: 'Waiting for your “Allow” in the macOS window…', restart: 'Restart OKO-AI', close: 'Close', ok: 'OK',
    macCam: '<p>Press <b>Allow camera</b> — a macOS window appears. Press <b>Allow</b> there and the camera starts.</p><p style="color:#8c9a88;font-size:13px">If no window appears — Open camera settings and enable OKO-AI.</p>',
    winCam: '<p>Windows blocks camera access.</p><ol><li>Press <b>Open camera settings</b>.</li><li>Turn on <b>Camera access</b> and <b>Let desktop apps access your camera</b>.</li><li>Press <b>Try again</b>.</li></ol>',
    macScr: '<p>Zones need "Screen Recording". Press <b>Allow screen recording</b> and enable <b>OKO-AI</b> in the macOS window — OKO-AI restarts by itself.</p><p style="color:#8c9a88;font-size:13px">If no window appears — Open settings and enable OKO-AI.</p>',
    andApp: '<p>Allow the camera for the app:</p><ol><li>Open <b>Settings → Apps → OKO-AI → Permissions</b>.</li><li><b>Camera → Allow</b>.</li><li>Come back and press <b>Try again</b>.</li></ol>',
    iosWeb: '<p>Safari blocked the camera.</p><ol><li>Tap <b>aA</b> in the address bar → <b>Website Settings → Camera → Allow</b>.</li><li>Or: <b>Settings → Safari → Camera → Allow</b>.</li><li>Press <b>Try again</b>.</li></ol>',
    andWeb: '<p>The browser blocked the camera.</p><ol><li>Tap the <b>lock icon</b> in the address bar → <b>Permissions → Camera → Allow</b>.</li><li>Press <b>Try again</b>.</li></ol>',
    deskWeb: '<p>The browser blocked the camera.</p><ol><li>Click the <b>camera or lock icon</b> in the address bar → <b>Camera → Allow</b>.</li><li>On Mac also: <b>System Settings → Privacy & Security → Camera</b> → enable your browser.</li><li>Press <b>Try again</b>.</li></ol>',
    nf: '<p>No camera is connected.</p><ol><li>Connect an <b>HDMI grabber</b> or a webcam.</li><li>Wait a few seconds and press <b>Try again</b>.</li></ol>',
    busy: '<p>Another app is using the camera (Zoom, FaceTime, OBS, Telegram…). Close it and press <b>Try again</b>.</p>',
    pick: 'Several cameras found. For controller video choose the <b>HDMI grabber</b> (often "USB Video", "Capture", "HDMI").' },
};
const pm = k => (PM[S.lang] || PM.uk)[k];
const ICO_CAM = '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/><path d="M3 3l18 18"/></svg>';
const ICO_SCR = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><circle cx="12" cy="10" r="2.2"/></svg>';
function permDialog(title, html, buttons, ico) {
  $('pmTitle').textContent = title;
  $('pmBody').innerHTML = (ico ? `<div class="pm-ico">${ico}</div>` : '') + html;
  $('pmBtns').innerHTML = '';
  buttons.forEach(([label, fn, pri]) => { const b = document.createElement('button'); b.className = 'pm-btn' + (pri ? ' pri' : ''); b.textContent = label; b.onclick = fn; $('pmBtns').appendChild(b); });
  $('perm').hidden = false;
}
const closePerm = () => { $('perm').hidden = true; };
$('pmClose').onclick = closePerm;
$('perm').onclick = e => { if (e.target.id === 'perm') closePerm(); };
function platformKind() {
  const cap = window.Capacitor; if (cap && cap.isNativePlatform && cap.isNativePlatform()) return cap.getPlatform() === 'ios' ? 'iosApp' : 'andApp';
  if (window.okoDesktop) return okoDesktop.platform === 'darwin' ? 'mac' : 'win';
  const ua = navigator.userAgent; if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iosWeb';
  return /Android/.test(ua) ? 'andWeb' : 'deskWeb';
}
function camHelp(errName) {
  const retry = () => { closePerm(); startSource('cam'); };
  if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError' || errName === 'OverconstrainedError')
    return permDialog(pm('nfT'), pm('nf'), [[pm('retry'), retry, true], [pm('close'), closePerm]], ICO_CAM);
  if (errName === 'NotReadableError' || errName === 'TrackStartError' || errName === 'AbortError')
    return permDialog(pm('busyT'), pm('busy'), [[pm('retry'), retry, true], [pm('close'), closePerm]], ICO_CAM);
  const k = platformKind();
  if ((k === 'mac' || k === 'win') && window.okoDesktop && okoDesktop.cameraStatus) return camAutoSettings();
  const html = { mac: pm('macCam'), win: pm('winCam'), andApp: pm('andApp'), iosApp: pm('iosWeb'), iosWeb: pm('iosWeb'), andWeb: pm('andWeb'), deskWeb: pm('deskWeb') }[k];
  const allowMac = async () => {
    $('pmBtns').querySelector('.pri').textContent = pm('waiting');
    const st = await okoDesktop.cameraAllow();
    if (st === 'granted') { closePerm(); startSource('cam'); } else { $('pmBtns').querySelector('.pri').textContent = pm('allowCam'); }
  };
  const btns = k === 'mac' ? [[pm('allowCam'), allowMac, true], [pm('openCam'), () => okoDesktop.openCameraSettings()]]
    : k === 'win' ? [[pm('openCam'), () => okoDesktop.openCameraSettings(), true], [pm('retry'), retry]]
    : [[pm('allowCam'), retry, true], [pm('close'), closePerm]];
  permDialog(pm('camT'), html, btns, ICO_CAM);
}
function screenHelp() {
  if (!$('perm').hidden) return;
  const allow = async () => { $('pmBtns').querySelector('.pri').textContent = pm('waiting'); await okoDesktop.screenAllow(); };
  permDialog(pm('scrT'), pm('macScr'), [[pm('allowScr'), allow, true], [pm('openScr'), () => okoDesktop.openScreenSettings()], [pm('restart'), () => okoDesktop.relaunch()]], ICO_SCR);
}
function pickCamera(cams, curId) {
  return new Promise(res => {
    permDialog(pm('pickT'), `<p>${pm('pick')}</p><div class="pm-cams">${cams.map((c, i) => `<button class="pm-cam${c.deviceId === curId ? ' cur' : ''}" data-id="${c.deviceId}"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/></svg>${(c.label || ('Камера ' + (i + 1))).replace(/[<>&]/g, '')}</button>`).join('')}</div>`, [[pm('close'), () => { closePerm(); res(null); }]]);
    $('pmBody').querySelectorAll('.pm-cam').forEach(b => b.onclick = () => { closePerm(); res(b.dataset.id); });
  });
}

// згода на камеру (настільна програма): «Завжди / Тільки зараз / Ніколи». У браузері й на Android такий вибір показує сама система.
function camConsent() {
  return new Promise(res => {
    if (!window.okoDesktop || S.camPolicy === 'always') return res(true);
    const set = v => { S.camPolicy = v; save(); };
    if (S.camPolicy === 'never') return permDialog(pm('neverT'), pm('neverB'), [[pm('always'), () => { set('always'); closePerm(); res(true); }, true], [pm('once'), () => { set(undefined); closePerm(); res(true); }], [pm('close'), () => { closePerm(); res(false); }]], ICO_CAM);
    permDialog(pm('askT'), pm('askB'), [[pm('always'), () => { set('always'); closePerm(); res(true); }, true], [pm('once'), () => { closePerm(); res(true); }], [pm('never'), () => { set('never'); closePerm(); res(false); }]], '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/></svg>');
  });
}
// система заблокувала камеру → одразу відкриваємо потрібні налаштування і самі запускаємо камеру, щойно її дозволять
let camWatch = null;
function camAutoSettings() {
  okoDesktop.openCameraSettings();
  permDialog(pm('setT'), pm('setB') + `<p style="color:#9dbb63">⏳ ${pm('setW')}</p>`, [[pm('openAgain'), () => okoDesktop.openCameraSettings(), true], [pm('close'), () => { clearInterval(camWatch); closePerm(); }]], ICO_CAM);
  clearInterval(camWatch); let n = 0;
  camWatch = setInterval(async () => {
    const st = await okoDesktop.cameraStatus();
    if (st === 'granted') { clearInterval(camWatch); closePerm(); startSource('cam'); }
    if (++n > 120 || $('perm').hidden) clearInterval(camWatch);
  }, 1500);
}

async function openCamera() {
  if (window.okoDesktop && okoDesktop.cameraAccess) {
    const st = await okoDesktop.cameraAccess();
    if (st !== 'granted') { camAutoSettings(); return null; }
  }
  const cons = id => ({ video: Object.assign({ width: { ideal: 1920 }, height: { ideal: 1080 } }, id ? { deviceId: { exact: id } } : { facingMode: 'environment' }), audio: false });
  let st;
  try { st = await navigator.mediaDevices.getUserMedia(cons(S.camId)); }
  catch (e) { if (S.camId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { S.camId = null; st = await navigator.mediaDevices.getUserMedia(cons(null)); } else throw e; }
  const cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  if (cams.length > 1) {
    const cur = st.getVideoTracks()[0].getSettings().deviceId;
    show('loading', false);
    const pick = await pickCamera(cams, cur);
    if (!pick) { st.getTracks().forEach(t => t.stop()); return null; }
    if (pick !== cur) { st.getTracks().forEach(t => t.stop()); st = await navigator.mediaDevices.getUserMedia(cons(pick)); }
    S.camId = pick; save(); show('loading', true);
  }
  return st;
}

// ------------------------------------------------------------ керування джерелом
let srcLabel = '';
let running = false, paused = false, srcKind = null, stream = null, aFps = 0, aBusy = false, lastA = 0;
const SRC_W_MAX = 1920;
function frameSize() { return [video.videoWidth, video.videoHeight]; }
function show(el, on) { const e = $(el); if (e) e.hidden = !on; }
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
      show('loading', false);
      if (!(await camConsent())) { srcKind = null; return; }
      show('loading', true);
      stream = await openCamera();
      if (!stream) { show('loading', false); srcKind = null; return; }
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
    stopSource();
    if (kind === 'screen') permDialog(pm('wsT'), pm('ws'), [[pm('wsTry'), () => { closePerm(); startSource('screen'); }, true], [pm('wsDl'), () => { location.href = '../#guide'; }], [pm('close'), closePerm]], ICO_SCR); else if (kind === 'cam') camHelp(e && e.name); else toast(String(e.message || e));
  }
}
function stopSource(silent) {
  running = false; paused = false;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  if (stream) { stream.getTracks().forEach(x => x.stop()); stream = null; }
  if (typeof DT !== 'undefined') { DT.streams.forEach(v => v.stream.getTracks().forEach(x => x.stop())); DT.streams.clear(); show('tbar', false); }
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
  if (srcKind === 'targets') { renderTargets(); requestAnimationFrame(render); return; }
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
    if (window.OKO_DIAG_ON && (++window.OKO_DIAG_N % 10 === 1)) { const d = gctx.getImageData(0, 0, W, H).data; let m = 0; for (let j = 0; j < d.length; j += 400) m += d[j]; window.OKO_DIAG = { bright: Math.round(m / (d.length / 400)), vw: video.videoWidth, rs: video.readyState, t: video.currentTime.toFixed(1) }; }
    try { dets = await detect(grab, W, H, thr, S.small); if (window.OKO_DIAG) window.OKO_DIAG.raw = dets.length; } catch (e) { console.error(e); setStatus('err', t('stErr')); await new Promise(r => setTimeout(r, 500)); continue; }
    if (!running) break;
    const mots = motion(grab, W, H);
    dets = fuse(dets, mots, W, H);
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
  const all = srcKind === 'targets' ? DT.list.flatMap(x => x.tracks) : tracks;
  for (const k of all) if (confirmed(k) && k.miss === 0 && S.show[k.cls]) n[k.cls]++;
  $('cInf').textContent = n.INF; $('cVeh').textContent = n.VEH; $('cAir').textContent = n.AIR; $('cMov').textContent = n.MOV;
  $('stage').classList.toggle('alert', running && (n.INF > 0 || n.AIR > 0));
  $('tInf').classList.toggle('alert', n.INF > 0); $('tAir').classList.toggle('alert', n.AIR > 0); $('tVeh').classList.toggle('alert', n.VEH > 0);
}

// ------------------------------------------------------------ запис / знімок / CSV
let recorder = null, chunks = [];
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
function download(blob, name) {
  // Android/iOS-застосунок: зберігаємо файл і відкриваємо меню «Поділитися» (зберегти, надіслати)
  const cap = window.Capacitor, P = cap && cap.Plugins;
  if (cap && cap.isNativePlatform && cap.isNativePlatform() && P && P.Filesystem && P.Share) {
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        const data = String(rd.result).split(',')[1];
        const w = await P.Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
        await P.Share.share({ title: name, files: [w.uri] });
      } catch (e) { console.warn('share', e); }
    };
    rd.readAsDataURL(blob);
    return;
  }
  if (window.okoDesktop && window.okoDesktop.save) { blob.arrayBuffer().then(b => window.okoDesktop.save(name, b)).then(p => toast((S.lang === 'en' ? 'Saved: ' : 'Збережено: ') + String(p).split(/[\\/]/).slice(-3).join('/'))); return; }
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
  if (window.okoDesktop) { okoDesktop.setLang(S.lang); if (typeof dtLang === 'function') dtLang(); }
  if (typeof renderHelp === 'function' && $('help') && !$('help').hidden) renderHelp();
}
function applyToggles() {
  document.querySelectorAll('.tg').forEach(b => b.classList.toggle('on', !!S.show[b.dataset.cls]));
  $('swSmall').checked = !!S.small; $('sens').value = S.sens; $('sensVal').textContent = S.sens + '%';
  if (S.sensAir == null) S.sensAir = 15; $('sensAir').value = S.sensAir; $('sensAirVal').textContent = S.sensAir + '%';
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
$('sensAir').oninput = e => { S.sensAir = +e.target.value; $('sensAirVal').textContent = S.sensAir + '%'; save(); };
$('langUk').onclick = () => { S.lang = 'uk'; save(); applyLang(); };
$('langEn').onclick = () => { S.lang = 'en'; save(); applyLang(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('help').hidden) { closeHelp(); return; }
  if (e.key === 'Escape' && !$('perm').hidden) { closePerm(); return; }
  if (!running || e.target.tagName === 'INPUT' || !$('stats').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); $('btnPause').click(); }
  else if (e.key === 'r' || e.key === 'к') $('btnRec').click();
  else if (e.key === 's' || e.key === 'і') $('btnShot').click();
  else if (e.key === 'Escape') $('btnStop').click();
});

// пристрої без захоплення екрана (iPhone, Android) — кнопку не показуємо
if (!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) { $('btnScreen').remove(); document.querySelector('.src-grid').style.gridTemplateColumns = 'repeat(2,minmax(140px,200px))'; }
if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) $('btnCam').setAttribute('disabled', '');


// ------------------------------------------------------------ довідка «Як користуватися»
const HELP = {
  uk: { t: 'Як користуватися', more: 'Повна інструкція для всіх пристроїв', steps: [
    'Оберіть джерело: <b>Відеозапис</b> (файл з дрона), <b>Екран</b> (вікно пульта), <b>Камера</b> (HDMI-грабер). Щоб спробувати — <b>Демо</b>.',
    'ШІ обводить цілі рамками з типом і <b>впевненістю у %</b>. Пунктир — ціль сховалась, показано, де вона може бути.',
    'Є <b>піхота або дрон</b> — край кадру й лічильник світяться червоним.',
    'Під відео: <b>пауза</b> (Пробіл), <b>запис</b> (R), <b>знімок</b> (S), <b>стоп</b> (Esc).',
    'Праворуч: які цілі показувати, <b>«Дрібна піхота»</b> для зйомки з висоти і дві <b>чутливості</b>: окремо для піхоти/техніки та для <b>дронів</b>. Вище — більше знаходить, але й більше хибних. Якщо «дронів» забагато — зменште повзунок «Дрони».',
    '<b>Журнал</b> — виявлення з часом (CSV для Excel). <b>Статистика</b> — 3 доби з фото кожної цілі та кнопкою <b>Звіт</b>.'],
    leg: [['ПІХОТА', '#ff4b3e', 'червона рамка'], ['ТЕХНІКА', '#ffcf33', 'жовта рамка'], ['ДРОН', '#45f07a', 'зелена рамка'], ['РУХ', '#ff9a1f', 'рух, тип не визначено']] },
  en: { t: 'How to use', more: 'Full guide for all devices', steps: [
    'Choose a source: <b>Video file</b>, <b>Screen</b> (controller window) or <b>Camera</b> (HDMI grabber). To try it — <b>Demo</b>.',
    'The AI boxes targets with type and <b>confidence %</b>. Dashed box — target hidden, likely position shown.',
    '<b>Infantry or a drone</b> present — the frame edge and counter glow red.',
    'Under the video: <b>pause</b> (Space), <b>record</b> (R), <b>snapshot</b> (S), <b>stop</b> (Esc).',
    'On the right: which targets to show, <b>Small infantry</b> for high altitude and two <b>sensitivities</b>: infantry/vehicles and <b>drones</b>. Higher finds more, with more false alarms. Too many "drones"? Lower the Drones slider.',
    '<b>Log</b> — detections with time (CSV for Excel). <b>Statistics</b> — 3 days with a photo of every target and a <b>Report</b> button.'],
    leg: [['INFANTRY', '#ff4b3e', 'red box'], ['VEHICLE', '#ffcf33', 'yellow box'], ['DRONE', '#45f07a', 'green box'], ['MOTION', '#ff9a1f', 'motion, type unknown']] },
};
function renderHelp() {
  const h = HELP[S.lang] || HELP.uk;
  $('hpTitle').textContent = h.t; $('hpMore').textContent = h.more; $('btnHelp').title = h.t;
  $('hpSteps').innerHTML = h.steps.map(x => `<li><span>${x}</span></li>`).join('');
  $('hpLeg').innerHTML = h.leg.map(([a, c, b]) => `<div style="border-left-color:${c}"><b style="color:${c}">${a}</b>${b}</div>`).join('');
}
$('btnHelp').onclick = () => { renderHelp(); $('help').hidden = false; };
const closeHelp = () => { $('help').hidden = true; try { localStorage.setItem('oko.helpSeen', '1'); } catch (e) {} };
$('hpClose').onclick = closeHelp;
$('help').onclick = e => { if (e.target.id === 'help') closeHelp(); };
// перший запуск — показати довідку, доки людина її не закриє
try { if (!localStorage.getItem('oko.helpSeen')) setTimeout(() => { if (!running && !localStorage.getItem('oko.helpSeen')) { renderHelp(); $('help').hidden = false; } }, 700); } catch (e) {}

// ------------------------------------------------------------ НАСТІЛЬНА ВЕРСІЯ: зони аналізу
const DT = { list: [], streams: new Map(), active: null, busy: false };
const DTX = {
  uk: { aim: 'Виділити зону', aimS: 'обвести ділянку відео на екрані', add: '＋ Зона', name: n => `Екран ${n}`, perm: 'Дозвольте ОКО-ШІ «Запис екрана» в Системних параметрах і перезапустіть програму', permBtn: 'Відкрити налаштування', hint: 'Натисніть «Виділити зону» (або «＋ Виділити зону» у смужці в правому нижньому кутку) й обведіть мишею ділянку з відео дрона. Зона горить зеленим, а коли ШІ бачить піхоту чи дрон — червоним. Зон може бути до 10.' },
  en: { aim: 'Select zone', aimS: 'draw around the video on screen', add: '＋ Zone', name: n => `Screen ${n}`, perm: 'Allow OKO-AI "Screen Recording" in System Settings and restart the app', permBtn: 'Open settings', hint: 'Press "Select zone" (or "＋ Select zone" in the strip at the bottom-right) and draw around the drone video. The zone glows green, and red when the AI sees infantry or a drone. Up to 10 zones.' },
};
const dx = k => (DTX[S.lang] || DTX.uk)[k];
function dtLang() {
  if (!window.okoDesktop) return;
  const b = $('btnScreen'); if (b) { b.querySelector('b').textContent = dx('aim'); b.querySelector('small').textContent = dx('aimS'); }
  if ($('tbAdd')) $('tbAdd').textContent = dx('add');
  renderTbar();
}
function renderTbar() {
  const bar = $('tbar'); if (!bar) return;
  bar.querySelector('.tb-list').innerHTML = DT.list.map(x => {
    const n = x.tracks.filter(k => confirmed(k) && k.miss === 0 && (k.cls === 'INF' || k.cls === 'AIR')).length;
    return `<button class="tb${x.id === DT.active ? ' on' : ''}${n ? ' hot' : ''}" data-id="${x.id}">${dx('name')(x.n)}${n ? ` · ${n}` : ''}</button>`;
  }).join('');
}
async function displayStream(t) {
  const key = String(t.displayId);
  if (DT.streams.has(key)) return DT.streams.get(key);
  const srcs = await okoDesktop.sources();
  const src = srcs.find(x => x.displayId === key) || (srcs.length === 1 ? srcs[0] : srcs[DT.streams.size % Math.max(1, srcs.length)]);
  if (!src) throw new Error('no screen source');
  const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxWidth: Math.round(t.display.width * t.display.scale), maxHeight: Math.round(t.display.height * t.display.scale), maxFrameRate: 30 } } });
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = st; await v.play();
  const rec = { video: v, stream: st }; DT.streams.set(key, rec); return rec;
}
async function onTargets(list) {
  // оновити список, зберігши треки існуючих зон
  const old = new Map(DT.list.map(x => [x.id, x]));
  DT.list = list.map(t => Object.assign(old.get(t.id) || { tracks: [], prevGray: null, fresh: new Set() }, t));
  if (!DT.list.find(x => x.id === DT.active)) DT.active = DT.list.length ? DT.list[DT.list.length - 1].id : null;
  // прибрати потоки моніторів, де вже немає зон
  for (const [k, v] of DT.streams) if (!DT.list.some(x => String(x.displayId) === k)) { v.stream.getTracks().forEach(z => z.stop()); DT.streams.delete(k); }
  if (DT.list.length && srcKind !== 'targets') {
    if (running) stopSource(true);
    if (window.okoDesktop.platform === 'darwin') { const a = await okoDesktop.screenAccess(); if (a === 'denied' || a === 'restricted') screenHelp(); }
    show('loading', true);
    try { await loadModel(); } catch (e) { show('loading', false); return; }
    srcKind = 'targets'; running = true; paused = false; prevGray = null;
    show('start', false); show('loading', false); show('controls', true); show('tbar', true);
    setStatus('ok', `${t('stRun')} · ${ep}`); updPause();
    requestAnimationFrame(render); analyseTargets();
  } else if (!DT.list.length && srcKind === 'targets') { stopSource(); }
  renderTbar(); updCounts();
}
function permBanner(on) {
  let b = $('permBanner');
  if (!b && on) { b = document.createElement('div'); b.id = 'permBanner'; b.className = 'toast perm'; $('stage').appendChild(b); }
  if (!b) return;
  if (!on) { b.remove(); return; }
  b.innerHTML = `${dx('perm')} <button class="mini" id="permOpen">${dx('permBtn')}</button>`; b.hidden = false;
  $('permOpen').onclick = () => okoDesktop.openScreenSettings();
}
function cropOf(x, rec) {
  const v = rec.video, k = v.videoWidth / x.display.width;
  const sx = Math.max(0, (x.rect.x - x.display.x) * k), sy = Math.max(0, (x.rect.y - x.display.y) * k);
  const sw = Math.min(v.videoWidth - sx, x.rect.width * k), sh = Math.min(v.videoHeight - sy, x.rect.height * k);
  return [sx, sy, Math.max(2, sw), Math.max(2, sh)];
}
async function analyseTargets() {
  let i = 0, blackChecked = false;
  while (running && srcKind === 'targets') {
    if (paused || !DT.list.length) { await new Promise(r => setTimeout(r, 120)); continue; }
    const x = DT.list[i++ % DT.list.length];
    let rec; try { rec = await displayStream(x); } catch (e) { console.warn(e); if (okoDesktop.platform === 'darwin') screenHelp(); else permBanner(true); await new Promise(r => setTimeout(r, 1500)); continue; }
    if (rec.video.readyState < 2) { await new Promise(r => setTimeout(r, 60)); continue; }
    const t0 = performance.now();
    const [sx, sy, sw, sh] = cropOf(x, rec);
    const sc = Math.min(1, 1280 / sw), W = Math.round(sw * sc), H = Math.round(sh * sc);
    grab.width = W; grab.height = H; gctx.drawImage(rec.video, sx, sy, sw, sh, 0, 0, W, H);
    if (!blackChecked) { // Mac без дозволу віддає порожній (чорний) кадр
      blackChecked = true; const d = gctx.getImageData(0, 0, Math.min(W, 64), Math.min(H, 64)).data; let m = 0; for (let j = 0; j < d.length; j += 4) m = Math.max(m, d[j], d[j + 1], d[j + 2]);
      if (m < 3 && okoDesktop.platform === 'darwin') screenHelp();
    }
    x.W = W; x.H = H;
    const thr = Math.max(0.08, (60 - S.sens) / 100);
    let dets; try { dets = await detect(grab, W, H, thr, S.small); } catch (e) { console.error(e); await new Promise(r => setTimeout(r, 300)); continue; }
    if (!running || srcKind !== 'targets' || !DT.list.includes(x)) continue;
    // курсор миші над відео — не ціль
    try {
      const c = await okoDesktop.cursor(), kx = W / x.rect.width, cx = (c.x - x.rect.x) * kx, cy = (c.y - x.rect.y) * kx;
      if (cx > -20 && cy > -20 && cx < W + 20 && cy < H + 20) dets = dets.filter(d => !(cx > d.box[0] - 25 && cx < d.box[2] + 25 && cy > d.box[1] - 25 && cy < d.box[3] + 25 && (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]) < 0.02 * W * H));
      x.cur = [cx, cy];
    } catch (e) {}
    // свої треки й попередній кадр для кожної зони
    tracks = x.tracks; prevGray = x.prevGray;
    const mots = motion(grab, W, H);
    const mots2 = x.cur ? mots.filter(m => !(m.box[0] - 30 < x.cur[0] && x.cur[0] < m.box[2] + 30 && m.box[1] - 30 < x.cur[1] && x.cur[1] < m.box[3] + 30)) : mots;
    dets = fuse(dets, mots2, W, H);
    const dt = (performance.now() - t0) / 1000;
    aFps = aFps ? 0.85 * aFps + 0.15 / Math.max(dt, 0.001) : 1 / Math.max(dt, 0.001);
    trackStep(dets, Math.max(4, Math.round(aFps / DT.list.length * 1.5)));
    x.tracks = tracks; x.prevGray = prevGray;
    srcLabel = dx('name')(x.n);
    const fresh = { inf: 0, air: 0 };
    for (const k of x.tracks) if (confirmed(k) && !k.logged && k.miss === 0) { k.logged = true; if (S.show[k.cls] && k.cls !== 'MOV') { addLog(k); if (k.cls === 'INF') fresh.inf++; if (k.cls === 'AIR') fresh.air++; } }
    const live = c => x.tracks.filter(k => confirmed(k) && k.miss === 0 && k.cls === c && S.show[c]).length;
    okoDesktop.status(x.id, { inf: live('INF'), veh: live('VEH'), air: live('AIR'), fresh });
    tracks = [];
    updCounts(); renderTbar();
    $('ctlInfo').textContent = `${aFps.toFixed(1)} ${t('fps')} · ${DT.list.length}×${recorder && recorder.state === 'recording' ? ' · ● REC' : ''}`;
    await new Promise(r => setTimeout(r, 0));
  }
}
function renderTargets() {
  const x = DT.list.find(z => z.id === DT.active); if (!x) return;
  const rec = DT.streams.get(String(x.displayId)); if (!rec || rec.video.readyState < 2) return;
  const [sx, sy, sw, sh] = cropOf(x, rec);
  const sc = Math.min(1, 1280 / sw), W = Math.round(sw * sc), H = Math.round(sh * sc);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  if (!paused) ctx.drawImage(rec.video, sx, sy, sw, sh, 0, 0, W, H);
  drawOverlay(x.tracks);
}
if (window.okoDesktop) {
  document.body.classList.add('desktop');
  // «Екран» → «Виділити зону»
  const b = $('btnScreen');
  if (b) {
    b.querySelector('svg').outerHTML = '<svg viewBox="0 0 24 24" style="stroke:#45f07a;filter:drop-shadow(0 0 6px rgba(69,240,122,.5))"><rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="3.2 2.4"/><path d="M8 12h8M12 8v8" stroke-dasharray="none"/></svg>';
    b.onclick = () => okoDesktop.addAim();
  }
  // плашки зон над відео
  const bar = document.createElement('div'); bar.id = 'tbar'; bar.className = 'tbar'; bar.hidden = true;
  bar.innerHTML = '<div class="tb-list"></div><button class="tb add" id="tbAdd"></button>';
  $('stage').appendChild(bar);
  bar.addEventListener('click', e => {
    const tb = e.target.closest('.tb'); if (!tb) return;
    if (tb.id === 'tbAdd') { okoDesktop.addAim(); return; }
    DT.active = tb.dataset.id; renderTbar();
  });
  const hint = document.createElement('div'); hint.className = 'start-s dt-hint'; hint.id = 'dtHint'; document.querySelector('.start').appendChild(hint);
  const _dtl = dtLang; dtLang = function () { _dtl(); $('dtHint').textContent = dx('hint'); };
  okoDesktop.onTargets(onTargets);
  okoDesktop.onFocusTarget(id => { DT.active = id; renderTbar(); });
  okoDesktop.targets().then(onTargets);
  // «Стоп» прибирає всі зони
  const st = $('btnStop').onclick; $('btnStop').onclick = () => { if (srcKind === 'targets') DT.list.forEach(x => okoDesktop.removeTarget(x.id)); st(); };
  okoDesktop.setLang(S.lang); dtLang();
}

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

// ------------------------------------------------------------ самоперевірка (тільки тестова збірка з autotest.json)
fetch('autotest.json').then(r => r.ok ? r.json() : null).then(cfg => {
  if (!cfg || !cfg.autotest) return;
  const L = (tag, o) => console.log(tag + ' ' + JSON.stringify(o));
  try { localStorage.setItem('oko.helpSeen', '1'); } catch (e) {} $('help').hidden = true;
  const dpr = window.devicePixelRatio || 1;
  addEventListener('pointerdown', e => L('OKO_TOUCH', { x: e.clientX, y: e.clientY, dpr, t: e.target.id || e.target.className }), true);
  const ids = ['btnDemoInf', 'btnStop', 'btnStats', 'stClose', 'tgInf', 'langEn', 'langUk'];
  window.OKO_DIAG_ON = true; window.OKO_DIAG_N = 0;
  // перевірка ШІ на нерухомому кадрі (не залежить від відеодекодера пристрою)
  const still = async () => {
    try { await loadModel(); const im = new Image(); im.src = 'demo/infantry.jpg'; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
      const t0 = performance.now(); const d = await detect(c, c.width, c.height, 0.35, false);
      L('OKO_STILL', { n: d.length, inf: d.filter(x => x.cls === 'INF').length, ms: Math.round(performance.now() - t0) });
    } catch (e) { L('OKO_STILL', { err: String(e) }); }
  };
  setTimeout(still, 1500);
  setInterval(() => {
    const el = {};
    for (const id of ids) { const e = $(id); if (!e) continue; const r = e.getBoundingClientRect(); if (r.width && r.height && e.offsetParent !== null) el[id] = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }
    L('OKO_EL', { dpr, w: innerWidth, h: innerHeight, el, ready: !!session, running, ep, ctl: $('controls').hidden, st: $('start').hidden, so: !$('stats').hidden, tg: $('tgInf').classList.contains('on'), sy: Math.round(scrollY) });
    if (running) L('OKO_RESULT', { inf: +$('cInf').textContent, veh: +$('cVeh').textContent, log: logRows.length, fps: aFps.toFixed(1), ep, diag: window.OKO_DIAG || null });
    if (!$('stats').hidden) L('OKO_STATS', { photos: document.querySelectorAll('#stGallery .ph').length });
  }, 2000);
}).catch(() => {});

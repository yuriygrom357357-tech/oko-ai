/* ОКО-ШІ — «Статистика»: виявлення за останні 3 доби з фото-підтвердженням.
   Дані зберігаються тільки на цьому пристрої (IndexedDB), старші за 3 доби видаляються автоматично. */
'use strict';
(() => {
  const KEEP_MS = 3 * 24 * 3600 * 1000, MAX_REC = 4000;
  const TX = {
    uk: {
      stats: 'Статистика', title: 'Статистика · 3 доби', close: 'Закрити', report: 'Звіт', clearAll: 'Очистити',
      all3: '3 доби', today: 'Сьогодні', yday: 'Вчора', dby: 'Позавчора', allCls: 'Усі',
      summary: 'Підсумок', activity: 'Активність по годинах', photos: 'Фото-підтвердження',
      none: 'За цей період виявлень немає. Запустіть аналіз відео — кожна виявлена ціль буде збережена тут з фото.',
      sumHead: (a, b) => `За період ${a} – ${b} виявлено:`,
      peak: 'найбільше', at: 'о', srcs: 'Джерела відео', avg: 'середня впевненість',
      confirmClear: 'Видалити всю статистику та фото за 3 доби?', cleared: 'Статистику очищено', saved: 'Звіт збережено',
      savePhoto: 'Зберегти фото', src: 'Джерело', time: 'Час', conf: 'Впевненість', type: 'Тип', track: 'Ціль',
      reportTitle: 'ОКО-ШІ — звіт виявлень', generated: 'Сформовано', note: 'Звіт сформовано автоматично в ОКО-ШІ (розробник: Юрій Мельничук, 158 навчальний центр, позивний «Композитор»). Рішення приймає оператор.',
      noData: 'Немає даних для звіту', more: 'Показати ще', hour: 'год',
      src_file: 'файл', src_demo: 'демо', src_screen: 'екран', src_cam: 'камера',
    },
    en: {
      stats: 'Statistics', title: 'Statistics · 3 days', close: 'Close', report: 'Report', clearAll: 'Clear',
      all3: '3 days', today: 'Today', yday: 'Yesterday', dby: '2 days ago', allCls: 'All',
      summary: 'Summary', activity: 'Activity by hour', photos: 'Photo evidence',
      none: 'No detections in this period. Run a video analysis — every detected target is saved here with a photo.',
      sumHead: (a, b) => `Detected between ${a} and ${b}:`,
      peak: 'peak', at: 'at', srcs: 'Video sources', avg: 'average confidence',
      confirmClear: 'Delete all statistics and photos for 3 days?', cleared: 'Statistics cleared', saved: 'Report saved',
      savePhoto: 'Save photo', src: 'Source', time: 'Time', conf: 'Confidence', type: 'Type', track: 'Target',
      reportTitle: 'OKO-AI — detection report', generated: 'Generated', note: 'Generated automatically by OKO-AI (developer: Yuriy Melnychuk, 158th Training Centre, callsign “Kompozytor”). The operator makes the decision.',
      noData: 'No data for a report', more: 'Show more', hour: 'h',
      src_file: 'file', src_demo: 'demo', src_screen: 'screen', src_cam: 'camera',
    },
  };
  const tx = k => (TX[S.lang] || TX.uk)[k];
  const CL = ['INF', 'VEH', 'AIR'];
  const name = c => t(LBL[c]);

  // ---------------------------------------------------------- база на пристрої
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('oko-stats', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('det', { keyPath: 'key', autoIncrement: true }); s.createIndex('ts', 'ts'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx_(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => { const x = d.transaction('det', mode), st = x.objectStore('det'); const out = fn(st); x.oncomplete = () => res(out && out.result !== undefined ? out.result : out); x.onerror = () => rej(x.error); });
  }
  const getAll = () => db().then(d => new Promise((res, rej) => { const r = d.transaction('det').objectStore('det').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  async function prune() {
    const lim = Date.now() - KEEP_MS;
    await tx_('readwrite', st => { const r = st.index('ts').openCursor(IDBKeyRange.upperBound(lim)); r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } }; });
    const d = await db();
    const n = await new Promise(res => { const r = d.transaction('det').objectStore('det').count(); r.onsuccess = () => res(r.result); });
    if (n > MAX_REC) await tx_('readwrite', st => { let left = n - MAX_REC; const r = st.index('ts').openCursor(); r.onsuccess = () => { const c = r.result; if (c && left-- > 0) { c.delete(); c.continue(); } }; });
  }

  // ---------------------------------------------------------- фото-доказ
  const cc = document.createElement('canvas'), cx = cc.getContext('2d');
  function jpeg(w, h, draw, q) { cc.width = w; cc.height = h; draw(cx); return cc.toDataURL('image/jpeg', q); }
  function record(k, frame, srcName) {
    try {
      const W = frame.width, H = frame.height, [x1, y1, x2, y2] = k.box;
      const bw = x2 - x1, bh = y2 - y1, side = Math.max(110, Math.max(bw, bh) * 2.2);
      const cxm = (x1 + x2) / 2, cym = (y1 + y2) / 2;
      const sx = Math.max(0, Math.min(W - side, cxm - side / 2)), sy = Math.max(0, Math.min(H - side, cym - side / 2));
      const sw = Math.min(side, W), sh = Math.min(side, H);
      const col = COL[k.cls];
      const crop = jpeg(240, Math.round(240 * sh / sw), c => {
        c.drawImage(frame, sx, sy, sw, sh, 0, 0, 240, 240 * sh / sw);
        const r = 240 / sw; c.strokeStyle = col; c.lineWidth = 2; c.strokeRect((x1 - sx) * r, (y1 - sy) * r, bw * r, bh * r);
      }, 0.82);
      const fw = Math.min(1024, W), fr = fw / W;
      const full = jpeg(fw, Math.round(H * fr), c => {
        c.drawImage(frame, 0, 0, fw, H * fr);
        c.strokeStyle = col; c.lineWidth = 3; c.strokeRect(x1 * fr, y1 * fr, bw * fr, bh * fr);
      }, 0.72);
      const rec = { ts: Date.now(), cls: k.cls, id: k.id, p: Math.round(shownConf(k) * 100), src: srcName || '', crop, full };
      tx_('readwrite', st => st.add(rec)).then(() => { if (!$('stats').hidden) render(); }).catch(e => console.warn('stats', e));
    } catch (e) { console.warn('stats record', e); }
  }

  // ---------------------------------------------------------- вигляд
  const st = { day: 'all', cls: 'all', shown: 48, rows: [] };
  const dayStart = off => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d.getTime(); };
  const fmtD = ts => new Date(ts).toLocaleDateString(S.lang === 'en' ? 'en-GB' : 'uk-UA', { day: '2-digit', month: '2-digit' });
  const fmtT = ts => new Date(ts).toTimeString().slice(0, 5);
  const fmtTS = ts => new Date(ts).toTimeString().slice(0, 8);
  function filtered(rows) {
    let lo = Date.now() - KEEP_MS, hi = Infinity;
    if (st.day !== 'all') { const off = +st.day; lo = dayStart(off); hi = off === 0 ? Infinity : dayStart(off - 1); }
    return rows.filter(r => r.ts >= lo && r.ts < hi && (st.cls === 'all' || r.cls === st.cls));
  }
  function summaryText(rows) {
    if (!rows.length) return `<p class="st-none">${tx('none')}</p>`;
    const a = Math.min(...rows.map(r => r.ts)), b = Math.max(...rows.map(r => r.ts));
    let html = `<p>${tx('sumHead')(fmtD(a) + ' ' + fmtT(a), fmtD(b) + ' ' + fmtT(b))}</p><ul>`;
    for (const c of CL) {
      const rr = rows.filter(r => r.cls === c); if (!rr.length) continue;
      const byH = {}; rr.forEach(r => { const d = new Date(r.ts); const key = fmtD(r.ts) + ' ' + tx('at') + ' ' + String(d.getHours()).padStart(2, '0') + ':00'; byH[key] = (byH[key] || 0) + 1; });
      const pk = Object.entries(byH).sort((x, y) => y[1] - x[1])[0];
      const avg = Math.round(rr.reduce((s, r) => s + r.p, 0) / rr.length);
      html += `<li><b style="color:${COL[c]}">${name(c)} — ${rr.length}</b> <span>(${tx('peak')}: ${pk[0]} — ${pk[1]}; ${tx('avg')} ${avg}%)</span></li>`;
    }
    html += '</ul>';
    const srcs = {}; rows.forEach(r => { if (r.src) srcs[r.src] = (srcs[r.src] || 0) + 1; });
    const sl = Object.entries(srcs).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([s, n]) => `${s} (${n})`).join(', ');
    if (sl) html += `<p class="st-src">${tx('srcs')}: ${sl}</p>`;
    return html;
  }
  function heatmap(rows) {
    // 3 рядки (доби) × 24 години; яскравість = кількість піхоти+дронів+техніки
    const days = [2, 1, 0];
    const grid = days.map(off => { const lo = dayStart(off), hi = off === 0 ? Infinity : dayStart(off - 1); const h = new Array(24).fill(0).map(() => ({ INF: 0, VEH: 0, AIR: 0 })); rows.forEach(r => { if (r.ts >= lo && r.ts < hi && h[new Date(r.ts).getHours()][r.cls] !== undefined) h[new Date(r.ts).getHours()][r.cls]++; }); return { off, h }; });
    const max = Math.max(1, ...grid.flatMap(g => g.h.map(c => c.INF + c.VEH + c.AIR)));
    let html = '<div class="hm">';
    for (const g of grid) {
      html += `<div class="hm-row"><span class="hm-d">${[tx('today'), tx('yday'), tx('dby')][g.off]}<small>${fmtD(dayStart(g.off))}</small></span><div class="hm-cells">`;
      g.h.forEach((c, hr) => {
        const n = c.INF + c.VEH + c.AIR, top = n ? (c.INF >= c.AIR && c.INF >= c.VEH ? 'INF' : c.AIR >= c.VEH ? 'AIR' : 'VEH') : null;
        const a = n ? 0.25 + 0.75 * (n / max) : 0;
        html += `<i title="${String(hr).padStart(2, '0')}:00 — ${name('INF')} ${c.INF}, ${name('VEH')} ${c.VEH}, ${name('AIR')} ${c.AIR}" style="${top ? `background:${COL[top]};opacity:${a.toFixed(2)}` : ''}">${n > 0 && n / max > 0.5 ? n : ''}</i>`;
      });
      html += '</div></div>';
    }
    html += '<div class="hm-row hm-axis"><span class="hm-d"></span><div class="hm-cells">' + Array.from({ length: 24 }, (_, h) => `<b>${h % 3 === 0 ? String(h).padStart(2, '0') : ''}</b>`).join('') + '</div></div></div>';
    return html;
  }
  async function render() {
    await prune().catch(() => {});
    st.rows = (await getAll().catch(() => [])).sort((a, b) => b.ts - a.ts);
    const all3 = st.rows.filter(r => r.ts >= Date.now() - KEEP_MS);
    const rows = filtered(st.rows);
    // лічильники (за обрану добу, всі класи)
    const forTiles = st.cls === 'all' ? rows : (() => { const c = st.cls; st.cls = 'all'; const r = filtered(st.rows); st.cls = c; return r; })();
    for (const c of CL) $('st' + c).textContent = forTiles.filter(r => r.cls === c).length;
    $('stSummary').innerHTML = summaryText(forTiles);
    $('stHeat').innerHTML = heatmap(all3);
    const g = $('stGallery');
    if (!rows.length) { g.innerHTML = `<div class="st-none">${tx('none')}</div>`; $('stMore').hidden = true; }
    else {
      g.innerHTML = rows.slice(0, st.shown).map(r => `<button class="ph ${r.cls}" data-key="${r.key}"><img src="${r.crop}" alt="" loading="lazy"><span class="ph-k" style="color:${COL[r.cls]}">${name(r.cls)} ${r.p}%</span><span class="ph-t">${fmtD(r.ts)} · ${fmtTS(r.ts)}</span></button>`).join('');
      $('stMore').hidden = rows.length <= st.shown;
    }
    $('stCount').textContent = rows.length;
    document.querySelectorAll('#stDays .pill').forEach(b => b.classList.toggle('on', b.dataset.day === st.day));
    document.querySelectorAll('#stCls .pill').forEach(b => b.classList.toggle('on', b.dataset.cls === st.cls));
  }
  function openViewer(key) {
    const r = st.rows.find(x => String(x.key) === String(key)); if (!r) return;
    $('vwImg').src = r.full;
    $('vwInfo').innerHTML = `<b style="color:${COL[r.cls]}">${name(r.cls)} #${r.id} · ${r.p}%</b><span>${fmtD(r.ts)} ${fmtTS(r.ts)}</span><span>${tx('src')}: ${r.src || '—'}</span>`;
    $('vwSave').onclick = () => fetch(r.full).then(x => x.blob()).then(b => download(b, `oko_${r.cls}_${r.id}_${new Date(r.ts).toISOString().slice(0, 19).replace(/[-:T]/g, '')}.jpg`));
    $('viewer').hidden = false;
  }
  async function report() {
    const rows = filtered((await getAll()).sort((a, b) => a.ts - b.ts));
    if (!rows.length) { toast(tx('noData')); return; }
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const tiles = CL.map(c => `<div class="t" style="border-color:${COL[c]}"><b style="color:${COL[c]}">${rows.filter(r => r.cls === c).length}</b><span>${name(c)}</span></div>`).join('');
    const items = rows.map(r => `<div class="it"><img src="${r.full}"><div><b style="color:${COL[r.cls]}">${name(r.cls)} #${r.id} — ${r.p}%</b><br>${fmtD(r.ts)} ${fmtTS(r.ts)}<br><small>${tx('src')}: ${esc(r.src || '—')}</small></div></div>`).join('');
    const html = `<!DOCTYPE html><html lang="${S.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tx('reportTitle')}</title>
<style>body{font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0a0e0b;color:#e6ecdf;margin:0;padding:24px;max-width:1000px;margin:auto}
h1{margin:0 0 4px;letter-spacing:.04em}h2{color:#6fb6ff;font-size:15px;text-transform:uppercase;letter-spacing:.06em;margin:26px 0 10px}
.m{color:#8c9a88}.ts{display:flex;gap:10px;margin:16px 0}.t{flex:1;border:1px solid;border-radius:14px;padding:10px 14px;background:#151d17}.t b{font-size:28px;display:block}.t span{font-size:12px;letter-spacing:.1em}
.sum{background:#151d17;border-radius:14px;padding:12px 16px}.sum ul{margin:6px 0;padding-left:18px}.sum span{color:#8c9a88}
.it{display:grid;grid-template-columns:320px 1fr;gap:14px;align-items:start;background:#121913;border-radius:14px;padding:10px;margin-bottom:10px;break-inside:avoid}.it img{width:100%;border-radius:10px}
@media print{body{background:#fff;color:#000}.t,.sum,.it{background:#f4f4f4}.m,.sum span{color:#555}}</style></head><body>
<h1>${tx('reportTitle')}</h1><div class="m">${tx('generated')}: ${new Date().toLocaleString(S.lang === 'en' ? 'en-GB' : 'uk-UA')}</div>
<div class="ts">${tiles}</div><h2>${tx('summary')}</h2><div class="sum">${summaryText(rows)}</div>
<h2>${tx('photos')} (${rows.length})</h2>${items}<p class="m">${tx('note')}</p></body></html>`;
    download(new Blob([html], { type: 'text/html;charset=utf-8' }), `oko_zvit_${stamp()}.html`);
    toast(tx('saved'));
  }
  function applyLang() {
    document.querySelectorAll('[data-st]').forEach(el => el.textContent = tx(el.dataset.st));
    if (!$('stats').hidden) render();
  }

  // ---------------------------------------------------------- події
  $('btnStats').onclick = () => { st.shown = 48; $('stats').hidden = false; render(); };
  $('stClose').onclick = () => { $('stats').hidden = true; };
  $('stReport').onclick = report;
  $('stClear').onclick = async () => {
    let ok = true; try { ok = window.confirm(tx('confirmClear')); } catch (e) {}
    if (!ok) return;
    await tx_('readwrite', s => s.clear()); toast(tx('cleared')); render();
  };
  $('stDays').onclick = e => { const b = e.target.closest('.pill'); if (b) { st.day = b.dataset.day; st.shown = 48; render(); } };
  $('stCls').onclick = e => { const b = e.target.closest('.pill'); if (b) { st.cls = b.dataset.cls; st.shown = 48; render(); } };
  $('stGallery').onclick = e => { const b = e.target.closest('.ph'); if (b) openViewer(b.dataset.key); };
  $('stMore').onclick = () => { st.shown += 48; render(); };
  $('vwClose').onclick = () => { $('viewer').hidden = true; };
  $('viewer').onclick = e => { if (e.target.id === 'viewer') $('viewer').hidden = true; };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('viewer').hidden) { $('viewer').hidden = true; e.stopImmediatePropagation(); } else if (!$('stats').hidden) { $('stats').hidden = true; e.stopImmediatePropagation(); } } }, true);

  window.OKO_STATS = { record, applyLang, render };
  applyLang();
  prune().catch(() => {});
})();

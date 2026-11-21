// ОКО-ШІ (EYE-AI) — настільна програма для Mac і Windows.
// Головне вікно = та сама програма, що й у браузері (/app/). Додатково: червоний приціл,
// який перетягують на вікно пульта чи монітор → там з'являється рамка-ціль, і ШІ сканує саме її.
'use strict';
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, Tray, Menu, nativeImage, protocol, net,
  Notification, systemPreferences, shell, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const APP_ID = 'ua.okoai.desktop';
const tccReset = svc => new Promise(r => execFile('/usr/bin/tccutil', ['reset', svc, APP_ID], () => r()));

const WEB = path.join(__dirname, 'web');
const TEST = process.env.OKO_TEST === '1';
if (TEST) app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

protocol.registerSchemesAsPrivileged([{ scheme: 'oko', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let main = null, tray = null;
const targets = new Map(); // id → { id, n, win, displayId, alert }
let nextN = 1;
const T = (uk, en) => (lang === 'en' ? en : uk);
let lang = 'uk';

function iconPath(name) { return path.join(__dirname, 'icons', name); }

function createMain() {
  main = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600, title: 'ОКО-ШІ', backgroundColor: '#0a0e0b',
    icon: iconPath('icon.png'), show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false, contextIsolation: true },
  });
  main.removeMenu && process.platform !== 'darwin' && main.removeMenu();
  main.loadURL('oko://app/index.html');
  main.once('ready-to-show', () => main.show());
  main.on('close', e => { if (!app.isQuitting && targets.size) { e.preventDefault(); main.minimize(); } });
  main.on('closed', () => { main = null; });
}

// ------------------------------------------------------------ ЗОНИ: виділення прямокутником, смужка «Екран N» у кутку
// Зона = ділянка екрана, яку ШІ аналізує. Рамка зелена (аналізує) / червона (піхота або дрон).
const MAXZ = 10, BORDER = 3, TAB = 24;
let strip = null, overlays = [];
function createStrip() {
  const d = screen.getPrimaryDisplay().workArea, W = 330, H = 58;
  strip = new BrowserWindow({
    width: W, height: H, x: d.x + d.width - W - 12, y: d.y + d.height - H - 12,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  strip.setAlwaysOnTop(true, 'floating');
  strip.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  strip.setContentProtection(true);
  strip.loadFile(path.join(__dirname, 'strip.html'), { query: { lang } });
  strip.once('ready-to-show', () => { strip.showInactive(); sendStrip(); });
  strip.on('closed', () => { strip = null; });
}
function sendStrip() {
  if (!strip || strip.isDestroyed()) return;
  strip.webContents.send('zones', [...targets.values()].filter(t => !t.win.isDestroyed()).map(t => ({ id: t.id, n: t.n, alert: t.alert || 0, inf: t.st ? t.st.inf : 0, air: t.st ? t.st.air : 0 })), MAXZ);
}
// виділення: напівпрозорий шар на кожному моніторі; тягнете прямокутник — відпустили — зона готова
function startSelect() {
  cancelSelect();
  if (targets.size >= MAXZ) { new Notification({ title: 'ОКО-ШІ', body: T(`Максимум ${MAXZ} зон`, `Maximum ${MAXZ} zones`) }).show(); return; }
  for (const d of screen.getAllDisplays()) {
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true, show: false, focusable: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setContentProtection(true);
    w.loadFile(path.join(__dirname, 'select.html'), { query: { lang, n: String(nextN), ox: String(d.bounds.x), oy: String(d.bounds.y) } });
    w.once('ready-to-show', () => { w.show(); w.focus(); });
    overlays.push(w);
  }
  try { globalShortcut.register('Escape', cancelSelect); } catch (e) {}
}
function cancelSelect() {
  overlays.forEach(w => { if (!w.isDestroyed()) w.close(); }); overlays = [];
  try { globalShortcut.unregister('Escape'); } catch (e) {}
}
function createTarget(region) {
  const r = { x: Math.round(region.x), y: Math.round(region.y), width: Math.max(80, Math.round(region.width)), height: Math.max(60, Math.round(region.height)) };
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), n = nextN++;
  const win = new BrowserWindow({
    x: r.x - BORDER, y: r.y - TAB, width: r.width + 2 * BORDER, height: r.height + TAB + BORDER,
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true, show: false,
    enableLargerThanScreen: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);         // рамка не потрапляє в аналіз
  if (process.platform !== 'linux') win.setIgnoreMouseEvents(true, { forward: true }); // кліки проходять крізь зону до пульта
  win.loadFile(path.join(__dirname, 'frame.html'), { query: { id, n: String(n), lang } });
  win.once('ready-to-show', () => win.showInactive());
  const d = screen.getDisplayMatching(r);
  const t = { id, n, win, displayId: d.id };
  targets.set(id, t);
  const upd = () => { if (!win.isDestroyed()) { t.displayId = screen.getDisplayMatching(win.getBounds()).id; sendTargets(); } };
  win.on('moved', upd); win.on('resized', upd); win.on('move', () => { clearTimeout(win._u); win._u = setTimeout(upd, 150); });
  win.on('closed', () => { targets.delete(id); sendTargets(); updBadge(); });
  sendTargets();
  return t;
}
function targetList() {
  return [...targets.values()].filter(t => !t.win.isDestroyed()).map(t => {
    const b = t.win.getContentBounds(), d = screen.getAllDisplays().find(x => x.id === t.displayId) || screen.getDisplayMatching(b);
    return { id: t.id, n: t.n, displayId: d.id, display: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor },
      rect: { x: b.x + BORDER, y: b.y + TAB, width: b.width - 2 * BORDER, height: b.height - TAB - BORDER } };
  });
}
function sendTargets() {
  if (main && !main.isDestroyed()) { main.webContents.send('targets', targetList()); main.setContentProtection(targets.size > 0); } // поки є зони, вікно ОКО-ШІ не потрапляє в аналіз
  sendStrip(); updTray();
}
function addAim() { startSelect(); }

// ------------------------------------------------------------ тривоги
const lastNote = new Map();
function onStatus(id, st) {
  const t = targets.get(id); if (!t || t.win.isDestroyed()) return;
  t.win.webContents.send('status', st);
  t.alert = st.inf + st.air; t.st = st;
  updBadge(); sendStrip();
  if (st.fresh && (st.fresh.inf || st.fresh.air) && Notification.isSupported()) {
    const k = Date.now(); if (k - (lastNote.get(id) || 0) > 12000) {
      lastNote.set(id, k);
      const parts = []; if (st.inf) parts.push(T(`піхота: ${st.inf}`, `infantry: ${st.inf}`)); if (st.air) parts.push(T(`дрони: ${st.air}`, `drones: ${st.air}`));
      const nt = new Notification({ title: T(`ОКО-ШІ · Екран ${t.n}`, `OKO-AI · Screen ${t.n}`), body: parts.join(', '), silent: false });
      nt.on('click', () => showMain(id)); nt.show();
    }
  }
}
function updBadge() {
  const n = [...targets.values()].reduce((s, t) => s + (t.alert || 0), 0);
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(n ? String(n) : '');
  if (main && process.platform === 'win32') main.flashFrame(n > 0 && !main.isFocused());
  if (tray) tray.setToolTip(n ? T(`ОКО-ШІ — виявлено цілей: ${n}`, `OKO-AI — targets: ${n}`) : 'ОКО-ШІ');
}
function showMain(focusId) {
  if (!main) createMain();
  if (main.isMinimized()) main.restore();
  main.show(); main.focus();
  if (focusId) main.webContents.send('focus-target', focusId);
}

// ------------------------------------------------------------ трей / Dock
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: T('Відкрити ОКО-ШІ', 'Open OKO-AI'), click: () => showMain() },
    { label: T('Виділити зону', 'Select zone'), accelerator: 'CmdOrCtrl+Shift+A', click: () => startSelect() },
    { label: T('Смужка зон у кутку', 'Zone strip'), type: 'checkbox', checked: !!(strip && strip.isVisible()), click: () => { if (strip && strip.isVisible()) strip.hide(); else if (strip) strip.showInactive(); else createStrip(); updTray(); } },
    { label: T(`Прибрати всі зони (${targets.size})`, `Remove all zones (${targets.size})`), enabled: targets.size > 0, click: () => [...targets.values()].forEach(t => t.win.close()) },
    { type: 'separator' },
    { label: T('Вийти', 'Quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function updTray() {
  if (tray) tray.setContextMenu(trayMenu());
  if (process.platform === 'darwin' && app.dock) app.dock.setMenu(Menu.buildFromTemplate([
    { label: T('Виділити зону', 'Select zone'), click: () => startSelect() },
    { label: T('Прибрати всі зони', 'Remove all zones'), enabled: targets.size > 0, click: () => [...targets.values()].forEach(t => t.win.close()) },
  ]));
}
function createTray() {
  let img = nativeImage.createFromPath(iconPath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('ОКО-ШІ');
  tray.on('click', () => { if (process.platform === 'win32') showMain(); });
  updTray();
}

// ------------------------------------------------------------ IPC
ipcMain.handle('add-aim', () => { if (main && !main.isDestroyed()) main.minimize(); setTimeout(() => startSelect(), 300); return true; });
ipcMain.on('select-zone', () => { if (main && !main.isDestroyed() && !main.isMinimized()) main.minimize(); setTimeout(() => startSelect(), 250); });
ipcMain.on('select-done', (e, r) => { cancelSelect(); if (r && r.width > 30 && r.height > 30) createTarget(r); });
ipcMain.on('select-cancel', () => cancelSelect());
ipcMain.on('strip-remove', (e, id) => { const t = targets.get(id); if (t) t.win.close(); });
ipcMain.on('strip-focus', (e, id) => showMain(id));
ipcMain.on('strip-size', (e, w) => { if (!strip || strip.isDestroyed()) return; const b = strip.getBounds(), nw = Math.max(200, Math.min(1400, Math.round(w))); strip.setBounds({ x: b.x + b.width - nw, y: b.y, width: nw, height: b.height }); });
ipcMain.on('open-main', () => showMain());
ipcMain.handle('cursor', () => screen.getCursorScreenPoint());
ipcMain.handle('targets', () => targetList());
ipcMain.handle('sources', async () => {
  const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return s.map(x => ({ id: x.id, displayId: String(x.display_id || ''), name: x.name }));
});
ipcMain.handle('screen-access', () => {
  if (process.platform !== 'darwin') return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
});
ipcMain.handle('open-screen-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
// камера: на Mac — системний запит дозволу; якщо заборонено — відкриваємо потрібний розділ налаштувань
// Камера на Mac: якщо macOS «пам'ятає» стару відмову (часто після оновлення програми) — скидаємо її
// і одразу показуємо системне вікно «Дозволити». Без походу в налаштування.
async function askCamera(force) {
  if (process.platform === 'win32') return systemPreferences.getMediaAccessStatus('camera');
  if (process.platform !== 'darwin') return 'granted';
  let st = systemPreferences.getMediaAccessStatus('camera');
  if (st === 'granted') return st;
  if (st !== 'not-determined' || force) { await tccReset('Camera'); }
  const ok = await systemPreferences.askForMediaAccess('camera');
  return ok ? 'granted' : systemPreferences.getMediaAccessStatus('camera');
}
ipcMain.handle('camera-access', () => askCamera(false));
ipcMain.handle('camera-allow', () => askCamera(true));
ipcMain.handle('camera-status', () => (process.platform === 'linux' ? 'granted' : systemPreferences.getMediaAccessStatus('camera')));
// Запис екрана (приціл): скинути стару відмову, викликати системне вікно, після «Дозволити» — перезапуск сам
let screenWatch = null;
ipcMain.handle('screen-allow', async () => {
  if (process.platform !== 'darwin') return 'granted';
  if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return 'granted'; // вже дозволено — нічого не чіпаємо
  await tccReset('ScreenCapture');
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch (e) {}
  clearInterval(screenWatch); let n = 0;
  screenWatch = setInterval(() => {
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') { clearInterval(screenWatch); app.relaunch(); app.isQuitting = true; app.exit(0); }
    if (++n > 180) clearInterval(screenWatch);
  }, 1000);
  // одразу відкриваємо потрібний розділ налаштувань, щоб не шукати
  setTimeout(() => { if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); }, 1500);
  return systemPreferences.getMediaAccessStatus('screen');
});
ipcMain.handle('open-camera-settings', () => shell.openExternal(process.platform === 'darwin' ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera' : 'ms-settings:privacy-webcam'));
ipcMain.handle('relaunch', () => { app.relaunch(); app.isQuitting = true; app.exit(0); });
ipcMain.handle('remove-target', (e, id) => { const t = targets.get(id); if (t) t.win.close(); });
ipcMain.handle('save', async (e, name, buf) => {
  const dir = path.join(app.getPath('downloads'), 'OKO-AI');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name.replace(/[\\/:*?"<>|]/g, '_'));
  fs.writeFileSync(p, Buffer.from(buf));
  return p;
});
ipcMain.handle('reveal', (e, p) => shell.showItemInFolder(p));
ipcMain.on('status', (e, id, st) => onStatus(id, st));
ipcMain.on('lang', (e, l) => { lang = l === 'en' ? 'en' : 'uk'; updTray(); if (strip && !strip.isDestroyed()) strip.webContents.send('lang', lang); overlays.forEach(w => !w.isDestroyed() && w.webContents.send('lang', lang)); for (const t of targets.values()) if (!t.win.isDestroyed()) t.win.webContents.send('lang', lang); });
// вікна рамки: керування мишею (кліки крізь рамку, крім заголовка й кута)
ipcMain.on('frame-mouse', (e, solid) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && process.platform !== 'linux') w.setIgnoreMouseEvents(!solid, { forward: true }); });
ipcMain.on('frame-resize', (e, dw, dh, start) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (start) { w._rs = w.getBounds(); return; }
  const b = w._rs || w.getBounds();
  w.setBounds({ x: b.x, y: b.y, width: Math.max(160, Math.round(b.width + dw)), height: Math.max(120, Math.round(b.height + dh)) });
});
ipcMain.on('frame-resize-end', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) { w._rs = null; sendTargets(); } });
ipcMain.on('frame-close', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
ipcMain.on('frame-focus', (e, id) => showMain(id));
// для автотесту
ipcMain.handle('test-create-target', (e, r) => createTarget(r).id);
ipcMain.handle('test-overlays', () => overlays.filter(w => !w.isDestroyed()).length);
ipcMain.handle('test-windows', () => BrowserWindow.getAllWindows().map(w => ({ id: w.id, title: w.getTitle(), bounds: w.getContentBounds(), url: w.webContents.getURL() })));

// ------------------------------------------------------------ запуск
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showMain());
app.whenReady().then(() => {
  protocol.handle('oko', async req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname); if (p === '/' || !p) p = '/index.html';
    const file = path.join(WEB, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(WEB)) return new Response('no', { status: 403 });
    const r = await net.fetch(pathToFileURL(file).toString());
    const h = new Headers(r.headers);
    h.set('Cross-Origin-Opener-Policy', 'same-origin'); h.set('Cross-Origin-Embedder-Policy', 'require-corp'); h.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (file.endsWith('.wasm')) h.set('Content-Type', 'application/wasm');
    if (file.endsWith('.mjs') || file.endsWith('.js')) h.set('Content-Type', 'text/javascript');
    return new Response(r.body, { status: r.status, headers: h });
  });
  // камера / екран у головному вікні дозволені
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(['media', 'display-capture', 'notifications', 'fullscreen'].includes(perm)));
  session.defaultSession.setDisplayMediaRequestHandler(async (req, cb) => {
    const s = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    cb({ video: s[0] });
  });
  createMain();
  createTray();
  createStrip();
  globalShortcut.register('CmdOrCtrl+Shift+A', () => startSelect());
  app.on('activate', () => showMain());
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

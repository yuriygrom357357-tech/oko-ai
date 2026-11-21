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

// ------------------------------------------------------------ панелька прицілу і розміщення
// Панелька (завжди внизу екрана): червоний приціл + «ОКО-ШІ». Приціл не рухається сам —
// за курсором їде його копія; рамка ставиться лише коли кнопку миші ВІДПУЩЕНО (або наступним клацанням).
let pill = null, ghost = null, place = null; // place = { mode: 'drag'|'click', start, timer }
function createPill() {
  const d = screen.getPrimaryDisplay().workArea, W = 214, H = 64;
  pill = new BrowserWindow({
    width: W, height: H, x: Math.round(d.x + d.width / 2 - W / 2), y: Math.round(d.y + d.height - H - 14),
    frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  pill.setAlwaysOnTop(true, 'floating');
  pill.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  pill.setContentProtection(true);
  pill.loadFile(path.join(__dirname, 'pill.html'), { query: { lang } });
  pill.once('ready-to-show', () => pill.showInactive());
  pill.on('closed', () => { pill = null; });
}
function ghostAt(p) { if (ghost && !ghost.isDestroyed()) ghost.setPosition(Math.round(p.x - 110), Math.round(p.y - 38)); }
function startPlace(mode) {
  cancelPlace();
  const p = screen.getCursorScreenPoint();
  ghost = new BrowserWindow({
    width: 220, height: 102, x: Math.round(p.x - 110), y: Math.round(p.y - 38), frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  ghost.setAlwaysOnTop(true, 'screen-saver');
  ghost.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ghost.setContentProtection(true);
  ghost.loadFile(path.join(__dirname, 'aim.html'), { query: { lang, mode } });
  ghost.once('ready-to-show', () => ghost && ghost.showInactive());
  place = { mode, start: p, timer: setInterval(() => ghostAt(screen.getCursorScreenPoint()), 16) };
  try { globalShortcut.register('Escape', cancelPlace); } catch (e) {}
}
function setPlaceMode(mode) { if (!place) return; place.mode = mode; if (ghost && !ghost.isDestroyed()) ghost.webContents.send('aim-mode', mode); }
function cancelPlace() {
  if (place) { clearInterval(place.timer); place = null; }
  if (ghost && !ghost.isDestroyed()) ghost.close();
  ghost = null;
  try { globalShortcut.unregister('Escape'); } catch (e) {}
}
function dropPlace() {
  if (!place) return;
  const p = screen.getCursorScreenPoint();
  cancelPlace();
  createTarget({ x: p.x, y: p.y });
}
function addAim() { startPlace('click'); } // з меню / кнопки програми: приціл «прилипає» до курсора, клацніть — і він стає
function createTarget(c, rect) {
  const d = screen.getDisplayNearestPoint(c), wa = d.workArea;
  const W = rect ? rect.width : Math.min(720, wa.width - 40), H = rect ? rect.height : Math.min(440, wa.height - 40);
  const x = rect ? rect.x : Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - W, c.x - W / 2)));
  const y = rect ? rect.y : Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - H, c.y - H / 2)));
  const id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), n = nextN++;
  const win = new BrowserWindow({
    x, y, width: W, height: H, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    hasShadow: false, focusable: true, show: false, minWidth: 160, minHeight: 120,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);         // рамка не потрапляє в аналіз
  if (process.platform !== 'linux') win.setIgnoreMouseEvents(true, { forward: true }); // кліки проходять крізь рамку до пульта
  win.loadFile(path.join(__dirname, 'frame.html'), { query: { id, n: String(n), lang } });
  win.once('ready-to-show', () => win.showInactive());
  const t = { id, n, win, displayId: d.id };
  targets.set(id, t);
  const upd = () => { if (!win.isDestroyed()) { const nd = screen.getDisplayMatching(win.getBounds()); t.displayId = nd.id; sendTargets(); } };
  win.on('moved', upd); win.on('resized', upd); win.on('move', () => { clearTimeout(win._u); win._u = setTimeout(upd, 150); });
  win.on('closed', () => { targets.delete(id); sendTargets(); updBadge(); });
  sendTargets();
  if (main && main.isMinimized && !TEST) { /* лишаємо як є */ }
  return t;
}
function targetList() {
  return [...targets.values()].filter(t => !t.win.isDestroyed()).map(t => {
    const b = t.win.getContentBounds(), d = screen.getAllDisplays().find(x => x.id === t.displayId) || screen.getDisplayMatching(b);
    // внутрішня частина рамки (без смуги заголовка 26 px і рамки 3 px)
    return { id: t.id, n: t.n, displayId: d.id, display: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scale: d.scaleFactor },
      rect: { x: b.x + 3, y: b.y + 29, width: b.width - 6, height: b.height - 32 } };
  });
}
function sendTargets() {
  if (main && !main.isDestroyed()) { main.webContents.send('targets', targetList()); main.setContentProtection(targets.size > 0); } // поки є прицілі, вікно ОКО-ШІ не потрапляє в аналіз
  updTray();
}

// ------------------------------------------------------------ тривоги
const lastNote = new Map();
function onStatus(id, st) {
  const t = targets.get(id); if (!t || t.win.isDestroyed()) return;
  t.win.webContents.send('status', st);
  t.alert = st.inf + st.air;
  updBadge();
  if (st.fresh && (st.fresh.inf || st.fresh.air) && Notification.isSupported()) {
    const k = Date.now(); if (k - (lastNote.get(id) || 0) > 12000) {
      lastNote.set(id, k);
      const parts = []; if (st.inf) parts.push(T(`піхота: ${st.inf}`, `infantry: ${st.inf}`)); if (st.air) parts.push(T(`дрони: ${st.air}`, `drones: ${st.air}`));
      const nt = new Notification({ title: T(`ОКО-ШІ · Приціл ${t.n}`, `OKO-AI · Crosshair ${t.n}`), body: parts.join(', '), silent: false });
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
    { label: T('Додати приціл', 'Add crosshair'), accelerator: 'CmdOrCtrl+Shift+A', click: () => addAim() },
    { label: T('Панелька прицілу', 'Crosshair panel'), type: 'checkbox', checked: !!(pill && pill.isVisible()), click: () => { if (pill && pill.isVisible()) pill.hide(); else if (pill) pill.showInactive(); else createPill(); updTray(); } },
    { label: T(`Прибрати прицілі (${targets.size})`, `Remove crosshairs (${targets.size})`), enabled: targets.size > 0, click: () => [...targets.values()].forEach(t => t.win.close()) },
    { type: 'separator' },
    { label: T('Вийти', 'Quit'), click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function updTray() {
  if (tray) tray.setContextMenu(trayMenu());
  if (process.platform === 'darwin' && app.dock) app.dock.setMenu(Menu.buildFromTemplate([
    { label: T('Додати приціл', 'Add crosshair'), click: () => addAim() },
    { label: T('Прибрати прицілі', 'Remove crosshairs'), enabled: targets.size > 0, click: () => [...targets.values()].forEach(t => t.win.close()) },
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
ipcMain.handle('add-aim', () => { if (main && !main.isDestroyed()) main.minimize(); setTimeout(() => addAim(), 250); return true; });
ipcMain.on('pill-drag-start', () => startPlace('drag'));
ipcMain.on('pill-drag-end', () => {
  if (!place) return;
  const p = screen.getCursorScreenPoint();
  if (Math.hypot(p.x - place.start.x, p.y - place.start.y) < 10) setPlaceMode('click'); // просто клацнули — тепер клацніть, де поставити
  else dropPlace();
});
ipcMain.on('ghost-click', () => dropPlace());
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
  if (process.platform !== 'darwin') return 'granted';
  let st = systemPreferences.getMediaAccessStatus('camera');
  if (st === 'granted') return st;
  if (st !== 'not-determined' || force) { await tccReset('Camera'); }
  const ok = await systemPreferences.askForMediaAccess('camera');
  return ok ? 'granted' : systemPreferences.getMediaAccessStatus('camera');
}
ipcMain.handle('camera-access', () => askCamera(false));
ipcMain.handle('camera-allow', () => askCamera(true));
// Запис екрана (приціл): скинути стару відмову, викликати системне вікно, після «Дозволити» — перезапуск сам
let screenWatch = null;
ipcMain.handle('screen-allow', async () => {
  if (process.platform !== 'darwin') return 'granted';
  await tccReset('ScreenCapture');
  try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch (e) {}
  clearInterval(screenWatch); let n = 0;
  screenWatch = setInterval(() => {
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') { clearInterval(screenWatch); app.relaunch(); app.isQuitting = true; app.exit(0); }
    if (++n > 180) clearInterval(screenWatch);
  }, 1000);
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
ipcMain.on('lang', (e, l) => { lang = l === 'en' ? 'en' : 'uk'; updTray(); if (pill && !pill.isDestroyed()) pill.webContents.send('lang', lang); for (const t of targets.values()) if (!t.win.isDestroyed()) t.win.webContents.send('lang', lang); });
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
ipcMain.handle('test-create-target', (e, r) => { const t = createTarget({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, r); return t.id; });
ipcMain.handle('test-place-state', () => (place ? place.mode : null));
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
  createPill();
  globalShortcut.register('CmdOrCtrl+Shift+A', () => addAim());
  app.on('activate', () => showMain());
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

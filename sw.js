// ОКО-ШІ service worker: офлайн-режим + ізоляція (багатопотоковий ШІ).
// Код і сторінка — спершу з мережі (щоб оновлення приходили одразу), без мережі — з кешу.
// Важкі файли (модель, wasm, демо-відео) — з кешу.
const C='oko-v6';
const CORE=['./','index.html','app.css','app.js','worker.js','stats.js','manifest.webmanifest','icons/icon-192.png','icons/icon-180.png','vendor/ort.all.min.js','vendor/ort-wasm-simd-threaded.jsep.mjs','vendor/ort-wasm-simd-threaded.jsep.wasm','models/yolo11n.onnx'];
const HEAVY=/\.(onnx|wasm|mp4|png)$/;
const iso=r=>{if(!r||r.status===0||r.type==='opaque')return r;const h=new Headers(r.headers);h.set('Cross-Origin-Embedder-Policy','require-corp');h.set('Cross-Origin-Opener-Policy','same-origin');h.set('Cross-Origin-Resource-Policy','same-origin');return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h})};
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url); if(u.origin!==location.origin)return;
  const put=res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(e.request,cp))}return res};
  const p=HEAVY.test(u.pathname)
    ? caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(put))
    : fetch(e.request).then(put).catch(()=>caches.match(e.request,{ignoreSearch:true}));
  e.respondWith(p.then(iso));
});

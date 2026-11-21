/* Фоновий потік ШІ: модель працює тут, щоб інтерфейс не гальмував. */
let session = null, chain = Promise.resolve(); // запуски моделі строго по черзі
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      importScripts(m.base + 'vendor/ort.all.min.js');
      ort.env.wasm.wasmPaths = m.base + 'vendor/';
      ort.env.wasm.numThreads = m.threads;
      ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(m.base + 'models/yolo11n.onnx', { executionProviders: [m.ep], graphOptimizationLevel: 'all' });
      self.postMessage({ type: 'ready', input: session.inputNames[0] });
    } else if (m.type === 'run') {
      const job = chain.then(() => session.run({ [session.inputNames[0]]: new ort.Tensor('float32', m.data, [1, 3, m.size, m.size]) }));
      chain = job.catch(() => {});
      const out = await job;
      const o = out[session.outputNames[0]];
      const data = new Float32Array(o.data);
      self.postMessage({ type: 'out', id: m.id, data, dims: o.dims }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, msg: String(err && err.message || err) });
  }
};

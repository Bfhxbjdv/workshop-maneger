(() => {
  'use strict';

  const maxSide = 1600;
  const quality = 0.82;
  const pending = new WeakMap();
  const generation = new WeakMap();
  const replayedChanges = new WeakSet();
  const statusNodes = new WeakMap();
  const rasterTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/avif']);

  function setStatus(input, message, state = 'info') {
    let node = statusNodes.get(input);
    if (!node) {
      node = document.createElement('div');
      node.className = 'image-optimization-status small mt-1';
      node.setAttribute('aria-live', 'polite');
      input.insertAdjacentElement('afterend', node);
      statusNodes.set(input, node);
    }
    node.textContent = message;
    node.dataset.state = state;
  }

  function announceChange(input) {
    replayedChanges.add(input);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function encodeWebp(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
  }

  async function compressFile(file) {
    if (!rasterTypes.has(file.type) || typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, maxSide / bitmap.width, maxSide / bitmap.height);
      if (scale === 1 && file.size < 320 * 1024) return file;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) return file;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const blob = await encodeWebp(canvas);
      canvas.width = 0;
      canvas.height = 0;
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;

      const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
      return new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: file.lastModified });
    } catch {
      return file;
    } finally {
      bitmap?.close?.();
    }
  }

  async function processSelection(input, files, currentGeneration) {
    setStatus(input, 'جارٍ تحسين الصور تلقائيًا قبل الرفع…');
    const before = files.reduce((total, file) => total + file.size, 0);
    let after = 0;
    let converted = 0;
    const output = new Array(files.length);
    let nextIndex = 0;
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
      while (nextIndex < files.length) {
        const index = nextIndex++;
        const original = files[index];
        const optimized = await compressFile(original);
        output[index] = optimized;
        after += optimized.size;
        if (optimized !== original) converted++;
      }
    }));

    if (generation.get(input) !== currentGeneration) return;

    try {
      const transfer = new DataTransfer();
      output.forEach(file => transfer.items.add(file));
      input.files = transfer.files;
    } catch {
      setStatus(input, 'تعذر تحسين الصور في هذا المتصفح؛ ستُرفع الملفات الأصلية.', 'warning');
      announceChange(input);
      return;
    }

    if (converted) {
      const percent = before ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
      const saved = Math.max(0, (before - after) / (1024 * 1024));
      setStatus(input, `تم تجهيز ${converted} صورة أخف؛ توفير ${percent}% (نحو ${saved.toFixed(1)} ميغابايت).`, 'success');
    } else {
      setStatus(input, 'الصور مناسبة للرفع، ولم تتطلب ضغطًا إضافيًا.', 'success');
    }
    announceChange(input);
  }

  document.addEventListener('change', event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    if (replayedChanges.has(input)) {
      replayedChanges.delete(input);
      return;
    }

    const files = Array.from(input.files || []);
    if (!files.some(file => rasterTypes.has(file.type)) || typeof DataTransfer !== 'function') return;

    event.stopImmediatePropagation();
    const currentGeneration = (generation.get(input) || 0) + 1;
    generation.set(input, currentGeneration);
    const job = processSelection(input, files, currentGeneration).catch(() => {
      if (generation.get(input) === currentGeneration) {
        setStatus(input, 'تعذر ضغط بعض الصور؛ ستُستخدم الملفات الأصلية.', 'warning');
        announceChange(input);
      }
    }).finally(() => {
      if (pending.get(input) === job) pending.delete(input);
    });
    pending.set(input, job);
  }, true);

  function waitForPendingUploads(event, retry) {
    if (window.__kazanjiImageCompressionRetry) {
      window.__kazanjiImageCompressionRetry = false;
      return;
    }
    const jobs = Array.from(document.querySelectorAll('input[type="file"]'))
      .map(input => pending.get(input)).filter(Boolean);
    if (!jobs.length) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.allSettled(jobs).then(() => {
      window.__kazanjiImageCompressionRetry = true;
      retry();
    });
  }

  document.addEventListener('click', event => {
    const target = event.target.closest?.('button, input[type="submit"], a');
    if (!target) return;
    waitForPendingUploads(event, () => target.click());
  }, true);

  document.addEventListener('submit', event => {
    waitForPendingUploads(event, () => event.target.requestSubmit(event.submitter));
  }, true);
})();

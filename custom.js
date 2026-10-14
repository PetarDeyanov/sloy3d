// Персонализирани: литофания от снимка и надписи (име, табела, медальон, име за бюро).
// Преглед на живо в canvas, цена по формулата от products.js и поръчка като в калкулатора.
(() => {
  const S = window.SLOY_SHOP;
  const { materials, custom: C } = window.SLOY_CATALOG;
  const { esc, fmt, clampQty, t } = S;
  const L = C.litho;
  const X = C.text;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ALL = Object.keys(materials);
  const errBox = $('#custom-error');
  const showError = msg => { errBox.textContent = msg; errBox.hidden = !msg; };
  const roundPrice = n => Math.max(0.5, Math.round(n * 2) / 2);   // като в каталога — до 0,50 €
  const num = n => (S.lang === 'en' ? String(n) : String(n).replace('.', ','));
  const chipsHTML = (list, selected, name, label = x => t(x.label)) => list.map(x => `
    <label class="chip"><input type="radio" name="${name}" value="${x.id}"${x.id === selected ? ' checked' : ''}><span>${label(x)}</span></label>`).join('');
  // canvas с размера на кутията (и резкост за retina)
  const fitCanvas = (cv, box) => {
    const r = box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h, dpr };
  };

  // ---------- Табове ----------
  const tools = { litho: $('#tool-litho'), text: $('#tool-text') };
  const showTool = id => {
    Object.entries(tools).forEach(([k, el]) => { el.hidden = k !== id; });
    $$('.tool-tabs [role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tool === id)));
    showError('');
    if (id === 'text') drawText(); else drawLitho();
  };
  $$('.tool-tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
    showTool(b.dataset.tool);
    history.replaceState(null, '', b.dataset.tool === 'text' ? '#nadpis' : '#litofania');
  }));

  // ---------- Брой (общо за двата инструмента) ----------
  $$('[data-step]').forEach(b => b.addEventListener('click', () => {
    const input = $('#' + b.dataset.for);
    input.value = clampQty(+input.value + +b.dataset.step);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }));

  // =====================================================================
  // ЛИТОФАНИЯ
  // =====================================================================
  const lf = { img: null, file: null, sample: false, shape: L.shapes[0].id, format: 'land', size: 'M', light: true, pan: { x: 0.5, y: 0.5 }, qty: 1 };
  let thick = null;      // дебелина за всяка точка (мм), gw × gh
  let gw = 0, gh = 0, meanThick = 0;
  const face = document.createElement('canvas');   // „лицето“ на литофанията — после се огъва според формата
  const litCv = $('#litho-canvas');
  const litBox = $('#litho-box');
  const shapeOf = () => L.shapes.find(x => x.id === lf.shape);
  const formatOf = () => L.formats.find(x => x.id === lf.format);
  const dimsOf = () => {
    const long = L.sizes.find(x => x.id === lf.size).long;
    const r = formatOf().ratio;
    return r >= 1 ? [long, Math.round(long / r)] : [Math.round(long * r), long];
  };

  // снимката → изрязване по кадъра → сиво → дебелина
  const process = () => {
    if (!lf.img) return;
    const r = formatOf().ratio;
    const iw = lf.img.width, ih = lf.img.height;
    let cw = iw, ch = ih;
    if (iw / ih > r) cw = ih * r; else ch = iw / r;
    const sx = (iw - cw) * lf.pan.x, sy = (ih - ch) * lf.pan.y;
    gw = r >= 1 ? 420 : Math.round(420 * r);
    gh = Math.round(gw / r);
    face.width = gw; face.height = gh;
    const fx = face.getContext('2d', { willReadFrequently: true });
    fx.drawImage(lf.img, sx, sy, cw, ch, 0, 0, gw, gh);
    const px = fx.getImageData(0, 0, gw, gh).data;
    const lum = new Float32Array(gw * gh);
    const hist = new Uint32Array(256);
    for (let i = 0; i < lum.length; i++) {
      const v = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      lum[i] = v;
      hist[v | 0]++;
    }
    // автоматичен контраст: 2% от най-тъмните и най-светлите точки отиват в краищата
    const cut = lum.length * 0.02;
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255 && (acc += hist[lo]) < cut; lo++);
    acc = 0;
    for (; hi > 0 && (acc += hist[hi]) < cut; hi--);
    const span = Math.max(1, hi - lo);
    const frame = Math.round(L.frame / dimsOf()[0] * gw);
    thick = new Float32Array(gw * gh);
    let sum = 0, inner = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (x < frame || y < frame || x >= gw - frame || y >= gh - frame) { thick[i] = L.maxThick + 0.4; continue; }
        const l = Math.min(1, Math.max(0, (lum[i] - lo) / span));
        thick[i] = L.minThick + (L.maxThick - L.minThick) * (1 - l);
        sum += thick[i];
        inner++;
      }
    }
    meanThick = inner ? sum / inner : (L.minThick + L.maxThick) / 2;
    paintFace();
  };

  // светлина вкл.: топла светлина отзад; изкл.: бяла пластмаса с релеф
  const paintFace = () => {
    const fx = face.getContext('2d');
    const out = fx.createImageData(gw, gh);
    const d = out.data;
    const a = 1.15;   // колко светлина спира 1 мм бял PLA (приблизително)
    const tMax = Math.exp(-a * L.minThick), tMin = Math.exp(-a * (L.maxThick + 0.4));
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const th = thick[i];
        let r, g, b;
        if (lf.light) {
          const k = (Math.exp(-a * th) - tMin) / (tMax - tMin);
          r = 22 + 233 * k ** 0.85; g = 14 + 206 * k ** 1.05; b = 8 + 150 * k ** 1.4;
        } else {
          const prev = thick[Math.max(0, y - 1) * gw + Math.max(0, x - 1)];
          const v = 246 - 14 * (th - L.minThick) / (L.maxThick - L.minThick) + (prev - th) * 34;
          r = v; g = v - 1; b = v - 5;
        }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
    }
    fx.putImageData(out, 0, 0);
  };

  let litRect = null;    // къде е снимката в canvas — за влаченето
  const drawLitho = () => {
    if (!lf.img || tools.litho.hidden) return;
    const { w, h, dpr } = fitCanvas(litCv, litBox);
    const c = litCv.getContext('2d');
    c.clearRect(0, 0, w, h);
    if (lf.light) {
      const bg = c.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h / 2, Math.max(w, h) * 0.75);
      bg.addColorStop(0, '#2b2433'); bg.addColorStop(1, '#0e0c12');
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
    }
    const shape = lf.shape;
    const lamp = shape === 'lamp';
    const ratio = gw / gh;
    const availW = w * 0.8, availH = h * (lamp ? 0.62 : 0.74);
    let fw = availW, fh = fw / ratio;
    if (fh > availH) { fh = availH; fw = fh * ratio; }
    const cx = w / 2;
    const top = (h - fh) / 2 - (lamp ? h * 0.08 : h * 0.02);
    c.imageSmoothingQuality = 'high';

    if (lf.light) {   // ореол около осветената литофания
      const glow = c.createRadialGradient(cx, top + fh / 2, fh * 0.2, cx, top + fh / 2, Math.max(fw, fh) * 0.85);
      glow.addColorStop(0, 'rgba(255, 190, 110, .28)'); glow.addColorStop(1, 'rgba(255, 190, 110, 0)');
      c.fillStyle = glow; c.fillRect(0, 0, w, h);
    }

    if (shape === 'flat') {
      // стойка
      c.fillStyle = lf.light ? '#3a3340' : '#e9e6df';
      c.strokeStyle = 'rgba(23, 21, 31, .35)'; c.lineWidth = 1.5 * dpr;
      const sw = fw * 0.55, sh = Math.max(6 * dpr, fh * 0.05);
      c.beginPath(); c.roundRect(cx - sw / 2, top + fh - 2 * dpr, sw, sh, 3 * dpr); c.fill(); c.stroke();
      c.save();
      c.shadowColor = 'rgba(0, 0, 0, .28)'; c.shadowBlur = 18 * dpr; c.shadowOffsetY = 6 * dpr;
      c.drawImage(face, cx - fw / 2, top, fw, fh);
      c.restore();
      c.strokeRect(cx - fw / 2, top, fw, fh);
      litRect = { x: cx - fw / 2, y: top, w: fw, h: fh };
    } else {
      // извита: тънки вертикални ивици по дъга от 110°
      const theta = 110 * Math.PI / 180;
      const R = fw / 2 / Math.sin(theta / 2);
      const N = Math.min(240, gw);
      const sag = fh * 0.07;
      for (let i = 0; i < N; i++) {
        const p0 = -theta / 2 + theta * i / N, p1 = p0 + theta / N;
        const x0 = cx + R * Math.sin(p0), x1 = cx + R * Math.sin(p1);
        const pm = (p0 + p1) / 2;
        const lift = sag * (1 - Math.cos(pm)) / (1 - Math.cos(theta / 2));
        const shrink = 1 - 0.06 * (1 - Math.cos(pm));
        const sh = fh * shrink;
        const y = top + (fh - sh) / 2 - lift;
        c.drawImage(face, gw * i / N, 0, gw / N + 0.5, gh, x0, y, x1 - x0 + 0.6, sh);
        const shade = (1 - Math.cos(pm)) * (lf.light ? 0.55 : 0.32);
        if (shade > 0.01) { c.fillStyle = `rgba(20, 14, 10, ${shade})`; c.fillRect(x0, y, x1 - x0 + 0.6, sh); }
      }
      if (lamp) {
        // LED основа
        const bw = fw * 1.08, bh = Math.max(18 * dpr, fh * 0.17), by = top + fh * 0.97;
        const grd = c.createLinearGradient(0, by, 0, by + bh);
        grd.addColorStop(0, '#3b3742'); grd.addColorStop(1, '#17151f');
        c.fillStyle = grd;
        c.beginPath(); c.roundRect(cx - bw / 2, by, bw, bh, 10 * dpr); c.fill();
        c.fillStyle = lf.light ? '#ffcf86' : '#6c6775';
        c.beginPath(); c.arc(cx + bw / 2 - 18 * dpr, by + bh / 2, 3.5 * dpr, 0, Math.PI * 2); c.fill();
      }
      litRect = { x: cx - fw / 2, y: top - sag, w: fw, h: fh + sag };
    }
  };

  const renderLithoPanel = () => {
    $('#lf-shape').innerHTML = chipsHTML(L.shapes, lf.shape, 'lf-shape');
    $('#lf-format').innerHTML = chipsHTML(L.formats, lf.format, 'lf-format');
    $('#lf-size').innerHTML = chipsHTML(L.sizes, lf.size, 'lf-size', x => x.id);
    renderLithoNumbers();
  };
  const lithoGrams = () => {
    const [w, h] = dimsOf();
    const f = L.frame;
    const inner = (w - 2 * f) * (h - 2 * f);
    const mean = thick ? meanThick : (L.minThick + L.maxThick) / 2;
    let vol = inner * mean + (w * h - inner) * (L.maxThick + 0.4);
    if (lf.shape === 'flat') vol += w * 0.55 * 14 * 3;   // стойката
    return vol / 1000 * materials[L.material].density;
  };
  const lithoUnit = () => {
    const grams = lithoGrams();
    return roundPrice(S.priceFor({ grams, hours: grams / L.gramsPerHour, mat: L.material, color: L.color, assembly: shapeOf().assembly }));
  };
  const renderLithoNumbers = () => {
    const [w, h] = dimsOf();
    $('#lf-dims').textContent = t('{w} × {h} мм', { w, h });
    $('#lf-shape-hint').textContent = t(shapeOf().hint);
    $('#lf-unit').textContent = t('{price} / бр.', { price: fmt(lithoUnit()) }) + ' · ' + t('≈ {g} г / бр.', { g: Math.round(lithoGrams()) });
    $('#lf-line').textContent = fmt(lithoUnit() * lf.qty);
  };

  // качване на снимка
  const photoInput = $('#photo-input');
  const useImage = (img, file, sample = false) => {
    lf.img = img; lf.file = file; lf.sample = sample;
    lf.pan = { x: 0.5, y: 0.5 };
    lf.format = img.width >= img.height * 1.15 ? 'land' : img.height >= img.width * 1.15 ? 'port' : 'square';
    $('#litho-empty').hidden = true;
    ['#litho-canvas', '#light-switch', '#litho-change', '#litho-hint'].forEach(s => { $(s).hidden = false; });
    renderLithoPanel();
    process();
    drawLitho();
  };
  const loadPhoto = async file => {
    showError('');
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showError(t('„{name}“ не е снимка в JPG, PNG или WEBP.', { name: file.name })); return; }
    if (file.size > L.maxPhotoMB * 1024 * 1024) { showError(t('„{name}“ е по-голям от {mb} MB.', { name: file.name, mb: L.maxPhotoMB })); return; }
    try {
      const img = await createImageBitmap(file);
      useImage(img, file);
    } catch {
      showError(t('Не успяхме да отворим „{name}“. Пробвай с друга снимка.', { name: file.name }));
    }
  };
  photoInput.addEventListener('change', () => { if (photoInput.files[0]) loadPhoto(photoInput.files[0]); photoInput.value = ''; });
  $$('[data-pick-photo]').forEach(b => b.addEventListener('click', () => photoInput.click()));
  litBox.addEventListener('dragover', e => { e.preventDefault(); litBox.classList.add('drag'); });
  litBox.addEventListener('dragleave', () => litBox.classList.remove('drag'));
  litBox.addEventListener('drop', e => {
    e.preventDefault();
    litBox.classList.remove('drag');
    const f = e.dataTransfer?.files[0];
    if (f) loadPhoto(f);
  });

  // примерна „снимка“ — нарисуван пейзаж, за да се види ефектът без собствена снимка
  $('#litho-sample').addEventListener('click', async () => {
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 900;
    const c = cv.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 900);
    sky.addColorStop(0, '#1f2a44'); sky.addColorStop(0.55, '#c9b8a8'); sky.addColorStop(1, '#efe6da');
    c.fillStyle = sky; c.fillRect(0, 0, 1200, 900);
    c.fillStyle = '#fff8ea'; c.beginPath(); c.arc(820, 300, 90, 0, Math.PI * 2); c.fill();
    const ridge = (base, amp, seed, col) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, 900);
      for (let x = 0; x <= 1200; x += 20) c.lineTo(x, base - amp * (Math.sin(x / 140 + seed) * 0.6 + Math.sin(x / 57 + seed * 2) * 0.25 + Math.sin(x / 23 + seed) * 0.08));
      c.lineTo(1200, 900); c.fill();
    };
    ridge(560, 130, 1, '#7d7b86'); ridge(660, 90, 4, '#4c4955'); ridge(770, 60, 2, '#25222b');
    // дърво
    c.fillStyle = '#121016';
    c.fillRect(268, 560, 14, 160);
    for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(275, 470 + i * 34); c.lineTo(205 - i * 7, 560 + i * 30); c.lineTo(345 + i * 7, 560 + i * 30); c.fill(); }
    useImage(await createImageBitmap(cv), null, true);
  });

  // влачене на кадъра
  let drag = null;
  litCv.addEventListener('pointerdown', e => {
    if (!lf.img) return;
    drag = { x: e.clientX, y: e.clientY, pan: { ...lf.pan } };
    litCv.setPointerCapture(e.pointerId);
  });
  litCv.addEventListener('pointermove', e => {
    if (!drag || !litRect) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = formatOf().ratio;
    const iw = lf.img.width, ih = lf.img.height;
    const cw = iw / ih > r ? ih * r : iw, ch = iw / ih > r ? ih : iw / r;
    const sx = iw - cw, sy = ih - ch;
    const scale = cw / (litRect.w / dpr);   // пиксели от снимката за 1 пиксел на екрана
    lf.pan.x = sx ? Math.min(1, Math.max(0, drag.pan.x - (e.clientX - drag.x) * scale / sx)) : 0.5;
    lf.pan.y = sy ? Math.min(1, Math.max(0, drag.pan.y - (e.clientY - drag.y) * scale / sy)) : 0.5;
    process();
    drawLitho();
  });
  const endDrag = () => { if (drag) { drag = null; renderLithoNumbers(); } };
  litCv.addEventListener('pointerup', endDrag);
  litCv.addEventListener('pointercancel', endDrag);

  $('#light-switch').addEventListener('click', e => {
    const b = e.target.closest('[data-light]');
    if (!b) return;
    lf.light = b.dataset.light === 'on';
    $$('#light-switch [data-light]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    paintFace();
    drawLitho();
  });
  $('#lf-shape').addEventListener('change', e => { lf.shape = e.target.value; renderLithoNumbers(); drawLitho(); });
  $('#lf-format').addEventListener('change', e => { lf.format = e.target.value; process(); renderLithoNumbers(); drawLitho(); });
  $('#lf-size').addEventListener('change', e => { lf.size = e.target.value; process(); renderLithoNumbers(); });
  $('#lf-qty').addEventListener('change', e => { lf.qty = clampQty(e.target.value); e.target.value = lf.qty; renderLithoNumbers(); });

  $('#lf-add').addEventListener('click', () => {
    if (!lf.img || lf.sample) { showError(t('Качи своя снимка, за да поръчаш литофания.')); return; }
    showError('');
    const [w, h] = dimsOf();
    const shape = shapeOf(), format = formatOf();
    addItem({
      kind: 'litho', file: lf.file, crop: { ...lf.pan }, ratio: format.ratio, qty: lf.qty, unit: lithoUnit(), color: '#f6f1e4',
      name: t('Литофания — {shape}', { shape: t(shape.label).toLowerCase() }),
      meta: `${lf.size} · ${w} × ${h} ${t('мм')}`,
      email: `Литофания — ${shape.label.toLowerCase()}, ${w} × ${h} мм (${format.label.toLowerCase()}), бял PLA`,
      detail: `≈ ${Math.round(lithoGrams())} г · кадър: x ${Math.round(lf.pan.x * 100)}% · y ${Math.round(lf.pan.y * 100)}% · снимка: ${lf.file.name}`,
    });
  });

  // =====================================================================
  // НАДПИС
  // =====================================================================
  const tx = { tpl: X.templates[0].id, size: 'M', font: X.fonts[0].id, mat: null, base: null, ink: null, line1: '', line2: '', qty: 1 };
  const tplOf = () => X.templates.find(x => x.id === tx.tpl);
  const sizeOf = () => tplOf().sizes.find(x => x.id === tx.size);
  const fontOf = () => X.fonts.find(x => x.id === tx.font);
  const fontCSS = px => `${fontOf().weight} ${px}px "${fontOf().family}"`;
  const textCv = $('#text-canvas');
  const textBox = $('#text-box');
  const shade = (hex, k) => {   // по-тъмен (k < 1) или по-светъл (k > 1) вариант на цвета
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(Math.min(255, Math.max(0, k > 1 ? v + (255 - v) * (k - 1) : v * k))));
    return `rgb(${ch.join(',')})`;
  };
  const sample = tp => t(tp.sample);

  // как изглежда продуктът (в мм): форма, дупки и къде стои всеки ред текст
  const layout = tp => {
    const { w, h } = sizeOf();
    const two = tp.line2 && tx.line2.trim();
    switch (tp.shape) {
      case 'tag': return { W: w, H: h, parts: [{ type: 'tag', x: 0, y: 0, w, h }],
        lines: [{ text: tx.line1, x: h * 0.85, y: 0, w: w - h * 0.85 - h * 0.28, h, size: h * 0.62 }] };
      case 'plate': return { W: w, H: h, parts: [{ type: 'plate', x: 0, y: 0, w, h }],
        lines: two
          ? [{ text: tx.line1, x: 9, y: h * 0.12, w: w - 18, h: h * 0.52, size: h * 0.4 }, { text: tx.line2, x: 9, y: h * 0.6, w: w - 18, h: h * 0.28, size: h * 0.2 }]
          : [{ text: tx.line1, x: 9, y: 0, w: w - 18, h, size: h * 0.46 }] };
      case 'round': {
        const gap = w * 0.3;
        return { W: w * 2 + gap, H: h, parts: [{ type: 'disc', x: 0, y: 0, w, h, label: 'отпред' }, { type: 'disc', x: w + gap, y: 0, w, h, label: 'отзад' }],
          lines: [{ text: tx.line1, x: w * 0.12, y: h * 0.22, w: w * 0.76, h: h * 0.62, size: h * 0.3 },
            { text: tx.line2, x: w + gap + w * 0.1, y: h * 0.22, w: w * 0.8, h: h * 0.62, size: h * 0.15 }] };
      }
      case 'desk': return { W: w, H: h, parts: [{ type: 'base', x: 0, y: h - 8, w, h: 8 }],
        lines: [{ text: tx.line1, x: w * 0.03, y: 0, w: w * 0.94, h: h - 6.5, size: (h - 8) * 1.25, sit: true }] };
    }
  };
  // размер на шрифта, за да се събере редът; връща px
  const fitFont = (c, ln, k) => {
    let px = ln.size * k;
    c.font = fontCSS(px);
    const mw = c.measureText(ln.text).width;
    if (mw > ln.w * k) px *= ln.w * k / mw;
    return px;
  };
  const drawLine = (c, ln, k, ox, oy) => {
    if (!ln.text.trim()) return;
    const px = fitFont(c, ln, k);
    c.font = fontCSS(px);
    c.textAlign = 'center';
    const cx = ox + (ln.x + ln.w / 2) * k;
    if (ln.sit) {
      c.textBaseline = 'alphabetic';
      c.fillText(ln.text, cx, oy + (ln.y + ln.h) * k);
    } else {
      // центрираме по главните букви — опашките (р, у, g) висят надолу
      c.textBaseline = 'alphabetic';
      const cap = c.measureText('НH').actualBoundingBoxAscent;
      c.fillText(ln.text, cx, oy + (ln.y + ln.h / 2) * k + cap / 2);
    }
  };
  const shapePath = (c, p, k, ox, oy) => {
    const x = ox + p.x * k, y = oy + p.y * k, w = p.w * k, h = p.h * k;
    c.beginPath();
    if (p.type === 'disc') {
      c.arc(x + w / 2, y + h / 2, w / 2, 0, Math.PI * 2);
      c.moveTo(x + w / 2 + w * 0.07, y + h * 0.12);
      c.arc(x + w / 2, y + h * 0.12, w * 0.07, 0, Math.PI * 2, true);
    } else if (p.type === 'tag') {
      c.roundRect(x, y, w, h, h * 0.32);
      const r = h * 0.17, hx = x + h * 0.42, hy = y + h / 2;
      c.moveTo(hx + r, hy);
      c.arc(hx, hy, r, 0, Math.PI * 2, true);
    } else {
      c.roundRect(x, y, w, h, Math.min(p.type === 'base' ? 2.5 : 6, h * 0.2) * k);
    }
  };

  // площта на надписа в мм² — рисуваме го в скрит canvas и броим точките
  const meter = document.createElement('canvas');
  const textArea = (tp, lay) => {
    const k = 4;
    meter.width = Math.ceil(lay.W * k); meter.height = Math.ceil(lay.H * k);
    const c = meter.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, meter.width, meter.height);
    c.fillStyle = '#000';
    lay.lines.forEach(ln => drawLine(c, ln, k, 0, 0));
    const d = c.getImageData(0, 0, meter.width, meter.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 127) n++;
    return n / (k * k);
  };
  const textGrams = () => {
    const tp = tplOf();
    const lay = layout(tp);
    const { w, h } = sizeOf();
    const ink = textArea(tp, lay);
    let vol;
    if (tp.shape === 'desk') vol = (w * 20 * 8 + ink * tp.thick) * tp.solid;           // основа 20 мм дълбока + букви
    else {
      const area = tp.shape === 'round' ? Math.PI * (w / 2) ** 2 : w * h * 0.94;
      vol = area * tp.thick * tp.solid + ink * 1;                                        // надписът е изпъкнал 1 мм
    }
    return vol / 1000 * materials[tx.mat].density;
  };
  const picks = () => (tx.ink && tx.ink !== tx.base ? [tx.base, tx.ink] : [tx.base]);
  const textUnit = () => roundPrice(S.priceFor({ grams: textGrams(), mat: tx.mat, picks: picks(), assembly: tplOf().assembly }));

  const drawText = () => {
    if (tools.text.hidden) return;
    const tp = tplOf();
    const lay = layout(tp);
    const { w, h, dpr } = fitCanvas(textCv, textBox);
    const c = textCv.getContext('2d');
    c.clearRect(0, 0, w, h);
    const pad = 46 * dpr;
    const k = Math.min((w - 2 * pad) / lay.W, (h - 2 * pad - 30 * dpr) / lay.H);
    const ox = (w - lay.W * k) / 2, oy = (h - lay.H * k) / 2 - 8 * dpr;
    const baseHex = S.previewColor(tx.base), inkHex = S.previewColor(tx.ink || tx.base);
    const op = S.finishFor(tx.mat, tx.base).opacity;
    const lift = Math.max(1.5 * dpr, (tp.shape === 'desk' ? 1.6 : 0.5) * k);   // изпъкналост на буквите
    const off = Math.min(lift, 3 * dpr);                                         // дебелина на основата на екрана

    // основата
    lay.parts.forEach(p => {
      c.save();
      c.globalAlpha = op;
      shapePath(c, p, k, ox, oy);
      c.shadowColor = 'rgba(23, 21, 31, .28)'; c.shadowBlur = 14 * dpr; c.shadowOffsetX = 4 * dpr; c.shadowOffsetY = 6 * dpr;
      c.fillStyle = shade(baseHex, 0.78);
      c.fill('evenodd');
      c.shadowColor = 'transparent';
      c.translate(-off, -off);
      shapePath(c, p, k, ox, oy);
      const g = c.createLinearGradient(0, oy + p.y * k, 0, oy + (p.y + p.h) * k);
      g.addColorStop(0, shade(baseHex, 1.12)); g.addColorStop(1, baseHex);
      c.fillStyle = g;
      c.fill('evenodd');
      c.strokeStyle = 'rgba(23, 21, 31, .35)'; c.lineWidth = 1.2 * dpr;
      c.stroke();
      c.restore();
      if (p.type === 'plate') {   // рамка в цвета на надписа
        c.save();
        c.strokeStyle = inkHex; c.lineWidth = 1.4 * k;
        c.beginPath(); c.roundRect(ox + 3.5 * k - off, oy + 3.5 * k - off, (p.w - 7) * k, (p.h - 7) * k, 4 * k); c.stroke();
        c.restore();
      }
      if (p.label) {
        c.fillStyle = '#8a8494';
        c.font = `600 ${13 * dpr}px Onest, sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'top';
        c.fillText(t(p.label), ox + (p.x + p.w / 2) * k, oy + (p.y + p.h) * k + 12 * dpr);
      }
    });
    // надписът: сянка отдолу и лице отгоре
    c.save();
    c.fillStyle = shade(inkHex, 0.62);
    lay.lines.forEach(ln => drawLine(c, ln, k, ox - off + lift * 0.6, oy - off + lift * 0.6));
    c.fillStyle = inkHex;
    lay.lines.forEach(ln => drawLine(c, ln, k, ox - off - lift * 0.15, oy - off - lift * 0.15));
    c.restore();
  };

  const fitColors = () => {
    const list = S.colorsFor(tx.mat).map(x => x.name);
    const tp = tplOf();
    if (!list.includes(tx.base)) tx.base = list.includes(tp.base) ? tp.base : list[0];
    if (!list.includes(tx.ink) || tx.ink === tx.base) tx.ink = list.includes(tp.ink) && tp.ink !== tx.base ? tp.ink : (list.find(x => x !== tx.base) || tx.base);
  };
  const renderTextPanel = () => {
    const tp = tplOf();
    $('#tx-title').textContent = t(tp.label);
    $('#tx-note').hidden = !tp.note;
    $('#tx-note').textContent = tp.note ? t(tp.note) : '';
    $('#tx-template').innerHTML = chipsHTML(X.templates, tx.tpl, 'tx-template');
    $('#tx-font').innerHTML = chipsHTML(X.fonts, tx.font, 'tx-font', f => `<i class="font-sample" style="font-family:'${f.family}';font-weight:${f.weight}">${t(f.label)}</i>`);
    $('#tx-materials').innerHTML = S.materialsHTML(S.available(ALL), tx.mat, 'tx-mat', tp.rec);
    $('#tx-size').innerHTML = chipsHTML(tp.sizes, tx.size, 'tx-size', s => `${s.id} · ${tp.shape === 'round' ? `Ø ${s.w}` : `${s.w} × ${s.h}`} ${t('мм')}`);
    const l1 = $('#tx-line1');
    l1.maxLength = tp.max;
    l1.value = tx.line1;
    l1.placeholder = sample(tp);
    $('#tx-line2-wrap').hidden = !tp.line2;
    if (tp.line2) {
      $('#tx-line2-label').textContent = t(tp.line2.label);
      const l2 = $('#tx-line2');
      l2.maxLength = tp.line2.max;
      l2.value = tx.line2;
      l2.placeholder = t(tp.line2.sample);
    }
    renderTextColors();
  };
  const renderTextColors = () => {
    fitColors();
    $('#tx-base').innerHTML = S.swatchesHTML(tx.mat, tx.base, 'tx-base');
    $('#tx-ink').innerHTML = S.swatchesHTML(tx.mat, tx.ink, 'tx-ink');
    renderTextNumbers();
  };
  const renderTextNumbers = () => {
    const tp = tplOf();
    const { w, h } = sizeOf();
    $('#tx-count').textContent = `${tx.line1.length}/${tp.max}`;
    $('#tx-base-name').textContent = t(tx.base);
    $('#tx-ink-name').textContent = t(tx.ink);
    $('#tx-dims').textContent = tp.shape === 'round' ? `Ø ${w} ${t('мм')}` : t('{w} × {h} мм', { w, h });
    const unit = textUnit();
    $('#tx-unit').textContent = t('{price} / бр.', { price: fmt(unit) }) + ' · ' + t('≈ {g} г / бр.', { g: Math.max(1, Math.round(textGrams())) });
    $('#tx-line').textContent = fmt(unit * tx.qty);
    drawText();
  };
  // препоръчан материал с поне 2 цвята на склад (основа + надпис), иначе какъвто има
  const defaultMat = tp => tp.rec.find(m => S.colorsFor(m).length > 1) || tp.rec.find(m => S.available([m]).length)
    || S.available(ALL).find(m => S.colorsFor(m).length > 1) || S.available(ALL)[0];
  const startTemplate = id => {
    tx.tpl = id;
    const tp = tplOf();
    tx.mat = defaultMat(tp);
    tx.base = tp.base; tx.ink = tp.ink;
    tx.line1 = sample(tp);
    tx.line2 = tp.line2 ? t(tp.line2.sample) : '';
    if (!tp.sizes.some(s => s.id === tx.size)) tx.size = tp.sizes[1].id;
    renderTextPanel();
  };

  $('#tx-template').addEventListener('change', e => startTemplate(e.target.value));
  $('#tx-font').addEventListener('change', e => { tx.font = e.target.value; renderTextNumbers(); });
  $('#tx-materials').addEventListener('change', e => { tx.mat = e.target.value; renderTextColors(); });
  $('#tx-base').addEventListener('change', e => { tx.base = e.target.value; if (tx.ink === tx.base) tx.ink = null; renderTextColors(); });
  $('#tx-ink').addEventListener('change', e => { tx.ink = e.target.value; renderTextNumbers(); });
  $('#tx-size').addEventListener('change', e => { tx.size = e.target.value; renderTextNumbers(); });
  $('#tx-line1').addEventListener('input', e => { tx.line1 = e.target.value; renderTextNumbers(); });
  $('#tx-line2').addEventListener('input', e => { tx.line2 = e.target.value; renderTextNumbers(); });
  $('#tx-qty').addEventListener('change', e => { tx.qty = clampQty(e.target.value); e.target.value = tx.qty; renderTextNumbers(); });
  S.bindMaterialTips($('#tx-materials'));
  document.addEventListener('sloy:stock', () => {
    if (!S.available([tx.mat]).length) tx.mat = defaultMat(tplOf());
    renderTextPanel();
  });

  $('#tx-add').addEventListener('click', () => {
    const tp = tplOf();
    if (!tx.line1.trim()) { showError(t('Напиши текста за надписа.')); $('#tx-line1').focus(); return; }
    showError('');
    const { w, h } = sizeOf();
    const dims = tp.shape === 'round' ? `Ø ${w} мм` : `${w} × ${h} мм`;
    const two = tp.line2 && tx.line2.trim();
    const cols = picks();
    addItem({
      kind: 'text', qty: tx.qty, unit: textUnit(), color: S.previewColor(tx.base),
      name: `${t(tp.label)} „${tx.line1.trim()}“`,
      meta: `${t(materials[tx.mat].label)} · ${cols.map(x => t(x)).join(' + ')}`,
      email: `${tp.label} „${tx.line1.trim()}“${two ? ` + „${tx.line2.trim()}“` : ''} — шрифт ${fontOf().family}, ${materials[tx.mat].label}, `
        + `основа ${tx.base}${cols.length > 1 ? `, надпис ${tx.ink}` : ''}, ${tx.size} (${dims})`,
      detail: `≈ ${Math.max(1, Math.round(textGrams()))} г`,
    });
  });

  // =====================================================================
  // ПОРЪЧКА
  // =====================================================================
  const items = [];
  let uid = 0;
  let extras = null;
  let lastTotals = null;
  const subtotal = () => items.reduce((s, it) => s + it.unit * it.qty, 0);
  const totals = () => S.totals(subtotal(), extras?.express());
  const addItem = it => {
    items.push({ uid: ++uid, ...it });
    renderCart();
    S.toast(t('Добавено към поръчката.'));
    $('#custom-cart').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const renderCart = () => {
    $('#custom-cart').hidden = !items.length;
    $('#custom-list').innerHTML = items.map(it => `
      <div class="file-chip" data-uid="${it.uid}">
        <div class="file-pick">
          <span class="file-dot" style="--c:${it.color}"></span>
          <span class="file-name">${esc(it.name)}</span>
          <span class="file-meta">${esc(it.meta)} · ${t('{qty} бр.', { qty: it.qty })} · ${fmt(it.unit * it.qty)}</span>
        </div>
        <button type="button" class="file-remove" data-act="remove" aria-label="${esc(t('Премахни {name}', { name: it.name }))}">×</button>
      </div>`).join('');
    const tt = totals();
    $$('[data-calc-total]').forEach(el => { el.textContent = fmt(tt.total); });
    $$('[data-sum-lines]').forEach(el => { el.innerHTML = items.length ? S.sumLinesHTML(tt) : ''; });
  };
  $('#custom-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act=remove]');
    if (!b) return;
    items.splice(items.findIndex(x => x.uid === +b.closest('.file-chip').dataset.uid), 1);
    renderCart();
  });

  const orderEl = $('#order-drawer');
  const form = $('#checkout-form');
  const showStep = step => {
    form.hidden = step !== 'form';
    $('#checkout-success').hidden = step !== 'success';
  };
  const hasPhotos = () => items.some(it => it.file);
  $('#to-order').addEventListener('click', () => {
    $('#order-items').innerHTML = items.map(it => `
      <li><span>${esc(it.name)}<small>${esc(`${it.meta} · ${t('{qty} бр.', { qty: it.qty })}`)}</small></span><strong>${fmt(it.unit * it.qty)}</strong></li>`).join('');
    $('#file-note').hidden = !!S.scriptUrl || !hasPhotos();
    showStep('form');
    S.openDrawer(orderEl);
  });

  // снимките: само избраният кадър, до 2400 px, като JPEG — достатъчно за литофания и по-лек файл
  const cropToBase64 = async it => {
    const img = await createImageBitmap(it.file);
    const iw = img.width, ih = img.height, r = it.ratio;
    let cw = iw, ch = ih;
    if (iw / ih > r) cw = ih * r; else ch = iw / r;
    const k = Math.min(1, 2400 / Math.max(cw, ch));
    const cv = document.createElement('canvas');
    cv.width = Math.round(cw * k); cv.height = Math.round(ch * k);
    cv.getContext('2d').drawImage(img, (iw - cw) * it.crop.x, (ih - ch) * it.crop.y, cw, ch, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.92).split(',')[1];
  };
  const uploadPhotos = async orderNo => {
    const photos = items.filter(it => it.file);
    if (!S.scriptUrl || !photos.length) return {};
    const files = await Promise.all(photos.map(async (it, i) => ({
      name: `${orderNo}-litofania-${i + 1}.jpg`, type: 'image/jpeg', data: await cropToBase64(it), uid: it.uid,
    })));
    const res = await fetch(S.scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'files', order: orderNo, files: files.map(({ uid, ...f }) => f) }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'upload failed');
    return Object.fromEntries(files.map((f, i) => [f.uid, json.files[i]?.url]));
  };

  S.setupCheckout(form, {
    build: async (orderNo, d, setStatus) => {
      if (!items.length) throw new Error('Няма продукти');
      let links = {};
      if (S.scriptUrl && hasPhotos()) {
        setStatus(t('Качваме снимките…'));
        links = await uploadPhotos(orderNo);
      }
      lastTotals = totals();
      const total = fmt(lastTotals.total);
      const lines = items.map((it, n) => `${n + 1}. ${it.email} × ${it.qty} бр. = ${fmt(it.unit * it.qty)}\n   ${it.detail}`
        + (it.file ? `\n   Снимка: ${links[it.uid] || 'клиентът ще я изпрати по имейл или Viber'}` : '')).join('\n');
      return {
        subject: `Персонализирана поръчка ${orderNo} — ${total}${lastTotals.express ? ' — ЕКСПРЕСНА' : ''}`,
        fields: { 'Продукти': lines, ...S.totalsFields(lastTotals), 'Общо': `${total}${lastTotals.freeShip ? ' (доставката е безплатна)' : ' + доставка'} — ориентировъчно, потвърждава се` },
      };
    },
    onSuccess: orderNo => {
      S.afterOrder(lastTotals, orderNo);
      $('#success-file-note').hidden = !!S.scriptUrl || !hasPhotos();
      items.length = 0;
      extras.reset();
      renderCart();
      $('#order-no').textContent = orderNo;
      showStep('success');
    },
  });
  extras = S.mountExtras($('#custom-extras'), renderCart);

  // ---------- Старт ----------
  renderLithoPanel();
  // #nadpis — надписите, #pozivna — направо табелката с позивна (връзката е от каталога, airsoft)
  startTemplate(location.hash === '#pozivna' ? 'callsign' : tx.tpl);
  showTool(['#nadpis', '#pozivna'].includes(location.hash) ? 'text' : 'litho');
  // шрифтовете идват от Google Fonts — щом се заредят, прерисуваме надписа
  Promise.all(X.fonts.map(f => document.fonts.load(`${f.weight} 40px "${f.family}"`, 'АБВ abc'))).then(renderTextNumbers, renderTextNumbers);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawText(); drawLitho(); }, 120); });
})();

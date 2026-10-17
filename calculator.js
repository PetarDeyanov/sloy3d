// Калкулатор: качваш STL → 3D преглед → цена → поръчка.
import * as THREE from 'three';
import { parseSTL, measure, createViewer } from './viewer.js';

const S = window.SLOY_SHOP;
const { materials, calculator: P } = window.SLOY_CATALOG;
const { esc, fmt, clampQty, t } = S;
const cfg = S.cfg;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MATS = Object.keys(materials);
const firstMat = () => (S.available(['PLA']).length ? 'PLA' : S.available(MATS)[0]);
const items = [];       // { uid, name, file, model, mat, color, ncolors, extra, infill, scale, qty }
let active = null;
let uid = 0;
let viewer = null;

// ---------- Сметка ----------
// Тегло = стени и капаци (площ × дебелина) + вътрешност × запълване, × плътност. Брака добавя формулата за цена.
const weightOf = it => {
  const s = it.scale / 100;
  const volume = it.model.volume * s ** 3;           // мм³
  const shell = Math.min(volume, it.model.area * s ** 2 * P.wall);
  const printed = shell + (volume - shell) * it.infill;
  return (printed / 1000) * materials[it.mat].density;
};
const colorsOf = it => [it.color, ...it.extra];
const unitPriceOf = it => Math.max(0.5, Math.round(S.priceFor({ grams: weightOf(it), mat: it.mat, picks: colorsOf(it) }) * 10) / 10);
const lineOf = it => unitPriceOf(it) * it.qty;
const subtotal = () => items.reduce((s, it) => s + lineOf(it), 0);
let extras = null;      // експресна изработка и промокод
let lastTotals = null;
const totals = () => S.totals(subtotal(), extras?.express());
const totalOf = () => totals().total;
const sizeOf = it => {
  const s = it.scale / 100;
  return [it.model.size.x * s, it.model.size.y * s, it.model.size.z * s];
};
const fitsPrinter = it => {
  const dims = sizeOf(it).sort((a, b) => b - a);
  const bed = [...P.buildVolume].sort((a, b) => b - a);
  return dims.every((d, i) => d <= bed[i]);
};
const mm = n => {
  const s = (n >= 100 ? Math.round(n) : n.toFixed(1).replace('.0', '')).toString();
  return S.lang === 'en' ? s : s.replace('.', ',');
};
const infillOf = v => P.infill.find(x => x.value === v);

// ---------- Файлове ----------
const input = $('#file-input');
const drop = $('#dropzone');
const errBox = $('#calc-error');
const showError = msg => { errBox.textContent = msg; errBox.hidden = !msg; };

const addFiles = async files => {
  showError('');
  for (const file of files) {
    if (!/\.stl$/i.test(file.name)) { showError(t('„{name}“ не е STL. За 3MF, STEP или OBJ използвай формата за поръчка по идея.', { name: file.name })); continue; }
    if (file.size > P.maxFileMB * 1024 * 1024) { showError(t('„{name}“ е по-голям от {mb} MB.', { name: file.name, mb: P.maxFileMB })); continue; }
    try {
      const model = parseSTL(await file.arrayBuffer());
      if (model.volume < 1) throw new Error('empty');
      items.push({ uid: ++uid, name: file.name, file, model, mat: firstMat(), color: S.colorsFor(firstMat())[0].name, ncolors: 1, extra: [], infill: P.infill[0].value, scale: 100, qty: 1 });
      if (Math.max(model.size.x, model.size.y, model.size.z) < 3) {
        showError(t('„{name}“ е под 3 мм — вероятно е в инчове или метри. Промени размера отдолу.', { name: file.name }));
      }
      select(items[items.length - 1]);
    } catch {
      showError(t('Не успяхме да прочетем „{name}“. Провери дали е затворен 3D модел.', { name: file.name }));
    }
  }
  render();
};

input.addEventListener('change', () => { addFiles([...input.files]); input.value = ''; });
['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => {
  e.preventDefault();
  if (t === 'drop' || !e.relatedTarget) drop.classList.remove('drag');
}));
document.addEventListener('drop', e => { if (e.dataTransfer?.files.length) addFiles([...e.dataTransfer.files]); });
$$('[data-pick-file]').forEach(b => b.addEventListener('click', () => input.click()));

// Примерен модел — за да види клиентът как работи, без да има файл
$('#try-sample').addEventListener('click', () => {
  const geo = new THREE.TorusKnotGeometry(18, 6, 160, 24).toNonIndexed();
  geo.rotateX(Math.PI / 2);
  const positions = new Float32Array(geo.attributes.position.array);
  items.push({ uid: ++uid, name: t('примерен-модел.stl'), file: null, model: { positions, ...measure(positions) }, mat: firstMat(), color: S.colorsFor(firstMat())[0].name, ncolors: 1, extra: [], infill: P.infill[0].value, scale: 100, qty: 1 });
  select(items[items.length - 1]);
  render();
});

// ---------- Избор и настройки ----------
const select = it => {
  active = it;
  $('#calc-stage').hidden = false;
  $('#calc-empty').hidden = true;
  viewer ||= createViewer($('#viewer'));
  viewer.setScale(it.scale / 100);
  viewer.load(it.model.positions);
  paint();
  renderPanel();
};
const paint = () => {
  if (!viewer || !active) return;
  viewer.setFinish(S.finishFor(active.mat, active.color));
  viewer.setColor(S.previewColor(active.color));
};

const renderExtra = () => {
  active.extra = S.fitExtra(active.mat, active.color, active.extra, active.ncolors);
  $('#cf-extra-colors').innerHTML = S.extraColorsHTML(active.mat, active.extra, 'cf-color');
};
const renderPanel = () => {
  const it = active;
  $('#cf-name').textContent = it.name;
  $('#cf-materials').innerHTML = S.materialsHTML(S.available(MATS), it.mat, 'cf-mat');
  $('#cf-colors').innerHTML = S.swatchesHTML(it.mat, it.color, 'cf-color');
  $('#cf-color-name').textContent = t(it.color);
  it.ncolors = Math.min(it.ncolors, S.maxColorsFor(it.mat));
  $('#cf-ncolors').innerHTML = S.ncolorsHTML(it.ncolors, 'cf-ncolors', it.mat);
  $('#cf-ncolors').closest('.opt').hidden = S.maxColorsFor(it.mat) < 2;
  renderExtra();
  $('#cf-infill').innerHTML = P.infill.map(f => `
    <label class="chip"><input type="radio" name="cf-infill" value="${f.value}"${f.value === it.infill ? ' checked' : ''}><span>${t(f.label)}</span></label>`).join('');
  $('#cf-infill-hint').textContent = t(infillOf(it.infill).hint);
  $('#cf-scale').value = it.scale;
  $('#cf-scale-range').value = Math.min(300, Math.max(25, it.scale));
  $('#cf-qty').value = it.qty;
  renderNumbers();
};

const renderNumbers = () => {
  const it = active;
  const [x, y, z] = sizeOf(it);
  const s = it.scale / 100;
  const dims = t('{x} × {y} × {z} мм', { x: mm(x), y: mm(y), z: mm(z) });
  $('#cf-dims').textContent = dims;
  $('#cf-volume').textContent = t('{v} см³', { v: mm(it.model.volume * s ** 3 / 1000) });
  $('#cf-weight').textContent = t('≈ {g} г / бр.', { g: Math.max(1, Math.round(weightOf(it))) });
  $('#cf-unit').textContent = t('{price} / бр.', { price: fmt(unitPriceOf(it)) });
  $('#cf-line').textContent = fmt(lineOf(it));
  const fits = fitsPrinter(it);
  const badge = $('#cf-fit');
  badge.textContent = fits ? t('Влиза в принтера') : t('По-голям от {mm} мм — ще го разделим на части', { mm: P.buildVolume[0] });
  badge.classList.toggle('warn', !fits);
  $('#viewer-dims').textContent = dims;
  renderSummary();
};

const renderSummary = () => {
  $('#file-list').innerHTML = items.map(it => `
    <div class="file-chip${it === active ? ' active' : ''}" data-uid="${it.uid}">
      <button type="button" class="file-pick" data-act="pick">
        <span class="file-dot" style="--c:${S.previewColor(it.color)}"></span>
        <span class="file-name">${esc(it.name)}</span>
        <span class="file-meta">${t('{mat} · {qty} бр. · {price}', { mat: t(materials[it.mat].label), qty: it.qty, price: fmt(lineOf(it)) })}</span>
      </button>
      <button type="button" class="file-remove" data-act="remove" aria-label="${esc(t('Премахни {name}', { name: it.name }))}">×</button>
    </div>`).join('');
  const tt = totals();
  $$('[data-calc-total]').forEach(el => { el.textContent = fmt(tt.total); });
  $$('[data-sum-lines]').forEach(el => { el.innerHTML = items.length ? S.sumLinesHTML(tt) : ''; });
};

const render = () => {
  const has = items.length > 0;
  $('#calc-stage').hidden = !has;
  $('#calc-empty').hidden = has;
  if (has) renderNumbers();
};

$('#file-list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const it = items.find(x => x.uid === +b.closest('.file-chip').dataset.uid);
  if (b.dataset.act === 'pick') select(it);
  if (b.dataset.act === 'remove') {
    items.splice(items.indexOf(it), 1);
    if (it === active && items.length) select(items[items.length - 1]);
    if (!items.length) active = null;
    render();
  }
});

$('#cf-materials').addEventListener('change', e => {
  active.mat = e.target.value;
  if (!S.colorsFor(active.mat).some(c => c.name === active.color)) active.color = S.colorsFor(active.mat)[0].name;
  renderPanel();
  paint();
});
$('#cf-colors').addEventListener('change', e => {
  active.color = e.target.value;
  $('#cf-color-name').textContent = t(active.color);
  paint();
  renderNumbers();
});
$('#cf-ncolors').addEventListener('change', e => { active.ncolors = +e.target.value; renderExtra(); renderNumbers(); });
$('#cf-extra-colors').addEventListener('change', e => {
  const row = e.target.closest('.extra-color');
  active.extra[+row.dataset.idx] = e.target.value;
  $('.opt-value', row).textContent = t(e.target.value);
  renderNumbers();
});
$('#cf-infill').addEventListener('change', e => {
  active.infill = +e.target.value;
  $('#cf-infill-hint').textContent = t(infillOf(active.infill).hint);
  renderNumbers();
});
const setScale = v => {
  active.scale = Math.max(10, Math.min(5000, Math.round(+v) || 100));
  $('#cf-scale').value = active.scale;
  $('#cf-scale-range').value = Math.min(300, Math.max(25, active.scale));
  viewer.setScale(active.scale / 100);
  renderNumbers();
};
$('#cf-scale-range').addEventListener('input', e => setScale(e.target.value));
$('#cf-scale').addEventListener('change', e => setScale(e.target.value));
$('#cf-minus').addEventListener('click', () => { active.qty = clampQty(active.qty - 1); $('#cf-qty').value = active.qty; renderNumbers(); });
$('#cf-plus').addEventListener('click', () => { active.qty = clampQty(active.qty + 1); $('#cf-qty').value = active.qty; renderNumbers(); });
$('#cf-qty').addEventListener('change', e => { active.qty = clampQty(e.target.value); e.target.value = active.qty; renderNumbers(); });
$('#viewer-reset').addEventListener('click', () => viewer?.reset());
S.bindMaterialTips($('#cf-materials'));
// складът се обнови — материалите и цветовете на файловете се свеждат до наличните
document.addEventListener('sloy:stock', () => {
  items.forEach(it => {
    if (!S.available([it.mat]).length) it.mat = firstMat();
    if (!S.colorsFor(it.mat).some(c => c.name === it.color)) it.color = S.colorsFor(it.mat)[0].name;
  });
  if (active) { renderPanel(); paint(); }
});

// ---------- Поръчка ----------
const orderEl = $('#order-drawer');
const form = $('#checkout-form');
$('#file-note').hidden = !!S.scriptUrl;
const showStep = step => {
  form.hidden = step !== 'form';
  $('#checkout-success').hidden = step !== 'success';
};
$('#to-order').addEventListener('click', () => {
  $('#order-items').innerHTML = items.map(it => `
    <li><span>${esc(it.name)}<small>${esc(t('{mat} · {color} · {infill} · {scale}% · {qty} бр.', { mat: t(materials[it.mat].label), color: colorsOf(it).map(c => t(c)).join(' + '), infill: t(infillOf(it.infill).label), scale: it.scale, qty: it.qty }))}</small></span><strong>${fmt(lineOf(it))}</strong></li>`).join('');
  showStep('form');
  S.openDrawer(orderEl);
});

// Качване на файловете в Google Drive (ако е настроено в config.js → fileUploadUrl)
const toBase64 = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(file);
});
const uploadFiles = async orderNo => {
  const real = items.filter(it => it.file);
  if (!S.scriptUrl || !real.length) return {};
  const files = await Promise.all(real.map(async it => ({ name: it.name, data: await toBase64(it.file) })));
  const res = await fetch(S.scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'files', order: orderNo, files }) });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'upload failed');
  return Object.fromEntries(json.files.map(f => [f.name, f.url]));
};

S.setupCheckout(form, {
  build: async (orderNo, d, setStatus) => {
    if (!items.length) throw new Error('Няма файлове');
    let links = {};
    if (S.scriptUrl) {
      setStatus(t('Качваме файловете…'));
      links = await uploadFiles(orderNo);
    }
    const total = fmt(totalOf());
    const lines = items.map((it, n) => {
      const [x, y, z] = sizeOf(it);
      return `${n + 1}. ${it.name} — ${materials[it.mat].label}, ${colorsOf(it).join(' + ')}, ${infillOf(it.infill).label} (${Math.round(it.infill * 100)}%), размер ${it.scale}% × ${it.qty} бр. = ${fmt(lineOf(it))}`
        + `\n   ${mm(x)} × ${mm(y)} × ${mm(z)} мм · ≈ ${Math.round(weightOf(it))} г/бр.`
        + `\n   Файл: ${links[it.name] || (it.file ? 'клиентът ще го изпрати по имейл или Viber' : 'примерен модел')}`;
    }).join('\n');
    lastTotals = totals();
    return {
      subject: `Поръчка от калкулатора ${orderNo} — ${total}${lastTotals.express ? ' — ЕКСПРЕСНА' : ''}`,
      fields: { 'Модели': lines, ...S.totalsFields(lastTotals), 'Общо': `${total}${lastTotals.freeShip ? ' (доставката е безплатна)' : ' + доставка'} — ориентировъчно, потвърждава се` },
      lines: items.map(it => `${it.name} — ${t(materials[it.mat].label)}, ${colorsOf(it).map(c => t(c)).join(' + ')}, ${it.scale}% × ${it.qty} = ${fmt(lineOf(it))}`),
      amount: lastTotals.total,
      total: total + t(lastTotals.freeShip ? ' (доставката е безплатна)' : ' + доставка') + t(' — ориентировъчно, ще го потвърдим'),
      use: items.map(it => S.useOf(it.mat, colorsOf(it), weightOf(it), it.qty)),
    };
  },
  onSuccess: orderNo => {
    S.afterOrder(lastTotals, orderNo);
    extras.reset();
    renderSummary();
    $('#order-no').textContent = orderNo;
    $('#success-file-note').hidden = !!S.scriptUrl;
    showStep('success');
  },
});

extras = S.mountExtras($('#calc-extras'), () => renderSummary());

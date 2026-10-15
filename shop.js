// Общи функции за каталога и калкулатора: формат на цени, подсказка за материалите,
// форма за доставка и изпращане на поръчката.
window.SLOY_SHOP = (() => {
  const cfg = window.SLOY_CONFIG || {};
  const { materials, materialFamilies, colors, pricing, consumables, colorPrices = {} } = window.SLOY_CATALOG;
  const { t, lang } = window.SLOY_I18N;
  const scriptUrl = cfg.appsScriptUrl || cfg.fileUploadUrl || '';   // Google Apps Script (ако е настроен)
  const $ = (s, el = document) => el.querySelector(s);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => {
    const r = Math.round(n * 100) / 100;
    const s = Number.isInteger(r) ? String(r) : r.toFixed(2);
    return (lang === 'en' ? s : s.replace('.', ',')) + ' €';
  };
  const clampQty = v => Math.max(1, Math.min(99, parseInt(v, 10) || 1));
  // ---------- Склад на филаментите ----------
  // Кои цветове има на склад: листът „Склад“ в Google таблицата (през Apps Script), а без нея — products.js → stock.
  // null = всичко е налично. Отговорът на таблицата се пази 10 минути в браузъра.
  const STOCK_KEY = 'sloy-stock';
  let stock = window.SLOY_CATALOG.stock || null;   // { 'PLA': ['Черен', 'Бял'], … }
  try {
    const c = JSON.parse(localStorage.getItem(STOCK_KEY));
    if (scriptUrl && c?.stock && Date.now() - c.at < 10 * 60 * 1000) stock = c.stock;
  } catch { /* без памет */ }
  if (scriptUrl) {
    fetch(`${scriptUrl}?action=stock`).then(r => r.json()).then(j => {
      if (!j.ok || !j.stock) return;
      stock = j.stock;
      try { localStorage.setItem(STOCK_KEY, JSON.stringify({ at: Date.now(), stock })); } catch { /* без памет */ }
      document.dispatchEvent(new Event('sloy:stock'));   // страниците прерисуват отворените панели
    }).catch(() => { /* таблицата не отговаря — остава последното известно */ });
  }
  const inStock = (mat, name) => !stock || !Object.keys(stock).length || (stock[mat] || []).includes(name);

  // материал със собствен списък (colors) показва само него; останалите — общите цветове (без special)
  // all = и цветовете, които в момента ги няма на склад
  const colorsFor = (mat, all = false) => {
    const own = materials[mat].colors;
    const list = own ? colors.filter(c => own.includes(c.name)) : colors.filter(c => !c.special && (!c.only || c.only.includes(mat)));
    return all ? list : list.filter(c => inStock(mat, c.name));
  };
  // само материалите, от които има поне един цвят на склад
  const available = list => list.filter(m => colorsFor(m).length);
  const previewColor = name => {
    const c = colors.find(x => x.name === name);
    return c ? (c.preview || c.hex) : '#ff6b1a';
  };
  // Цена на брой по формулата от products.js → pricing
  // сглобяване: труд по assemblyPerHour + консумативите
  const assemblyCost = a => (!a ? 0 : (a.minutes || 0) / 60 * pricing.assemblyPerHour
    + Object.entries(a.items || {}).reduce((s, [k, n]) => s + consumables[k].price * n, 0));
  const assemblyItems = (a, translate = true) => Object.entries(a?.items || {})
    .map(([k, n]) => `${translate ? t(consumables[k].name) : consumables[k].name} ×${n}`).join(', ');
  // €/кг за цвета: цената на ролката в 3DLarge (products.js → colorPrices), иначе spool на материала + добавката на цвета
  const spoolFor = (mat, name) => colorPrices[mat]?.[name]
    ?? materials[mat].spool * (1 + (colors.find(c => c.name === name)?.extra || 0));
  // picks = избраните цветове (първият е основният); всеки допълнителен цвят добавя материал (фира при смяна) и време.
  // Без избран цвят (цената „от …“ в каталога) се смята най-евтиният наличен цвят на материала.
  const priceFor = ({ grams, mat, color, picks, hours, assembly }) => {
    const P = pricing;
    const chosen = picks || (color ? [color] : []);
    const more = Math.max(0, chosen.length - 1);
    const cheapest = () => {
      const list = colorsFor(mat).map(c => spoolFor(mat, c.name));
      return list.length ? Math.min(...list) : materials[mat].spool;
    };
    const perKg = chosen.length ? chosen.reduce((s, n) => s + spoolFor(mat, n), 0) / chosen.length : cheapest();
    const material = grams * perKg / 1000 * (1 + P.waste + more * P.multicolorWaste);
    const machine = (hours ?? grams / P.gramsPerHour) * P.machinePerHour * (1 + more * P.multicolorTime);
    return (material + machine + P.handling + assemblyCost(assembly)) * (1 + P.profit);
  };
  const matHTML = m => {
    const x = materials[m];
    return `<strong>${t(x.label)} — ${t(x.tagline)}</strong><span>${t('Най-често за:')} ${t(x.uses)}</span><em>${t(x.note)}</em>`;
  };
  const newOrderNo = () => {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `SL-${stamp}-${Math.floor(100 + Math.random() * 900)}`;
  };

  // ---------- Бутони за материал и цвят ----------
  const chipHTML = (m, selected, name, rec = [], text = t(materials[m].label)) => `
    <label class="mat${rec.includes(m) ? ' rec' : ''}" data-mat="${m}">
      <input type="radio" name="${name}" value="${m}"${m === selected ? ' checked' : ''}>
      <span>${esc(text)}</span>
    </label>`;
  // Избор на два етапа: първо видът (PLA, PETG…), после разновидността (мат, Silk…). Цветовете са отдолу.
  // Всички разновидности са в страницата (едно радио-име), а се вижда само редът на избрания вид.
  // rec = препоръчаните за продукта (отбелязват се със ★)
  const materialsHTML = (list, selected, name, rec = []) => {
    const fams = Object.entries(materialFamilies).map(([id, f]) => [id, f, f.mats.filter(m => list.includes(m))]).filter(([, , ms]) => ms.length);
    const known = new Set(fams.flatMap(([, , ms]) => ms));
    const rest = list.filter(m => !known.has(m));
    if (rest.length) fams.push(['other', { label: 'Други' }, rest]);
    const active = (fams.find(([, , ms]) => ms.includes(selected)) || fams[0])[0];
    // „PLA Мат“ в реда на PLA е просто „Мат“, а самият PLA — „Стандартен“
    const short = (m, f) => {
      const L = t(materials[m].label), F = t(f.label);
      return L === F ? t('Стандартен') : L.startsWith(F + ' ') ? L.slice(F.length + 1) : L;
    };
    return `
      <div class="mat-picker">
        <div class="mat-families" role="group" aria-label="${esc(t('Вид материал'))}">${fams.map(([id, f, ms]) => `
          <button type="button" class="mat-family${id === active ? ' is-active' : ''}" data-family="${id}" aria-pressed="${id === active}">${esc(t(f.label))}${ms.some(m => rec.includes(m)) ? ' <span class="rec-star">★</span>' : ''}</button>`).join('')}
        </div>${fams.map(([id, f, ms]) => `
        <div class="mat-variants" data-family="${id}"${id === active ? '' : ' hidden'}>${ms.map(m => chipHTML(m, selected, name, rec, short(m, f))).join('')}</div>`).join('')}
      </div>`;
  };
  // клик на вид: показва разновидностите му и избира препоръчаната (или първата) — същото събитие change като при ръчен избор
  document.addEventListener('click', e => {
    const b = e.target.closest('.mat-family');
    if (!b) return;
    const picker = b.closest('.mat-picker');
    picker.querySelectorAll('.mat-family').forEach(x => {
      const on = x === b;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-pressed', String(on));
    });
    picker.querySelectorAll('.mat-variants').forEach(r => { r.hidden = r.dataset.family !== b.dataset.family; });
    const row = picker.querySelector(`.mat-variants[data-family="${b.dataset.family}"]`);
    if (row.querySelector('input:checked')) return;
    const input = row.querySelector('.mat.rec input') || row.querySelector('input');
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // вид в 3D: прозрачните цветове правят модела полупрозрачен
  const finishFor = (mat, colorName) => {
    const clear = colors.find(c => c.name === colorName)?.clear;
    return { ...materials[mat].finish, opacity: clear ? 0.6 : 1 };
  };
  const swatchesHTML = (mat, selected, name) => colorsFor(mat).map(c => `
    <label class="swatch" title="${esc(t(c.name))}">
      <input type="radio" name="${name}" value="${esc(c.name)}"${c.name === selected ? ' checked' : ''} aria-label="${esc(t(c.name))}">
      <span style="--c:${c.hex}"></span>
    </label>`).join('');

  // ---------- Многоцветен печат ----------
  // не повече цветове от наличните за материала, нито от колкото позволява моделът (cap = product.maxColors)
  const maxColorsFor = (mat, cap = pricing.maxColors || 4) => Math.max(1, Math.min(pricing.maxColors || 4, cap, colorsFor(mat).length));
  const ncolorsHTML = (n, name, mat, cap) => Array.from({ length: mat ? maxColorsFor(mat, cap) : pricing.maxColors || 4 }, (_, i) => i + 1).map(k => `
    <label class="chip"><input type="radio" name="${name}" value="${k}"${k === n ? ' checked' : ''}><span>${k === 1 ? t('1 цвят') : t('{n} цвята', { n: k })}</span></label>`).join('');
  // допълнителните цветове — налични за материала и различни от основния
  const fitExtra = (mat, main, extra, n) => {
    const list = colorsFor(mat).map(c => c.name);
    const out = [];
    for (let i = 0; i < n - 1; i++) {
      const keep = list.includes(extra[i]) ? extra[i] : null;
      out.push(keep || list.find(x => x !== main && !out.includes(x) && !extra.slice(i + 1).includes(x)) || list[0]);
    }
    return out;
  };
  const extraColorsHTML = (mat, extra, prefix) => extra.map((c, i) => `
    <div class="extra-color" data-idx="${i}">
      <div class="opt-head"><span>${t('Цвят {n}', { n: i + 2 })}</span><span class="opt-value">${esc(t(c))}</span></div>
      <div class="swatches">${swatchesHTML(mat, c, `${prefix}-${i + 2}`)}</div>
    </div>`).join('') + (extra.length ? `<p class="opt-note">${t('Как да разпределим цветовете — напиши в бележката.')}</p>` : '');

  // ---------- Експресна изработка, промокодове и отстъпки ----------
  const CODE_KEY = 'sloy-code';
  let appliedCode = (() => { try { return JSON.parse(localStorage.getItem(CODE_KEY)); } catch { return null; } })();
  const saveCode = c => {
    appliedCode = c;
    try { if (c) localStorage.setItem(CODE_KEY, JSON.stringify(c)); else localStorage.removeItem(CODE_KEY); } catch { /* без памет */ }
  };
  const today = () => new Date().toISOString().slice(0, 10);
  // проверка на код: през Google таблицата (ако е настроена — тя брои и използванията), иначе от products.js
  const checkCode = async input => {
    const code = input.trim().toUpperCase();
    if (!code) return { ok: false, reason: 'empty' };
    if (scriptUrl) {
      try {
        const j = await (await fetch(`${scriptUrl}?action=code&code=${encodeURIComponent(code)}`)).json();
        return j.ok ? { ok: true, code, type: j.type, value: +j.value, minOrder: +j.minOrder || 0 } : { ok: false, reason: j.reason || 'invalid' };
      } catch { /* таблицата не отговаря — пробваме списъка в products.js */ }
    }
    const c = (window.SLOY_CATALOG.promoCodes || []).find(x => x.code.toUpperCase() === code);
    if (!c) return { ok: false, reason: 'invalid' };
    if (c.validFrom && today() < c.validFrom) return { ok: false, reason: 'notyet' };
    if (c.validTo && today() > c.validTo) return { ok: false, reason: 'expired' };
    return { ok: true, code, type: c.type, value: c.value, minOrder: c.minOrder || 0 };
  };
  const REASONS = {
    empty: 'Въведи код.', invalid: 'Няма такъв код.', expired: 'Кодът е изтекъл.',
    notyet: 'Кодът още не е активен.', used: 'Кодът е използван максималния брой пъти.',
  };
  // сума → + експресна → − по-голямата отстъпка (код или първа поръчка) → минимална поръчка
  const totals = (subtotal, express = false) => {
    const exp = express ? Math.round(subtotal * pricing.expressRate * 100) / 100 : 0;
    const base = subtotal + exp;
    const first = Math.round(base * (window.SLOY_PROMO?.rate() || 0) * 100) / 100;
    const codeOk = appliedCode && base >= (appliedCode.minOrder || 0);
    const code = !codeOk ? 0 : appliedCode.type === 'fixed'
      ? Math.min(base, appliedCode.value) : Math.round(base * appliedCode.value) / 100;
    const discount = Math.max(code, first);
    const net = base - discount;
    return {
      subtotal, express: exp, discount, net,
      kind: !discount ? null : code >= first ? 'code' : 'first',
      code: appliedCode, codeBelowMin: !!appliedCode && !codeOk,
      total: subtotal ? Math.max(pricing.minOrder, net) : 0,
      belowMin: subtotal > 0 && net < pricing.minOrder,
      freeShip: !!pricing.freeShippingFrom && subtotal > 0 && net >= pricing.freeShippingFrom,
      toFree: Math.max(0, (pricing.freeShippingFrom || 0) - net),
    };
  };
  const sumLinesHTML = tt => [
    tt.express ? `<p><span>${t('Експресна изработка')}</span><strong>+${fmt(tt.express)}</strong></p>` : '',
    tt.discount ? `<p class="disc"><span>${tt.kind === 'code' ? t('Промокод {code}', { code: tt.code.code }) : t('Отстъпка за първа поръчка')}</span><strong>−${fmt(tt.discount)}</strong></p>` : '',
    tt.codeBelowMin ? `<p class="warn">${t('Кодът важи за поръчки над {min}.', { min: fmt(tt.code.minOrder) })}</p>` : '',
    tt.belowMin ? `<p class="warn">${t('Минималната поръчка е {min} — сметнахме {min} вместо {sub}.', { min: fmt(pricing.minOrder), sub: fmt(tt.net) })}</p>` : '',
    !pricing.freeShippingFrom || !tt.subtotal ? '' : tt.freeShip
      ? `<p class="ship ok">🚚 ${t('Безплатна доставка')}</p>`
      : `<p class="ship">🚚 ${t('Още {amount} до безплатна доставка', { amount: fmt(tt.toFree) })}</p>`,
  ].join('');
  // полета за имейла с поръчката (на български)
  const totalsFields = tt => ({
    'Доставка за сметка на': tt.freeShip ? `SLOY 3D (поръчка над ${fmt(pricing.freeShippingFrom)})` : 'клиента',
    ...(tt.express ? { 'Експресна': `ДА — до ${pricing.expressDays} работни дни (+${fmt(tt.express)})` } : {}),
    ...(tt.discount ? { 'Отстъпка': tt.kind === 'code'
      ? `Промокод ${tt.code.code}: −${fmt(tt.discount)}`
      : `Първа поръчка: −${fmt(tt.discount)} (pop-up: ${window.SLOY_PROMO.info().name}, ${window.SLOY_PROMO.info().email})` } : {}),
  });
  // след изпратена поръчка: отбелязва използваната отстъпка / кода
  const afterOrder = (tt, orderNo) => {
    if (!tt?.discount) return;
    if (tt.kind === 'first') window.SLOY_PROMO.markUsed();
    if (tt.kind === 'code') {
      if (scriptUrl) fetch(scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'useCode', code: tt.code.code, order: orderNo }) }).catch(() => {});
      saveCode(null);
    }
  };
  // кутията „Експресна изработка + промокод“ в количката и калкулатора
  const mountExtras = (box, onChange) => {
    box.innerHTML = `
      <label class="check">
        <input type="checkbox" data-express>
        <span><strong>${t('⚡ Експресна изработка')}</strong> ${t('до {days} работни дни · +{pct}%', { days: pricing.expressDays, pct: Math.round(pricing.expressRate * 100) })}</span>
      </label>
      <div class="code-row">
        <input data-code placeholder="${t('Промокод')}" aria-label="${t('Промокод')}" autocomplete="off" spellcheck="false">
        <button type="button" class="btn btn-ghost btn-sm" data-code-apply>${t('Приложи')}</button>
      </div>
      <p class="code-status" data-code-status role="status" aria-live="polite"></p>
      <div class="sum-lines" data-sum-lines></div>`;
    const input = $('[data-code]', box);
    const status = $('[data-code-status]', box);
    const say = (msg, kind) => { status.textContent = msg; status.className = 'code-status ' + kind; };
    if (appliedCode) { input.value = appliedCode.code; say(t('Код {code} е приложен.', { code: appliedCode.code }), 'ok'); }
    const apply = async () => {
      say(t('Проверяваме…'), '');
      const r = await checkCode(input.value);
      if (r.ok) {
        saveCode({ code: r.code, type: r.type, value: r.value, minOrder: r.minOrder });
        say(t('Код {code} е приложен.', { code: r.code }), 'ok');
      } else {
        saveCode(null);
        say(t(REASONS[r.reason] || REASONS.invalid), 'err');
      }
      onChange();
    };
    $('[data-code-apply]', box).addEventListener('click', apply);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    $('[data-express]', box).addEventListener('change', onChange);
    return {
      express: () => $('[data-express]', box).checked,
      reset: () => { $('[data-express]', box).checked = false; input.value = ''; say('', ''); },
    };
  };

  // ---------- Подсказка при задържане на мишката (материал, размер) ----------
  const tip = $('#mat-tip');
  const hideTip = () => { if (tip) tip.hidden = true; };
  const showTip = (label, html) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = label.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2));
    let y = r.top - th - 12;
    const below = y < 8;
    if (below) y = r.bottom + 12;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.setProperty('--ax', (r.left + r.width / 2 - x) + 'px');
    tip.classList.toggle('below', below);
  };
  let tipTimer;
  // selector = елементите с подсказка в container, html(елемент) = съдържанието ѝ
  const bindTips = (container, selector, html, scroller = window) => {
    if (!tip) return;
    scroller.addEventListener('scroll', hideTip, { passive: true });
    if (!matchMedia('(hover: hover)').matches) {
      // телефон: подсказката излиза за няколко секунди, когато избереш
      container.addEventListener('change', e => {
        const l = e.target.closest(selector);
        if (!l) return;
        showTip(l, html(l));
        clearTimeout(tipTimer);
        tipTimer = setTimeout(hideTip, 3500);
      });
      return;
    }
    container.addEventListener('mouseover', e => { const l = e.target.closest(selector); if (l) showTip(l, html(l)); });
    container.addEventListener('mouseleave', hideTip);
    container.addEventListener('focusin', e => { const l = e.target.closest(selector); if (l && e.target.matches(':focus-visible')) showTip(l, html(l)); });
    container.addEventListener('focusout', hideTip);
  };
  const bindMaterialTips = (container, scroller) => bindTips(container, '.mat', l => matHTML(l.dataset.mat), scroller);

  // ---------- Изпращане ----------
  // 1) Google таблицата (Apps Script): записва поръчката в таблото и праща имейлите — до нас и потвърждение до клиента.
  // 2) Без нея или ако не отговаря — Web3Forms. 3) Без ключ — имейл програмата на клиента с готово съобщение.
  // fields = полетата за нашия имейл (на български); extra = { customer, amount } за таблицата.
  // Връща { order } — номера, с който е записана (таблицата сменя номера, ако е зает).
  const sendOrder = async (subject, fields, replyTo, extra = {}) => {
    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'order', order: fields['Поръчка'], subject, lang, fields, ...extra }) });
        const j = await res.json();
        if (j.ok) return { order: j.order || fields['Поръчка'] };
      } catch { /* таблицата не отговаря — пращаме по имейл */ }
    }
    if (!cfg.web3formsKey) {
      const body = Object.entries(fields)
        .map(([k, v]) => String(v).includes('\n') ? `\n${k}:\n${v}\n` : `${k}: ${v}`)
        .join('\n');
      location.href = `mailto:${cfg.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return { order: fields['Поръчка'] };
    }
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: cfg.web3formsKey, subject, from_name: 'SLOY 3D — сайт',
        ...(replyTo ? { replyto: replyTo } : {}), ...fields,
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message || 'Web3Forms error');
    return { order: fields['Поръчка'] };
  };

  // ---------- Форма за доставка ----------
  // build(orderNo, data) връща { subject, fields, lines, total, amount } (може и async — напр. качване на файлове).
  // lines / total = продуктите и сумата на езика на клиента — за потвърждението, което получава по имейл.
  const setupCheckout = (form, { build, onSuccess }) => {
    const status = $('.form-status', form);
    const submitBtn = $('button[type=submit]', form);
    const setStatus = (msg, kind = '') => { status.textContent = msg; status.className = 'form-status ' + kind; };

    form.addEventListener('change', e => {
      if (e.target.name !== 'delivery') return;
      const toAddress = e.target.value === 'До адрес';
      $('[data-address-label]', form).textContent = t(toAddress ? 'Адрес *' : 'Офис *');
      form.address.placeholder = t(toAddress ? 'улица, номер, вход, етаж' : 'напр. офис Младост 1');
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      form.classList.add('tried');
      if (!form.checkValidity()) {
        setStatus(t('Попълни полетата, отбелязани със звездичка.'), 'err');
        $(':invalid', form)?.focus();
        return;
      }
      const d = Object.fromEntries(new FormData(form));
      if (d.botcheck) return;

      const orderNo = newOrderNo();
      submitBtn.disabled = true;
      try {
        const { subject, fields, lines = [], total = '', amount } = await build(orderNo, d, setStatus);
        setStatus(t('Изпращаме…'));
        const sent = await sendOrder(subject, {
          'Поръчка': orderNo,
          'Име': d.name,
          'Телефон': d.phone,
          'Имейл': d.email || '—',
          'Доставка': d.delivery,
          'Град': d.city,
          'Офис / адрес': d.address,
          'Плащане': d.payment,
          'Бележка': d.note || '—',
          ...(lang === 'en' ? { 'Език': 'English — отговори на английски' } : {}),
          ...fields,
        }, d.email, {
          amount,
          customer: { lines, total, delivery: t(d.delivery), address: `${d.city} — ${d.address}`, payment: t(d.payment) },
        });
        form.reset();
        form.classList.remove('tried');
        setStatus('');
        onSuccess(sent.order);
      } catch {
        setStatus(t('Не успяхме да изпратим поръчката. Опитай пак или ни пиши във Viber.'), 'err');
      } finally {
        submitBtn.disabled = false;
      }
    });
  };

  // ---------- Известие ----------
  const toastEl = $('#toast');
  let toastTimer;
  const toast = (msg, action) => {
    if (!toastEl) return;
    toastEl.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" data-open-cart>${esc(action)}</button>` : ''}`;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3800);
  };
  toastEl?.addEventListener('click', e => { if (e.target.closest('button')) toastEl.classList.remove('show'); });

  // ---------- Странични панели ----------
  let lastFocus = null;
  const openDrawer = d => {
    lastFocus = document.activeElement;
    d.hidden = false;
    $('.drawer-panel', d).scrollTop = 0;
    document.body.classList.add('locked');
    $('.drawer-close', d).focus({ preventScroll: true });
    d.dispatchEvent(new Event('drawer:open'));
  };
  const closeDrawer = d => {
    d.hidden = true;
    hideTip();
    if (![...document.querySelectorAll('.drawer')].some(x => !x.hidden)) document.body.classList.remove('locked');
    d.dispatchEvent(new Event('drawer:close'));
    lastFocus?.focus?.({ preventScroll: true });
  };
  document.querySelectorAll('.drawer').forEach(d => d.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) closeDrawer(d);
  }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.drawer')].filter(d => !d.hidden).pop();
    if (open) closeDrawer(open);
  });

  return {
    cfg, scriptUrl, t, lang, pricing, priceFor, assemblyItems,
    ncolorsHTML, maxColorsFor, fitExtra, extraColorsHTML, totals, sumLinesHTML, totalsFields, afterOrder, mountExtras, esc, fmt, clampQty, colorsFor, available, previewColor, matHTML, newOrderNo,
    materialsHTML, swatchesHTML, finishFor, bindMaterialTips, bindTips, hideTip,
    sendOrder, setupCheckout, toast, openDrawer, closeDrawer,
  };
})();

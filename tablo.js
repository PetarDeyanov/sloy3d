// Табло: поръчки, запитвания, склад и промокодове от Google таблицата (през Apps Script).
// Влиза се с ключа от таблицата (меню SLOY 3D → Ключ за таблото). Всичко идва с една заявка (action 'data').
(() => {
  const S = window.SLOY_SHOP;
  const { materials } = window.SLOY_CATALOG;
  const { esc, fmt } = S;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const url = S.cfg.appsScriptUrl || '';
  const KEY = 'sloy-admin';
  const REFRESH = 90 * 1000;   // проверка за нови поръчки, докато таблото е отворено
  let key = (() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } })();
  let D = { orders: [], leads: [], stock: [], codes: [], statuses: [], leadStatuses: [], minGrams: 50, mailQuota: null, econt: { live: false } };
  let pending = null;          // по-нови данни, които чакат „Покажи“ (за да не изчезне нещо, което пишеш)
  let checkedAt = 0;
  const view = { orders: 'all', leads: 'all', orderQuery: '', leadQuery: '' };
  const dirty = { stock: false, codes: false };

  const api = async (action, extra = {}) => {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, key, ...extra }) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Грешка');
    return j;
  };
  const show = id => ['setup', 'login', 'panel'].forEach(x => { $('#' + x).hidden = x !== id; });
  const logout = msg => {
    key = '';
    try { localStorage.removeItem(KEY); } catch { /* без памет */ }
    $('#logout').hidden = true;
    show('login');
    $('#login .form-status').textContent = msg || '';
  };
  const failed = err => { if (/ключ/i.test(err.message)) logout(err.message); return err.message; };

  // ---------- Вход ----------
  // ключът е xxxx-xxxx-xxxx-xxxx (малки латински букви и цифри). Поправяме главни букви, интервали, липсващи тирета,
  // кирилски букви, които изглеждат като латинските, и цял ред, копиран от „Execution log“ („Ключ за таблото: …“)
  const LOOK = { 'а': 'a', 'в': 'b', 'е': 'e', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x' };
  const cleanKey = s => {
    const t = String(s).toLowerCase().replace(/[а-я]/g, c => LOOK[c] || c).replace(/\s+/g, '');
    const all = [...t.matchAll(/([a-z0-9]{4})-?([a-z0-9]{4})-?([a-z0-9]{4})-?([a-z0-9]{4})/g)];
    return all.length ? all[all.length - 1].slice(1).join('-') : t;
  };
  const loginForm = $('#login-form');
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const st = $('.form-status', loginForm);
    key = cleanKey(loginForm.key.value);
    if (!key) { st.textContent = 'Въведи ключа.'; return; }
    st.textContent = 'Проверяваме…';
    try {
      await api('login');
      try { localStorage.setItem(KEY, key); } catch { /* без памет — ще питаме пак */ }
      loginForm.reset();
      st.textContent = '';
      start();
    } catch (err) {
      st.textContent = err.message;
    }
  });
  $('#logout').addEventListener('click', () => {
    if ((dirty.stock || dirty.codes) && !window.confirm('Има незапазени промени. Изход без тях?')) return;
    logout();
  });

  // ---------- Табове ----------
  const TABS = ['orders', 'leads', 'stock', 'codes'];
  $$('.tool-tabs [role=tab]').forEach(b => b.addEventListener('click', () => {
    $$('.tool-tabs [role=tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    TABS.forEach(tab => { $('#tab-' + tab).hidden = b.dataset.tab !== tab; });
  }));

  // ---------- Помощни ----------
  const ORDER_CLASS = { 'Приета': 'new', 'Печата се': 'printing', 'Изпратена': 'sent', 'Получена': 'done', 'Отказана': 'cancelled' };
  const LEAD_CLASS = { 'Ново': 'new', 'Отговорено': 'printing', 'Приключено': 'done' };
  const has = v => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '—';
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || '').trim());
  // 0888 123 456 → +359888123456 (за Viber)
  const intl = s => {
    let d = String(s || '').replace(/[^\d+]/g, '');
    if (d.startsWith('00')) d = '+' + d.slice(2);
    else if (d.startsWith('0')) d = '+359' + d.slice(1);
    else if (!d.startsWith('+') && d.length === 9) d = '+359' + d;
    return d;
  };
  const phoneLinks = p => `<a href="tel:${esc(intl(p))}">${esc(p)}</a> · <a href="viber://chat?number=${encodeURIComponent(intl(p))}">Viber</a>`;
  // текст с линкове (файловете в Drive, моделите в MakerWorld)
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u.length > 60 ? u.slice(0, 57) + '…' : u}</a>`);
  const chips = (name, list, current, count) => ['all', ...list].map(s => `
    <label class="chip"><input type="radio" name="${name}" value="${esc(s)}"${s === current ? ' checked' : ''}><span>${s === 'all' ? 'Всички' : esc(s)} · ${count(s)}</span></label>`).join('');
  const setCount = (id, n) => { $(id).textContent = n || ''; $(id).hidden = !n; };

  // ---------- Данни ----------
  const apply = j => {
    D = { ...D, ...j };
    pending = null;
    $('#fresh').hidden = true;
    renderStats();
    renderOrders();
    renderLeads();
    if (!dirty.stock) renderStock();
    if (!dirty.codes) renderCodes();
  };
  const load = async () => {
    $('#orders').innerHTML = '<p class="admin-empty">Зареждаме…</p>';
    try {
      const j = await api('data');
      checkedAt = Date.now();
      apply(j);
    } catch (err) {
      $('#orders').innerHTML = `<p class="admin-empty err">Не успяхме да заредим таблото: ${esc(failed(err))}</p>`;
    }
  };
  // тиха проверка: нови поръчки или запитвания → лента „Покажи“
  const check = async () => {
    if (!key || document.visibilityState !== 'visible' || Date.now() - checkedAt < REFRESH - 5000) return;
    checkedAt = Date.now();
    try {
      const j = await api('data');
      const known = new Set([...D.orders.map(o => o['Поръчка']), ...D.leads.map(l => l['Номер'])]);
      const newOrders = j.orders.filter(o => !known.has(o['Поръчка'])).length;
      const newLeads = j.leads.filter(l => !known.has(l['Номер'])).length;
      if (!newOrders && !newLeads) return;
      pending = j;
      $('#fresh-text').textContent = [newOrders && `${newOrders} нов${newOrders > 1 ? 'и поръчки' : 'а поръчка'}`, newLeads && `${newLeads} ново запитване`].filter(Boolean).join(' и ');
      $('#fresh').hidden = false;
      document.title = `(${newOrders + newLeads}) Табло — SLOY 3D`;
      S.toast($('#fresh-text').textContent);
    } catch { /* без връзка — следващия път */ }
  };
  $('#fresh-show').addEventListener('click', () => { if (pending) apply(pending); document.title = 'Табло — SLOY 3D'; });
  $$('[data-refresh]').forEach(b => b.addEventListener('click', load));
  setInterval(check, REFRESH);
  document.addEventListener('visibilitychange', check);

  // ---------- Статистика ----------
  const renderStats = () => {
    const n = s => D.orders.filter(o => o['Статус'] === s).length;
    const now = new Date();
    const month = D.orders.filter(o => {
      const d = new Date(o._ts || 0);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && o['Статус'] !== 'Отказана';
    });
    const sum = month.reduce((s, o) => s + (Number(o['Сума €']) || 0), 0);
    const freshLeads = D.leads.filter(l => l['Статус'] === D.leadStatuses[0]).length;
    const box = (label, value, cls = '') => `<div class="stat ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
    $('#stats').innerHTML = [
      box('Нови поръчки', n('Приета'), n('Приета') ? 'hot' : ''),
      box('За печат', n('Печата се')),
      box('Изпратени', n('Изпратена')),
      box('Този месец', `${fmt(sum)} <small>· ${month.length} бр.</small>`),
      box('Нови запитвания', freshLeads, freshLeads ? 'hot' : ''),
      D.mailQuota !== null && D.mailQuota !== undefined ? box('Имейли днес', `още ${D.mailQuota}`) : '',
    ].join('');
    setCount('#count-orders', n('Приета'));
    setCount('#count-leads', freshLeads);
    if (!pending) document.title = 'Табло — SLOY 3D';
  };

  // ---------- Поръчки ----------
  const extraLines = o => ['Отстъпка', 'Експресна', 'Доставка за сметка на']
    .filter(k => has(o[k]) && o[k] !== 'клиента')
    .map(k => `<p><strong>${k}:</strong> ${esc(o[k])}</p>`).join('');
  const orderHTML = o => `
    <article class="order-card st-${ORDER_CLASS[o['Статус']] || 'new'}" data-order="${esc(o['Поръчка'])}">
      <header class="order-top">
        <strong class="order-no">${esc(o['Поръчка'])}</strong>
        <span class="order-status">${esc(o['Статус'])}</span>
        <span class="order-date">${esc(o['Дата'])}</span>
        <strong class="order-total">${esc(o['Общо'])}</strong>
      </header>
      <p class="order-who"><strong>${esc(o['Име'])}</strong> · ${phoneLinks(o['Телефон'])}${isEmail(o['Имейл']) ? ` · <a href="mailto:${esc(o['Имейл'])}">${esc(o['Имейл'])}</a>` : ''}${o['Език'] === 'EN' ? ' · <span class="tag">EN</span>' : ''}${has(o['Експресна']) ? ' · <span class="tag tag-hot">⚡ Експресна</span>' : ''}${/превод/i.test(o['Плащане']) && o['Статус'] === 'Приета' ? ' · <span class="tag tag-bank">💳 Банков превод — провери плащането</span>' : ''}</p>
      <p class="order-ship">${esc(o['Доставка'])}, ${esc(o['Град'])} — ${esc(o['Офис / адрес'])} · ${esc(o['Плащане'])}</p>
      ${has(o['Бележка']) ? `<p class="order-cnote">„${esc(o['Бележка'])}“</p>` : ''}
      <details class="order-items-box"${o['Статус'] === 'Приета' ? ' open' : ''}>
        <summary>Продукти</summary>
        <pre>${linkify(o['Продукти'])}</pre>
        ${extraLines(o)}
      </details>
      <div class="order-actions">
        <select data-status aria-label="Статус">${D.statuses.map(s => `<option${s === o['Статус'] ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <input data-tracking value="${esc(o['Товарителница'] || '')}" placeholder="Товарителница" aria-label="Товарителница">
        <input class="order-mynote" data-note value="${esc(o['Моя бележка'] || '')}" placeholder="Моя бележка (вижда се само тук)" aria-label="Моя бележка">
        <button class="btn btn-primary btn-sm" type="button" data-save>Запази</button>
        <button class="btn btn-ghost btn-sm" type="button" data-write>Пиши на клиента</button>
        <span class="admin-msg" role="status"></span>
      </div>
      ${has(o['Писано на клиента']) ? `<p class="order-written">✉ Писано на клиента: ${esc(o['Писано на клиента'])}</p>` : ''}
      ${econtRowHTML(o)}
      <div class="order-compose" hidden></div>
      <div class="order-econt" hidden></div>
    </article>`;
  const renderOrders = () => {
    const count = s => (s === 'all' ? D.orders.length : D.orders.filter(o => o['Статус'] === s).length);
    $('#order-filters').innerHTML = chips('order-filter', D.statuses, view.orders, count);
    const q = view.orderQuery.trim().toLowerCase();
    const list = D.orders.filter(o => (view.orders === 'all' || o['Статус'] === view.orders)
      && (!q || [o['Поръчка'], o['Име'], o['Телефон'], o['Имейл'], o['Град'], o['Товарителница'], o['Моя бележка']].join(' ').toLowerCase().includes(q)));
    $('#orders').innerHTML = list.length ? list.map(orderHTML).join('')
      : `<p class="admin-empty">${D.orders.length ? 'Няма поръчки тук.' : 'Още няма поръчки. Щом някой поръча, ще я видиш тук и ще получиш имейл.'}</p>`;
  };

  // текст до клиента според статуса — на езика, на който е поръчал
  const message = (o, status) => {
    const en = o['Език'] === 'EN';
    const name = String(o['Име'] || '').trim().split(/\s+/)[0];
    const no = o['Поръчка'];
    const courier = /Спиди/.test(o['Доставка']) ? (en ? 'Speedy' : 'Спиди') : /Еконт/.test(o['Доставка']) ? (en ? 'Econt' : 'Еконт') : (en ? 'courier' : 'куриер');
    const tr = o['Товарителница'];
    const track = /Еконт/.test(courier + o['Доставка']) || has(o['Етикет']) ? trackUrl(tr) : '';
    const text = {
      'Приета': en ? `We've received your order ${no}. We'll let you know when it ships.` : `Получихме поръчката ти ${no}. Ще ти пишем, когато тръгне към теб.`,
      'Печата се': en ? `Your order ${no} is being printed right now. We'll let you know as soon as it ships.` : `Поръчката ти ${no} вече се печата. Ще ти пишем, щом тръгне към теб.`,
      'Изпратена': en ? `Your order ${no} has been shipped with ${courier}.${tr ? ` Tracking number: ${tr}.` : ''}${track ? ` Track it here: ${track}` : ''} Thank you!` : `Поръчката ти ${no} е изпратена с ${courier}.${tr ? ` Товарителница: ${tr}.` : ''}${track ? ` Проследи я тук: ${track}` : ''} Благодарим ти!`,
      'Получена': en ? `Thank you for your order ${no}! We hope you like it — we'd love to see a photo.` : `Благодарим ти за поръчка ${no}! Надяваме се да ти харесва — ще се радваме на снимка.`,
      'Отказана': en ? `Unfortunately we can't fulfil order ${no}. We'll get in touch with the details.` : `За съжаление не можем да изпълним поръчка ${no}. Ще ти пишем с подробности.`,
    }[status] || '';
    return {
      subject: en ? `Your SLOY 3D order ${no}` : `Поръчка ${no} — SLOY 3D`,
      body: `${en ? 'Hi' : 'Здравей'}, ${name}!\n\n${text}\n\nSLOY 3D`,
    };
  };
  const composeHTML = (o, m) => `
    <label class="field"><span>Тема</span><input data-subj value="${esc(m.subject)}"></label>
    <label class="field"><span>Текст${o['Език'] === 'EN' ? ' (клиентът е поръчал на английски)' : ''}</span><textarea data-body rows="6">${esc(m.body)}</textarea></label>
    <div class="order-actions">
      ${isEmail(o['Имейл']) ? '<button class="btn btn-primary btn-sm" type="button" data-send>Изпрати имейл</button>' : '<span class="admin-msg">Няма имейл — прати текста във Viber.</span>'}
      <button class="btn btn-ghost btn-sm" type="button" data-copy>Копирай за Viber</button>
      <a class="btn btn-ghost btn-sm" href="viber://chat?number=${encodeURIComponent(intl(o['Телефон']))}">Отвори Viber</a>
      <button class="btn btn-ghost btn-sm" type="button" data-close>Затвори</button>
    </div>`;

  const saveOrder = async (card, o) => {
    const status = $('[data-status]', card).value;
    const tracking = $('[data-tracking]', card).value.trim();
    const note = $('[data-note]', card).value.trim();
    await api('status', { order: o['Поръчка'], status, tracking, note });
    Object.assign(o, { 'Статус': status, 'Товарителница': tracking, 'Моя бележка': note });
    card.className = `order-card st-${ORDER_CLASS[status] || 'new'}`;
    $('.order-status', card).textContent = status;
    renderStats();
    $('#order-filters').innerHTML = chips('order-filter', D.statuses, view.orders,
      s => (s === 'all' ? D.orders.length : D.orders.filter(x => x['Статус'] === s).length));
  };

  $('#orders').addEventListener('click', async e => {
    const card = e.target.closest('.order-card');
    if (!card) return;
    const o = D.orders.find(x => x['Поръчка'] === card.dataset.order);
    const msg = $('.order-actions .admin-msg', card);
    const box = $('.order-compose', card);
    if (e.target.closest('[data-save]')) {
      msg.textContent = 'Записваме…';
      try {
        await saveOrder(card, o);
        msg.textContent = 'Запазено ✓';
        if ($('[data-status]', card).value !== 'Приета' && isEmail(o['Имейл']) && box.hidden) msg.textContent = 'Запазено ✓ — прати и съобщение на клиента?';
      } catch (err) {
        msg.textContent = failed(err);
      }
    }
    if (e.target.closest('[data-write]')) {
      box.innerHTML = composeHTML(o, { ...message({ ...o, 'Товарителница': $('[data-tracking]', card).value.trim() }, $('[data-status]', card).value) });
      box.dataset.edited = '';
      box.hidden = false;
      $('[data-body]', box).focus();
    }
    if (e.target.closest('[data-close]')) box.hidden = true;
    if (e.target.closest('[data-copy]')) {
      const ta = $('[data-body]', box);
      try {
        await navigator.clipboard.writeText(ta.value);
        msg.textContent = 'Текстът е копиран — постави го във Viber.';
      } catch {
        ta.select();
        msg.textContent = 'Маркирах текста — копирай го (Ctrl+C).';
      }
    }
    if (e.target.closest('[data-send]')) {
      const btn = e.target.closest('[data-send]');
      btn.disabled = true;
      msg.textContent = 'Изпращаме…';
      try {
        if ($('[data-status]', card).value !== o['Статус'] || $('[data-tracking]', card).value.trim() !== (o['Товарителница'] || '')) await saveOrder(card, o);
        const j = await api('notify', { order: o['Поръчка'], subject: $('[data-subj]', box).value, body: $('[data-body]', box).value });
        o['Писано на клиента'] = j.written;
        let w = $('.order-written', card);
        if (!w) { w = document.createElement('p'); w.className = 'order-written'; box.before(w); }
        w.textContent = `✉ Писано на клиента: ${j.written}`;
        box.hidden = true;
        msg.textContent = `Имейлът до ${o['Имейл']} е изпратен ✓`;
        if (typeof D.mailQuota === 'number') { D.mailQuota -= 1; renderStats(); }
      } catch (err) {
        msg.textContent = failed(err);
      } finally {
        btn.disabled = false;
      }
    }
  });
  // смяна на статуса при отворено съобщение → нов текст, ако още не е пипан
  $('#orders').addEventListener('change', e => {
    if (!e.target.matches('[data-status]')) return;
    const card = e.target.closest('.order-card');
    const box = $('.order-compose', card);
    if (box.hidden || box.dataset.edited) return;
    const o = D.orders.find(x => x['Поръчка'] === card.dataset.order);
    box.innerHTML = composeHTML(o, message({ ...o, 'Товарителница': $('[data-tracking]', card).value.trim() }, e.target.value));
  });
  $('#orders').addEventListener('input', e => {
    if (e.target.matches('[data-body], [data-subj]')) e.target.closest('.order-compose').dataset.edited = '1';
  });
  $('#order-filters').addEventListener('change', e => { view.orders = e.target.value; renderOrders(); });
  $('#order-search').addEventListener('input', e => { view.orderQuery = e.target.value; renderOrders(); });

  // ---------- Еконт: товарителница ----------
  const isWaybill = s => /^\d{8,}$/.test(String(s || '').trim());
  const trackUrl = n => (isWaybill(n) ? `https://www.econt.com/services/track-shipment/${String(n).trim()}` : '');
  const econtFor = o => /Еконт/.test(o['Доставка']) || o['Доставка'] === 'До адрес' || has(o['Еконт офис']);
  const econtRowHTML = o => {
    if (!econtFor(o)) return '';
    if (!isWaybill(o['Товарителница'])) return `<div class="econt-row"><button class="btn btn-ghost btn-sm" type="button" data-econt>📦 Товарителница Еконт</button></div>`;
    return `<div class="econt-row">📦 <strong>${esc(o['Товарителница'])}</strong>
      ${has(o['Етикет']) ? `<a class="btn btn-primary btn-sm" href="${esc(o['Етикет'])}" target="_blank" rel="noopener">Етикет за печат (PDF)</a>` : ''}
      <a class="btn btn-ghost btn-sm" href="${esc(trackUrl(o['Товарителница']))}" target="_blank" rel="noopener">Проследи</a>
      <button class="btn btn-ghost btn-sm" type="button" data-econt-status>Статус</button>
      <button class="btn btn-ghost btn-sm" type="button" data-econt-delete>Изтрий</button>
      <span class="admin-msg" data-econt-msg></span></div>`;
  };
  // тегло за товарителницата: грамовете от „Продукти“ (≈ N г/бр. × брой) + ~150 г опаковка; без данни — 0,5 кг
  const weightOf = o => {
    let g = 0;
    for (const m of String(o['Продукти'] || '').matchAll(/× (\d+)[^≈]*?≈ (\d+) г\/бр/g)) g += m[1] * m[2];
    return g ? Math.max(0.1, Math.round((g + 150) / 100) / 10) : 0.5;
  };
  let econtCities = null;
  const econtBoxHTML = (o, offices) => {
    const toAddress = o['Доставка'] === 'До адрес' && !has(o['Еконт офис']);
    const office = offices.find(x => x.code === String(o['Еконт офис'] || ''));
    const city = office ? office.city : String(o['Град'] || '').replace(/\s*\d{4}$/, '');
    const pc = has(o['Пощ. код']) ? o['Пощ. код'] : (String(o['Град'] || '').match(/(\d{4})$/) || [])[1] || '';
    const cod = /Наложен/.test(o['Плащане']) ? Number(o['Сума €']) || 0 : 0;
    return `
      ${D.econt.live ? '' : '<p class="econt-test">ТЕСТОВ РЕЖИМ — товарителниците отиват в тестовата система на Еконт и не са истински. Виж apps-script/README.md → „Еконт“.</p>'}
      <div class="econt-grid">
        <label class="field"><span>Доставка до</span><select data-e-mode><option value="office"${toAddress ? '' : ' selected'}>Офис / еконтомат</option><option value="address"${toAddress ? ' selected' : ''}>Адрес</option></select></label>
        <label class="field"><span>Град</span><input data-e-city list="tablo-econt-cities" value="${esc(city)}"></label>
        <label class="field" data-e-office-box${toAddress ? ' hidden' : ''}><span>Офис${office ? '' : ' (клиентът е писал: ' + esc(o['Офис / адрес']) + ')'}</span><select data-e-office></select></label>
        <label class="field" data-e-addr-box${toAddress ? '' : ' hidden'}><span>Пощ. код</span><input data-e-pc inputmode="numeric" maxlength="4" value="${esc(pc)}"></label>
        <label class="field wide" data-e-addr-box${toAddress ? '' : ' hidden'}><span>Адрес</span><input data-e-street value="${esc(o['Офис / адрес'] || '')}"></label>
        <label class="field"><span>Тегло, кг</span><input data-e-weight type="number" step="0.1" min="0.1" value="${weightOf(o)}"></label>
        <label class="field"><span>Пакети</span><input data-e-packs type="number" min="1" max="20" value="1"></label>
        <label class="field"><span>Наложен платеж, €</span><input data-e-cod type="number" step="0.01" min="0" value="${cod}"></label>
        <label class="field wide"><span>Описание</span><input data-e-desc maxlength="100" value="3D принтирани изделия"></label>
        <label class="check wide"><input type="checkbox" data-e-rp${/^SLOY/.test(o['Доставка за сметка на'] || '') ? '' : ' checked'}><span>Доставката се плаща от получателя (махни отметката при безплатна доставка)</span></label>
      </div>
      <div class="order-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-e-calc>Пресметни цената</button>
        <button class="btn btn-primary btn-sm" type="button" data-e-create>Създай товарителница</button>
        <button class="btn btn-ghost btn-sm" type="button" data-e-close>Затвори</button>
        <span class="admin-msg" data-e-msg></span>
      </div>`;
  };
  const fillEcontOffices = (box, offices, pick) => {
    const here = S.econtIn(offices, $('[data-e-city]', box).value);
    const sel = $('[data-e-office]', box);
    const prev = pick || sel.value;
    sel.innerHTML = `<option value="">${here.length ? 'Избери офис' : 'Няма офис в този град'}</option>`
      + here.map(x => `<option value="${esc(x.code)}"${x.code === prev ? ' selected' : ''}>${esc(S.econtText(x, false))}</option>`).join('');
  };
  const econtParams = (box, o, mode) => {
    const toAddress = $('[data-e-mode]', box).value === 'address';
    return {
      order: o['Поръчка'], mode,
      officeCode: toAddress ? '' : $('[data-e-office]', box).value,
      city: $('[data-e-city]', box).value, postCode: $('[data-e-pc]', box).value, street: $('[data-e-street]', box).value,
      weight: $('[data-e-weight]', box).value, packs: $('[data-e-packs]', box).value, cod: $('[data-e-cod]', box).value,
      description: $('[data-e-desc]', box).value, receiverPays: $('[data-e-rp]', box).checked,
    };
  };
  const priceText = r => `${fmt(r.price)} общо · получателят плаща ${fmt(r.receiverDue || 0)} · ти — ${fmt(r.senderDue || 0)}${r.expected ? ` · доставка ~${r.expected}` : ''}`;
  $('#orders').addEventListener('click', async e => {
    const card = e.target.closest('.order-card');
    if (!card || !e.target.closest('[data-econt], [data-e-calc], [data-e-create], [data-e-close], [data-econt-status], [data-econt-delete]')) return;
    const o = D.orders.find(x => x['Поръчка'] === card.dataset.order);
    const box = $('.order-econt', card);
    const say = (msg, el = $('[data-e-msg]', box)) => { if (el) el.textContent = msg; };
    if (e.target.closest('[data-econt]')) {
      box.innerHTML = '<p class="admin-msg">Зареждаме офисите на Еконт…</p>';
      box.hidden = false;
      const offices = await S.econtOffices();
      if (!econtCities) {
        econtCities = document.createElement('datalist');
        econtCities.id = 'tablo-econt-cities';
        econtCities.innerHTML = [...new Set(offices.map(x => x.city))].map(c => `<option value="${esc(c)}">`).join('');
        document.body.append(econtCities);
      }
      box.innerHTML = econtBoxHTML(o, offices);
      fillEcontOffices(box, offices, String(o['Еконт офис'] || ''));
      $('[data-e-city]', box).addEventListener('input', () => fillEcontOffices(box, offices));
      $('[data-e-mode]', box).addEventListener('change', ev => {
        const toAddress = ev.target.value === 'address';
        $$('[data-e-office-box]', box).forEach(x => { x.hidden = toAddress; });
        $$('[data-e-addr-box]', box).forEach(x => { x.hidden = !toAddress; });
      });
      return;
    }
    if (e.target.closest('[data-e-close]')) { box.hidden = true; return; }
    if (e.target.closest('[data-e-calc]')) {
      say('Питаме Еконт…');
      try { say(priceText(await api('econt', econtParams(box, o, 'calculate')))); } catch (err) { say(failed(err)); }
      return;
    }
    if (e.target.closest('[data-e-create]')) {
      const btn = e.target.closest('[data-e-create]');
      btn.disabled = true;
      say('Създаваме товарителницата…');
      try {
        const r = await api('econt', econtParams(box, o, 'create'));
        Object.assign(o, { 'Товарителница': r.shipment, 'Етикет': r.pdf });
        $('[data-tracking]', card).value = r.shipment;
        box.hidden = true;
        $('.econt-row', card).outerHTML = econtRowHTML(o);
        $('[data-econt-msg]', card).textContent = `Създадена ✓ ${priceText(r)}${r.live ? '' : ' · ТЕСТОВА'}. Отпечатай етикета, а щом я предадеш — статус „Изпратена“ и „Пиши на клиента“.`;
      } catch (err) {
        say(failed(err));
      } finally {
        btn.disabled = false;
      }
      return;
    }
    const msg = $('[data-econt-msg]', card);
    if (e.target.closest('[data-econt-status]')) {
      msg.textContent = 'Питаме Еконт…';
      try {
        const r = await api('econtStatus', { shipment: o['Товарителница'] });
        msg.textContent = [r.status || 'Няма движение още', ...r.events].join(' · ') + (r.cdPaid ? ` · наложеният платеж е изплатен: ${fmt(r.cdPaid)}` : r.cdCollected ? ` · наложеният платеж е събран: ${fmt(r.cdCollected)}` : '');
      } catch (err) { msg.textContent = failed(err); }
      return;
    }
    if (e.target.closest('[data-econt-delete]')) {
      if (!window.confirm(`Да изтрия ли товарителница ${o['Товарителница']} в Еконт?`)) return;
      msg.textContent = 'Изтриваме…';
      try {
        await api('econtDelete', { order: o['Поръчка'] });
        Object.assign(o, { 'Товарителница': '', 'Етикет': '' });
        $('[data-tracking]', card).value = '';
        $('.econt-row', card).outerHTML = econtRowHTML(o);
      } catch (err) { msg.textContent = failed(err); }
    }
  });

  // ---------- Запитвания ----------
  const contactHTML = c => String(c || '').split(' · ').filter(has).map(p => {
    if (isEmail(p)) return `<a href="mailto:${esc(p.trim())}">${esc(p.trim())}</a>`;
    if (/^[\d\s+()-]{6,}$/.test(p.trim())) return phoneLinks(p.trim());
    return esc(p);
  }).join(' · ');
  const leadHTML = l => {
    const mail = String(l['Контакт'] || '').split(' · ').find(isEmail);
    const subj = encodeURIComponent(l['Език'] === 'EN' ? 'Your request — SLOY 3D' : 'Запитването ти — SLOY 3D');
    return `
    <article class="order-card st-${LEAD_CLASS[l['Статус']] || 'new'}" data-lead="${esc(l['Номер'])}">
      <header class="order-top">
        <strong class="order-no">${esc(l['Номер'])}</strong>
        <span class="tag">${esc(l['Вид'])}</span>
        <span class="order-status">${esc(l['Статус'])}</span>
        <span class="order-date">${esc(l['Дата'])}</span>
      </header>
      <p class="order-who"><strong>${esc(l['Име'])}</strong> · ${contactHTML(l['Контакт'])}${l['Език'] === 'EN' ? ' · <span class="tag">EN</span>' : ''}</p>
      ${has(l['Съобщение']) ? `<p class="lead-msg">${linkify(l['Съобщение'])}</p>` : ''}
      ${has(l['Детайли']) ? `<details class="order-items-box"><summary>Детайли</summary><pre>${linkify(l['Детайли'])}</pre></details>` : ''}
      <div class="order-actions">
        <select data-lstatus aria-label="Статус">${D.leadStatuses.map(s => `<option${s === l['Статус'] ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <input class="order-mynote" data-note value="${esc(l['Моя бележка'] || '')}" placeholder="Моя бележка (цена, срок…)" aria-label="Моя бележка">
        <button class="btn btn-primary btn-sm" type="button" data-lsave>Запази</button>
        ${mail ? `<a class="btn btn-ghost btn-sm" href="mailto:${esc(mail.trim())}?subject=${subj}">Отговори по имейл</a>` : ''}
        <span class="admin-msg" role="status"></span>
      </div>
    </article>`;
  };
  const renderLeads = () => {
    const count = s => (s === 'all' ? D.leads.length : D.leads.filter(l => l['Статус'] === s).length);
    $('#lead-filters').innerHTML = chips('lead-filter', D.leadStatuses, view.leads, count);
    const q = view.leadQuery.trim().toLowerCase();
    const list = D.leads.filter(l => (view.leads === 'all' || l['Статус'] === view.leads)
      && (!q || [l['Номер'], l['Име'], l['Контакт'], l['Съобщение'], l['Детайли'], l['Моя бележка']].join(' ').toLowerCase().includes(q)));
    $('#leads').innerHTML = list.length ? list.map(leadHTML).join('')
      : `<p class="admin-empty">${D.leads.length ? 'Няма запитвания тук.' : 'Още няма запитвания.'}</p>`;
  };
  $('#leads').addEventListener('click', async e => {
    if (!e.target.closest('[data-lsave]')) return;
    const card = e.target.closest('.order-card');
    const l = D.leads.find(x => x['Номер'] === card.dataset.lead);
    const msg = $('.admin-msg', card);
    const status = $('[data-lstatus]', card).value;
    const note = $('[data-note]', card).value.trim();
    msg.textContent = 'Записваме…';
    try {
      await api('leadStatus', { id: l['Номер'], status, note });
      Object.assign(l, { 'Статус': status, 'Моя бележка': note });
      card.className = `order-card st-${LEAD_CLASS[status] || 'new'}`;
      $('.order-status', card).textContent = status;
      msg.textContent = 'Запазено ✓';
      renderStats();
    } catch (err) {
      msg.textContent = failed(err);
    }
  });
  $('#lead-filters').addEventListener('change', e => { view.leads = e.target.value; renderLeads(); });
  $('#lead-search').addEventListener('input', e => { view.leadQuery = e.target.value; renderLeads(); });

  // ---------- Склад ----------
  const MATS = Object.keys(materials);
  const known = r => materials[r.material] && S.colorsFor(r.material, true).some(c => c.name === r.color);
  const sortRows = () => D.stock.sort((a, b) => (MATS.indexOf(a.material) - MATS.indexOf(b.material)) || a.color.localeCompare(b.color, 'bg'));
  const setDirty = (what, v) => {
    dirty[what] = v;
    $(`#${what}-status`).textContent = v ? 'Има незапазени промени.' : '';
  };
  const renderStock = () => {
    sortRows();
    const min = D.minGrams;
    $('#stock-rows').innerHTML = D.stock.map((r, i) => `
      <tr class="${r.grams < min ? 'low' : ''}${known(r) ? '' : ' bad'}" data-i="${i}"${known(r) ? '' : ' title="Няма такъв материал или цвят в сайта — провери името"'}>
        <td>${esc(materials[r.material]?.label || r.material)}</td>
        <td><span class="file-dot" style="--c:${S.previewColor(r.color)}"></span>${esc(r.color)}</td>
        <td><input type="number" min="0" step="10" value="${r.grams}" data-grams aria-label="Грама"></td>
        <td><input value="${esc(r.note)}" data-note aria-label="Бележка" placeholder="напр. 2 ролки, поръчан"></td>
        <td><button type="button" class="file-remove" data-del aria-label="Изтрий реда">×</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="admin-empty">Складът е празен — сайтът предлага всички цветове. Добави ролките, щом пристигнат.</td></tr>';
    const on = D.stock.filter(r => r.grams >= min && known(r)).length;
    $('#stock-summary').textContent = D.stock.length
      ? `На сайта се предлагат ${on} от ${D.stock.length} цвята — тези с поне ${min} г. Материал без наличен цвят не се показва.`
      : 'Докато складът е празен, сайтът предлага всички материали и цветове.';
  };
  const renderAddColors = () => {
    $('#add-color').innerHTML = S.colorsFor($('#add-mat').value, true).map(c => `<option>${esc(c.name)}</option>`).join('');
  };
  $('#add-mat').innerHTML = MATS.map(m => `<option value="${esc(m)}">${esc(materials[m].label)}</option>`).join('');
  renderAddColors();
  $('#add-mat').addEventListener('change', renderAddColors);
  $('#add-row').addEventListener('click', () => {
    const material = $('#add-mat').value;
    const color = $('#add-color').value;
    if (!D.stock.some(r => r.material === material && r.color === color)) {
      D.stock.push({ material, color, grams: 1000, note: '' });
      setDirty('stock', true);
      renderStock();
    }
    const i = D.stock.findIndex(r => r.material === material && r.color === color);
    $(`#stock-rows tr[data-i="${i}"] [data-grams]`)?.focus();
  });
  $('#stock-rows').addEventListener('input', e => {
    const tr = e.target.closest('tr');
    const r = D.stock[+tr.dataset.i];
    if (e.target.matches('[data-grams]')) {
      r.grams = Math.max(0, Math.round(+e.target.value || 0));
      tr.classList.toggle('low', r.grams < D.minGrams);
    }
    if (e.target.matches('[data-note]')) r.note = e.target.value;
    setDirty('stock', true);
  });
  $('#stock-rows').addEventListener('change', e => { if (e.target.matches('[data-grams]')) renderStock(); });
  $('#stock-rows').addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    D.stock.splice(+e.target.closest('tr').dataset.i, 1);
    setDirty('stock', true);
    renderStock();
  });
  $('#save-stock').addEventListener('click', async () => {
    $('#stock-status').textContent = 'Записваме…';
    try {
      await api('saveStock', { rows: D.stock });
      setDirty('stock', false);
      $('#stock-status').textContent = 'Запазено ✓ — сайтът показва новия склад до 10 минути.';
    } catch (err) {
      $('#stock-status').textContent = failed(err);
    }
  });

  // ---------- Промокодове ----------
  const renderCodes = () => {
    const today = new Date().toISOString().slice(0, 10);
    $('#code-rows').innerHTML = D.codes.map((c, i) => {
      const off = !c.active || (c.to && c.to < today) || (c.max && c.used >= c.max);
      return `
      <tr data-i="${i}" class="${off ? 'low' : ''}">
        <td><input data-k="code" value="${esc(c.code)}" aria-label="Код" class="code-input" autocapitalize="characters" spellcheck="false"></td>
        <td><select data-k="type" aria-label="Тип"><option value="процент"${c.type === 'процент' ? ' selected' : ''}>%</option><option value="сума"${c.type === 'сума' ? ' selected' : ''}>€</option></select></td>
        <td><input data-k="value" type="number" min="0" step="0.5" value="${c.value}" aria-label="Стойност"></td>
        <td><input data-k="minOrder" type="number" min="0" step="1" value="${c.minOrder || ''}" aria-label="Минимална поръчка"></td>
        <td><input data-k="from" type="date" value="${esc(c.from)}" aria-label="От"></td>
        <td><input data-k="to" type="date" value="${esc(c.to)}" aria-label="До"></td>
        <td><input data-k="max" type="number" min="0" step="1" value="${c.max || ''}" aria-label="Максимум използвания"></td>
        <td><input data-k="used" type="number" min="0" step="1" value="${c.used}" aria-label="Използван"></td>
        <td><input data-k="active" type="checkbox"${c.active ? ' checked' : ''} aria-label="Активен"></td>
        <td><button type="button" class="file-remove" data-del aria-label="Изтрий кода">×</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="admin-empty">Няма промокодове.</td></tr>';
  };
  $('#code-rows').addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const c = D.codes[+e.target.closest('tr').dataset.i];
    c[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'code' ? e.target.value.toUpperCase().replace(/\s/g, '') : e.target.value;
    setDirty('codes', true);
  });
  $('#code-rows').addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    D.codes.splice(+e.target.closest('tr').dataset.i, 1);
    setDirty('codes', true);
    renderCodes();
  });
  $('#add-code').addEventListener('click', () => {
    D.codes.push({ code: '', type: 'процент', value: 10, minOrder: 0, from: '', to: '', max: 0, used: 0, active: true });
    setDirty('codes', true);
    renderCodes();
    $(`#code-rows tr[data-i="${D.codes.length - 1}"] [data-k="code"]`).focus();
  });
  $('#save-codes').addEventListener('click', async () => {
    $('#codes-status').textContent = 'Записваме…';
    try {
      await api('saveCodes', { rows: D.codes });
      setDirty('codes', false);
      renderCodes();
      $('#codes-status').textContent = 'Запазено ✓';
    } catch (err) {
      $('#codes-status').textContent = failed(err);
    }
  });
  addEventListener('beforeunload', e => { if (dirty.stock || dirty.codes) e.preventDefault(); });

  // ---------- Старт ----------
  const start = () => {
    show('panel');
    $('#logout').hidden = false;
    load();
  };
  if (!url) show('setup');
  else if (key) start();
  else show('login');
})();

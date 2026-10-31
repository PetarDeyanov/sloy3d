(() => {
  const cfg = window.SLOY_CONFIG || {};
  const { t, lang, pick, dayMonth } = window.SLOY_I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ---------- Контакти от config.js ----------
  const phoneDigits = (cfg.phone || '').replace(/[^\d+]/g, '');
  const bind = (attr, value, href) => $$(`[data-${attr}]`).forEach(el => {
    if (!value) { (el.closest('li') || el).hidden = true; return; }
    if (el.tagName === 'A') el.href = href;
    const label = $('[data-label]', el);
    if (label) label.textContent = value;
  });
  bind('phone', cfg.phone, 'tel:' + phoneDigits);
  bind('viber', cfg.phone, 'viber://chat?number=' + encodeURIComponent(phoneDigits));
  bind('email', cfg.email, 'mailto:' + cfg.email);
  bind('instagram', cfg.instagram, cfg.instagram);
  bind('facebook', cfg.facebook, cfg.facebook);
  bind('tiktok', cfg.tiktok, cfg.tiktok);
  bind('youtube', cfg.youtube, cfg.youtube);
  bind('messenger', cfg.messenger, cfg.messenger);
  $$('[data-company]').forEach(el => { el.textContent = cfg.company || ''; el.hidden = !cfg.company; });

  // ---------- Изпращане на запитвания ----------
  // Google таблицата (Apps Script) записва запитването в таблото и ни праща имейл; без нея — Web3Forms,
  // а без ключ — имейл програмата на клиента (quiet = без нея — за pop-up-а с отстъпката).
  // Връща 'mailto', ако е отворена имейл програмата, иначе 'sent'.
  const scriptUrl = cfg.appsScriptUrl || '';
  const sendLead = async (kind, subject, fields, replyTo, quiet = false) => {
    if (lang === 'en') fields = { ...fields, 'Език': 'English — отговори на английски' };
    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, { method: 'POST', body: JSON.stringify({ action: 'lead', kind, subject, lang, fields }) });
        if ((await res.json()).ok) return 'sent';
      } catch { /* таблицата не отговаря — пробваме по имейл */ }
    }
    if (!cfg.web3formsKey) {
      if (quiet) return 'sent';
      const body = Object.entries(fields).map(([k, v]) => String(v).includes('\n') ? `\n${k}:\n${v}` : `${k}: ${v}`).join('\n');
      location.href = `mailto:${cfg.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return 'mailto';
    }
    const res = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ access_key: cfg.web3formsKey, subject, from_name: 'SLOY 3D — сайт', ...(replyTo ? { replyto: replyTo } : {}), ...fields }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);
    return 'sent';
  };
  const isEmail = s => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(s || '').trim());
  $$('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  // ---------- Навигация ----------
  const header = $('.site-header');
  const nav = $('#nav');
  const toggle = $('.nav-toggle');
  const closeNav = () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(nav.classList.toggle('open'))));
  nav.addEventListener('click', e => { if (e.target.closest('a')) closeNav(); });
  // „Още“ — падащо меню на компютър (на телефон линковете са в общия списък)
  const more = $('.nav-more');
  const moreBtn = $('.nav-more-btn');
  const setMore = open => { more.classList.toggle('open', open); moreBtn.setAttribute('aria-expanded', String(open)); };
  moreBtn?.addEventListener('click', () => setMore(!more.classList.contains('open')));
  document.addEventListener('click', e => { if (more && !more.contains(e.target)) setMore(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeNav(); if (more) setMore(false); } });
  const onScroll = () => header.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Празници ----------
  // Празникът се показва seasonLeadDays дни преди датата си и изчезва след последния ден за поръчка
  // (orderDaysBefore дни преди него) — иначе банерът показва изтекъл срок, а поръчката не би стигнала навреме.
  // Сезон с from/to (ММ-ДД) се показва точно в този период. Може да са активни няколко сезона наведнъж.
  // За преглед преди сезона: добави ?sezon=christmas към адреса.
  const catalog = window.SLOY_CATALOG;
  const authorPhotos = new Set(catalog?.authorPhotos || []);
  const photos = Object.fromEntries(Object.entries(catalog?.photoColors || {}).filter(([id]) => !authorPhotos.has(id)));   // със студийна снимка
  const DAY = 86400000;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const findSeasons = () => {
    if (!catalog) return [];
    const { seasons, seasonLeadDays = 30, orderDaysBefore = 6 } = catalog;
    const forced = new URLSearchParams(location.search).get('sezon');
    const md = (str, y) => { const [m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); };
    const make = (id, date) => ({ id, ...seasons[id], day: date, orderBy: new Date(date.getTime() - orderDaysBefore * DAY) });
    if (seasons[forced]) {
      const date = md(seasons[forced].date, today.getFullYear());
      return [make(forced, date < today ? md(seasons[forced].date, today.getFullYear() + 1) : date)];
    }
    const out = [];
    for (const id of Object.keys(seasons)) {
      const x = seasons[id];
      for (const y of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
        const date = md(x.date, y);
        let from, to;
        if (x.from && x.to) {   // изричен период около празника (to може да е в следващата година)
          from = md(x.from, y); if (from > date) from = md(x.from, y - 1);
          to = md(x.to, y); if (to < date) to = md(x.to, y + 1);
        } else {
          from = new Date(date.getTime() - seasonLeadDays * DAY);
          to = new Date(date.getTime() - orderDaysBefore * DAY);
        }
        if (today >= from && today <= to) { out.push(make(id, date)); break; }
      }
    }
    // само сезони с продукти; подредени по дата на празника
    return out.filter(x => catalog.products.some(p => p.seasons?.includes(x.id))).sort((a, b) => a.day - b.day);
  };
  const activeSeasons = findSeasons();
  // банерът: първият празник, за който още може да се поръча навреме (иначе първият активен)
  const season = activeSeasons.find(x => x.orderBy >= today) || activeSeasons[0] || null;
  window.SLOY_SEASONS = activeSeasons;
  window.SLOY_SEASON = season;

  // Таймер до самия празник: до 00:00 на деня (countTo — друг ден, напр. Нова година до 1 януари).
  // В самия ден показва поздрава (greeting), след това се скрива.
  const countdownTimers = new WeakMap();
  window.SLOY_COUNTDOWN = (el, x) => {
    if (!el) return;
    clearInterval(countdownTimers.get(el));
    if (!x) { el.hidden = true; return; }
    let target = x.day;
    if (x.countTo) {
      const [m, d] = x.countTo.split('-').map(Number);
      target = new Date(x.day.getFullYear(), m - 1, d);
      if (target < x.day) target = new Date(x.day.getFullYear() + 1, m - 1, d);
    }
    const tick = () => {
      if (document.querySelector('.cookies:not([hidden])')) return;   // зад прозореца за бисквитките нищо не мърда
      const ms = target - Date.now();
      if (ms <= -DAY) { el.hidden = true; clearInterval(countdownTimers.get(el)); return; }
      el.hidden = false;
      if (ms <= 0) { el.innerHTML = `<span class="countdown-greet">${x.icon} ${pick(x, 'greeting') || ''}</span>`; return; }
      const sec = Math.floor(ms / 1000);
      const units = [[Math.floor(sec / 86400), t('дни')], [Math.floor(sec / 3600) % 24, t('часа')], [Math.floor(sec / 60) % 60, t('мин')], [sec % 60, t('сек')]];
      el.innerHTML = `<span class="countdown-label">${t('До {holiday} остават', { holiday: pick(x, 'label') })}</span>`
        + units.map(([n, l]) => `<span class="countdown-unit"><b>${String(n).padStart(2, '0')}</b><small>${l}</small></span>`).join('');
    };
    tick();
    countdownTimers.set(el, setInterval(tick, 1000));
  };

  [...activeSeasons].reverse().forEach(x => {
    const link = document.createElement('a');
    link.className = 'nav-season';
    link.href = `katalog.html#${x.id}`;
    link.style.setProperty('--season-a', x.accent);
    link.textContent = `${x.icon} ${pick(x, 'label')}`;
    nav.prepend(link);
  });

  // Банер на началната страница
  const banner = $('#season-banner');
  if (banner && season) {
    const picks = catalog.products.filter(p => p.seasons?.includes(season.id)).slice(0, 4);
    banner.style.setProperty('--season-a', season.accent);
    banner.style.setProperty('--season-b', season.accent2);
    banner.innerHTML = `
      <div class="wrap season-inner">
        <div class="season-copy">
          <p class="eyebrow">${season.icon} ${pick(season, 'label')}</p>
          <h2>${pick(season, 'title')}</h2>
          <p class="section-lead">${pick(season, 'text')}</p>
          ${season.orderBy >= today ? `<p class="season-deadline">${t('Последен ден за поръчка:')} <strong>${dayMonth(season.orderBy)}</strong></p>` : ''}
          <div class="countdown" role="timer" aria-live="off" hidden></div>
          <a class="btn btn-primary" href="katalog.html#${season.id}">${t('Виж колекцията')}</a>
        </div>
        <div class="season-picks">
          ${picks.map(p => `<a href="katalog.html#p-${p.id}" class="season-pick"><img src="${photos[p.id] ? `img/p/${p.id}.webp` : p.mw.img}" alt="${pick(p, 'name')}" loading="lazy" referrerpolicy="no-referrer"><span>${pick(p, 'name')}</span></a>`).join('')}
        </div>
      </div>`;
    banner.hidden = false;
    window.SLOY_COUNTDOWN(banner.querySelector('.countdown'), season);
  }

  // ---------- Въпрос от връзка (напр. vaprosi.html#pasva) — отваряме го ----------
  const asked = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
  if (asked && asked.tagName === 'DETAILS') asked.open = true;

  // ---------- Сравнение на материалите (начална страница) ----------
  const matGrid = $('#mat-compare');
  if (matGrid && catalog) {
    const { materials, materialGroups, ratingLabels } = catalog;
    const card = m => `
      <article class="mat-card">
        <h3>${t(m.label)}</h3>
        <p class="mat-tag">${t(m.tagline)}</p>
        <p class="mat-uses"><strong>${t('Най-често за:')}</strong> ${t(m.uses)}</p>
        <dl class="meters">
          ${Object.entries(ratingLabels).map(([k, label]) => `
            <div class="meter-row">
              <dt>${t(label)}</dt>
              <dd aria-label="${t('{n} от 5', { n: m.ratings[k] })}"><span class="meter" style="--v:${m.ratings[k]}">${'<i></i>'.repeat(5)}</span></dd>
            </div>`).join('')}
        </dl>
        <p class="mat-note">${t(m.note)}</p>
      </article>`;
    matGrid.innerHTML = Object.entries(materialGroups).map(([g, label]) => `
      <section class="mat-section">
        <h2 class="mat-section-title">${t(label)}</h2>
        <div class="mat-grid">${Object.values(materials).filter(m => m.group === g).map(card).join('')}</div>
      </section>`).join('');
  }

  // ---------- Бисквитки: питаме веднъж, изборът се пази в браузъра ----------
  // Сайтът пази само нужното (количка, език, отстъпка) — без реклами и проследяване. Ако някога добавим статистика
  // или реклама (напр. Meta Pixel), тя се пуска само при localStorage 'sloy-cookies' === 'accepted' и текстът тук се сменя.
  // „Бисквитки“ най-долу на всяка страница отваря прозореца отново.
  const COOKIE_KEY = 'sloy-cookies';
  const CK = {
    title: 'Ползваме бисквитки',
    text: 'Пазим в браузъра ти само нужното, за да работи сайтът: количката, езика и отстъпката ти. Без реклами и проследяване.',
    more: 'Подробности', yes: 'Приемам', no: 'Отказвам',
    en: {
      title: 'We use cookies',
      text: 'We only keep what the site needs in your browser: your cart, language and discount. No ads, no tracking.',
      more: 'Details', yes: 'Accept', no: 'Decline',
    },
  };
  let cookieChoice = 'blocked';
  try { cookieChoice = localStorage.getItem(COOKIE_KEY); } catch { /* без памет няма какво да пазим — не питаме */ }
  const cookieBox = document.createElement('div');
  cookieBox.className = 'cookies';
  cookieBox.hidden = true;
  cookieBox.innerHTML = `
    <div class="cookies-backdrop"></div>
    <div class="cookies-card" role="dialog" aria-modal="true" aria-labelledby="cookies-title">
      <svg class="cookies-ic" viewBox="0 0 64 64" aria-hidden="true">
        <defs><clipPath id="cookie-clip"><path d="M41.2 11.8A24 24 0 1 0 54.2 24.8A11 11 0 0 1 41.2 11.8Z"/></clipPath></defs>
        <path class="dough" d="M41.2 11.8A24 24 0 1 0 54.2 24.8A11 11 0 0 1 41.2 11.8Z"/>
        <g class="lines" clip-path="url(#cookie-clip)">${Array.from({ length: 15 }, (_, i) => `<rect x="6" y="${11 + i * 3.4}" width="54" height="1.2"/>`).join('')}</g>
        <path class="edge" d="M41.2 11.8A24 24 0 1 0 54.2 24.8A11 11 0 0 1 41.2 11.8Z"/>
        <circle class="chip" cx="22" cy="27" r="2.8"/><circle class="chip" cx="34" cy="21" r="2.4"/><circle class="chip" cx="27" cy="40" r="2.6"/>
        <circle class="chip" cx="41" cy="35" r="2.8"/><circle class="chip" cx="19" cy="46" r="2.2"/><circle class="chip" cx="44" cy="48" r="2.4"/>
      </svg>
      <h2 id="cookies-title">${pick(CK, 'title')}</h2>
      <p>${pick(CK, 'text')} <a href="poveritelnost.html#${lang === 'en' ? 'cookies' : 'biskvitki'}">${pick(CK, 'more')}</a></p>
      <div class="cookies-btns">
        <button class="btn btn-primary" type="button" value="accepted">${pick(CK, 'yes')}</button>
        <button class="btn btn-ghost" type="button" value="declined">${pick(CK, 'no')}</button>
      </div>
    </div>`;
  document.body.appendChild(cookieBox);
  // страницата отзад е inert, докато прозорецът е отворен — Tab не излиза от него
  const pageInert = on => [...document.body.children].forEach(el => { if (el !== cookieBox) el.inert = on; });
  const openCookies = () => {
    cookieBox.hidden = false;
    pageInert(true);
    document.body.classList.add('locked');   // pop-up-ът за отстъпка изчаква, докато е отворено
    $('.btn-primary', cookieBox).focus({ preventScroll: true });
  };
  cookieBox.addEventListener('click', e => {
    const b = e.target.closest('button[value]');
    if (!b) return;
    try { localStorage.setItem(COOKIE_KEY, b.value); } catch { /* без памет — само за тази страница */ }
    cookieBox.hidden = true;
    pageInert(false);
    if (![...$$('.drawer, .promo')].some(d => !d.hidden)) document.body.classList.remove('locked');
  });
  $$('[data-cookie-settings]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openCookies(); }));
  if (!cookieChoice) openCookies();   // веднага — излиза заедно със страницата, а не след нея

  // ---------- Pop-up: отстъпка за първа поръчка ----------
  // Показва се веднъж — след 12 секунди или когато мишката тръгне да напуска страницата.
  // „Не, благодаря“ го скрива за 14 дни. Отстъпката се прилага сама в количката и калкулатора.
  const PROMO_KEY = 'sloy-promo';
  const promoState = () => { try { return JSON.parse(localStorage.getItem(PROMO_KEY)) || {}; } catch { return {}; } };
  const savePromo = s => { try { localStorage.setItem(PROMO_KEY, JSON.stringify(s)); } catch { /* без памет — само за сесията */ } };
  const promoRate = catalog?.pricing?.firstOrderDiscount || 0;
  window.SLOY_PROMO = {
    rate: () => { const s = promoState(); return s.claimed && !s.used ? promoRate : 0; },
    info: () => promoState(),
    markUsed: () => savePromo({ ...promoState(), used: Date.now() }),
  };
  const promoNow = promoState();
  const snoozed = promoNow.dismissed && Date.now() - promoNow.dismissed < 14 * 86400000;
  if (promoRate && !promoNow.claimed && !snoozed) {
    const pct = Math.round(promoRate * 100);
    const box = document.createElement('div');
    box.className = 'promo';
    box.hidden = true;
    box.innerHTML = `
      <div class="promo-backdrop" data-promo-close></div>
      <div class="promo-card" role="dialog" aria-modal="true" aria-labelledby="promo-title">
        <button class="drawer-close promo-x" type="button" data-promo-close aria-label="${t('Затвори')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
        <p class="eyebrow">${t('Специална оферта')}</p>
        <p class="promo-pct">${pct}%</p>
        <h2 id="promo-title">${t('отстъпка на първа поръчка')}</h2>
        <form class="promo-form" novalidate>
          <p class="promo-text">${t('Остави име и имейл — ще запазим отстъпката и ще я видиш в количката при първата си поръчка.')}</p>
          <input name="name" required autocomplete="name" placeholder="${t('Твоето име')}" aria-label="${t('Твоето име')}">
          <input name="email" type="email" required autocomplete="email" inputmode="email" placeholder="${t('Имейл')}" aria-label="${t('Имейл')}">
          <input type="checkbox" name="botcheck" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-primary btn-block" type="submit">${t('Получи отстъпката')}</button>
          <p class="form-status" role="status" aria-live="polite"></p>
          <p class="promo-legal">${t('С изпращането се съгласяваш да ти пишем за отстъпки.')} <a href="poveritelnost.html">${t('Поверителност')}</a></p>
          <button class="promo-no" type="button" data-promo-close>${t('Не, благодаря')}</button>
        </form>
        <div class="promo-done" hidden>
          <p class="promo-text">${t('Готово! Отстъпката от {pct}% е запазена — ще я видиш в количката при първата си поръчка.', { pct })}</p>
          <button class="btn btn-ghost" type="button" data-promo-close>${t('Към сайта')}</button>
        </div>
      </div>`;
    document.body.appendChild(box);

    let shown = false;
    const showPromo = () => {
      if (shown) return;
      if (document.body.classList.contains('locked')) { setTimeout(showPromo, 4000); return; }   // не пречи на отворена количка
      shown = true;
      box.hidden = false;
      document.body.classList.add('locked');
      $('input[name=name]', box).focus({ preventScroll: true });
    };
    const closePromo = () => {
      box.hidden = true;
      if (![...document.querySelectorAll('.drawer')].some(d => !d.hidden)) document.body.classList.remove('locked');
      if (!promoState().claimed) savePromo({ ...promoState(), dismissed: Date.now() });
    };
    box.addEventListener('click', e => { if (e.target.closest('[data-promo-close]')) closePromo(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !box.hidden) closePromo(); });
    setTimeout(showPromo, 12000);
    document.addEventListener('mouseout', e => { if (!e.relatedTarget && e.clientY <= 0) showPromo(); });

    const pform = $('.promo-form', box);
    const pstatus = $('.form-status', pform);
    pform.addEventListener('submit', async e => {
      e.preventDefault();
      pform.classList.add('tried');
      if (!pform.checkValidity()) {
        pstatus.textContent = t('Попълни име и валиден имейл.');
        pstatus.className = 'form-status err';
        return;
      }
      const d = Object.fromEntries(new FormData(pform));
      if (d.botcheck) return;
      try {
        pstatus.textContent = t('Изпращаме…');
        pstatus.className = 'form-status';
        await sendLead('promo', `Нов клиент за ${pct}% отстъпка — ${d.name}`,
          { 'Име': d.name, 'Имейл': d.email, 'Оферта': `${pct}% отстъпка на първа поръчка`, 'Страница': location.pathname }, d.email, true);
        pstatus.textContent = '';
        savePromo({ claimed: Date.now(), name: d.name, email: d.email });
        pform.hidden = true;
        $('.promo-done', box).hidden = false;
      } catch {
        pstatus.textContent = t('Не успяхме да изпратим заявката. Пиши ни директно във Viber или на имейл.');
        pstatus.className = 'form-status err';
      }
    });
  }

  // ---------- Запитвания (напр. „За фирми“): form[data-lead] ----------
  // Полетата отиват в имейла с етикетите от data-label.
  document.querySelectorAll('form[data-lead]').forEach(lf => {
    const st = $('.form-status', lf);
    const btn = $('button[type=submit]', lf);
    const say = (msg, kind = '') => { st.textContent = msg; st.className = 'form-status ' + kind; };
    lf.addEventListener('submit', async e => {
      e.preventDefault();
      lf.classList.add('tried');
      if (!lf.checkValidity()) { say(t('Попълни полетата, отбелязани със звездичка.'), 'err'); $(':invalid', lf)?.focus(); return; }
      const d = Object.fromEntries(new FormData(lf));
      if (d.botcheck) return;
      const fields = {};
      [...lf.elements].forEach(el => { if (el.dataset.label && d[el.name]) fields[el.dataset.label] = d[el.name]; });
      const subject = `${lf.dataset.lead} — ${d.company || d.name || ''}`;
      btn.disabled = true;
      say(t('Изпращаме…'));
      try {
        if (await sendLead(lf.dataset.kind || 'b2b', subject, fields, d.email) === 'mailto') {
          say(t('Отворихме имейла ти с готово съобщение — остава само да натиснеш „Изпрати“.'), 'ok');
          return;
        }
        lf.hidden = true;
        document.getElementById(lf.dataset.done).hidden = false;
      } catch {
        say(t('Не успяхме да изпратим заявката. Пиши ни директно във Viber или на имейл.'), 'err');
      } finally {
        btn.disabled = false;
      }
    });
  });

  // ---------- Форма за поръчка по идея (само на началната страница) ----------
  const form = $('#order-form');
  if (form) initOrderForm(form);

  function initOrderForm(form) {
    const success = $('#order-success');
    const status = $('.form-status', form);
    const submitBtn = $('button[type=submit]', form);
    const setStatus = (msg, kind = '') => { status.textContent = msg; status.className = 'form-status ' + kind; };

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
      delete d.botcheck;

      const subject = `Заявка от ${d.name} — ${d.category || 'без категория'}`;
      const fields = {
        'Име': d.name, 'Контакт': d.contact, 'Да отговорим по': d.reply,
        'Категория': d.category || '—', 'Има': d.source || '—', 'Линк': d.link || '—', 'Брой': d.qty || 1,
        'Описание': d.message,
      };
      submitBtn.disabled = true;
      setStatus(t('Изпращаме…'));
      try {
        if (await sendLead('idea', subject, fields, isEmail(d.contact) ? d.contact.trim() : '') === 'mailto') {
          setStatus(t('Отворихме имейла ти с готово съобщение — остава само да натиснеш „Изпрати“.'), 'ok');
          return;
        }
        form.hidden = true;
        success.hidden = false;
      } catch {
        setStatus(t('Не успяхме да изпратим заявката. Пиши ни директно във Viber или на имейл.'), 'err');
      } finally {
        submitBtn.disabled = false;
      }
    });

    $('#order-again').addEventListener('click', () => {
      form.reset();
      form.classList.remove('tried');
      setStatus('');
      success.hidden = true;
      form.hidden = false;
    });
  }

  // ---------- Анимация: принтер печата логото (трите цветни слоя) слой по слой — само на началната страница ----------
  const svg = $('.printer-svg');
  if (svg) initPrinter(svg);

  function initPrinter(svg) {
    const buildRect = $('#build-rect');
    const hot = $('#hot-layer');
    const head = $('#head');
    const gantry = $('#gantry');
    const part = $('#part');
    const rStatus = $('#r-status');
    const rLayer = $('#r-layer');
    const rZ = $('#r-z');
    const rTemp = $('#r-temp');

    const LH = 2, BASE = 310, TOP = 136, LAYERS = (BASE - TOP) / LH;
    const BUILD = 8000, HOLD = 2600, FADE = 700, CYCLE = BUILD + HOLD + FADE;
    const PARK = { x: 206, y: 44 };
    if ($('#r-total')) $('#r-total').textContent = LAYERS;

    // половин ширина на логото на дадена височина: долният (син) слой е най-широк, горният (лайм) — най-тесен
    const half = y => (y >= 252 ? 98 : y >= 194 ? 67 : 36);
    const headX = (t, top) => 120 + Math.sin(t / 95) * half(top) * 0.94;
    const ease = p => 1 - Math.pow(1 - p, 3);

    const render = t => {
      const printing = t < BUILD;
      const layer = printing ? Math.min(LAYERS, Math.floor(t / BUILD * LAYERS) + 1) : LAYERS;
      const top = BASE - layer * LH;
      buildRect.setAttribute('y', top);
      buildRect.setAttribute('height', BASE - top);
      hot.setAttribute('y', top);
      hot.style.opacity = printing ? 1 : 0;

      let x, y;
      if (printing) {
        x = headX(t, top);
        y = top;
      } else {
        const p = ease(Math.min(1, (t - BUILD) / 800));
        const x0 = headX(BUILD, TOP);
        x = x0 + (PARK.x - x0) * p;
        y = TOP + (PARK.y - TOP) * p;
      }
      head.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      gantry.setAttribute('transform', `translate(0 ${y.toFixed(1)})`);
      part.style.opacity = t > BUILD + HOLD ? Math.max(0, 1 - (t - BUILD - HOLD) / FADE) : 1;

      rLayer.textContent = String(layer).padStart(3, '0');
      rZ.textContent = (layer * 0.2).toFixed(2);
      rStatus.textContent = window.SLOY_I18N.t(printing ? 'ПЕЧАТА' : 'ГОТОВО');   // t тук е времето
      rStatus.classList.toggle('done', !printing);
    };

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      render(BUILD + 1000);
    } else {
      let start = null;
      let visible = true;
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(svg);
      // докато прозорецът за бисквитките е отворен, принтерът стои (готовото лого от HTML-а) и започва печата,
      // щом човек избере — така страницата отзад не се прерисува на всеки кадър
      const tick = now => {
        if (!cookieBox.hidden) start = null;
        else {
          if (start === null) start = now;
          if (visible) render((now - start) % CYCLE);
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setInterval(() => { if (visible && cookieBox.hidden) rTemp.textContent = 214 + Math.round(Math.random() * 2); }, 1400);
    }
  }
})();

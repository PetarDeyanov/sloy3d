(() => {
  const S = window.SLOY_SHOP;
  const { categories, seasons, materials, products } = window.SLOY_CATALOG;
  const { esc, fmt, clampQty, t } = S;
  const { pick, dayMonth } = window.SLOY_I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const byId = id => products.find(p => p.id === id);
  // снимка: студийната (img/p/<id>.webp, еднаква за всички), а ако я няма — тази на автора от MakerWorld / Printables
  const photoColors = window.SLOY_CATALOG.photoColors || {};
  const authorPhotos = new Set(window.SLOY_CATALOG.authorPhotos || []);
  const studio = p => !!photoColors[p.id] && !authorPhotos.has(p.id);   // има ли студийна снимка
  const photoOf = p => (studio(p) ? `img/p/${p.id}.webp` : p.mw.img);
  const imgHTML = (p, alt) => `<img src="${photoOf(p)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer"${studio(p) ? ` data-fallback="${esc(p.mw.img)}"` : ''}>`;
  // липсваща студийна снимка → снимката на автора
  document.addEventListener('error', e => {
    const img = e.target;
    if (img.tagName === 'IMG' && img.dataset.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
      e.stopImmediatePropagation();   // не е „без снимка“ — пробваме втората
    }
  }, true);
  // размер: индекс в p.sizes (по подразбиране — този с def); продукт без размери връща себе си
  const defSize = p => Math.max(0, (p.sizes || []).findIndex(s => s.def));
  const sizeOf = (p, idx) => p.sizes?.[idx ?? defSize(p)] || p;
  // цената идва от формулата (грамове, материал, цвят, печалба) и се закръгля до 0,50 €
  const unitPrice = (p, mat, picks, idx) => {
    const s = sizeOf(p, idx);
    return Math.max(0.5, Math.round(S.priceFor({ grams: s.grams, hours: s.hours, mat, picks, assembly: p.assembly }) * 2) / 2);
  };
  // всеки продукт може във всеки материал; p.materials са препоръчаните (първият е по подразбиране)
  const ALL = Object.keys(materials);
  const fromPrice = p => Math.min(...S.available(ALL).flatMap(m => (p.sizes || [p]).map((_, i) => unitPrice(p, m, undefined, i))));
  // мерки [ш, д, в] в мм; null = неизвестно, approx = приблизителни. tr = bg за имейла (без превод)
  const bg = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => vars?.[k] ?? m);
  const dimsText = (d, approx, tr = t) => {
    if (!d) return '';
    const [w, l, h] = d;
    const pre = approx ? '≈ ' : '';
    if (w && l && h) return `${pre}${w} × ${l} × ${h} ${tr('мм')}`;
    if (w && l) return `${pre}${w} × ${l} ${tr('мм')}`;
    if (h) return pre + tr('височина {n} мм', { n: h });
    if (w) return pre + tr('дължина {n} мм', { n: w });
    return '';
  };
  // airsoft: на какво пасва (fits) — универсалните пасват навсякъде
  const platforms = window.SLOY_CATALOG.platforms || {};
  const fitMatch = (p, f) => !f || (p.fits || []).includes(f) || (f !== 'universal' && (p.fits || []).includes('universal'));
  const fitText = p => (p.fits.includes('universal')
    ? t('Универсален') + (p.std ? ` · ${t(p.std)}` : '')
    : p.fits.map(k => t(platforms[k].label)).join(', '));
  // първият препоръчан материал, който е на склад
  const firstMat = p => p.materials.find(m => S.available([m]).length) || S.available(ALL)[0];
  // откъде е моделът: MakerWorld (по подразбиране) или Printables (pr(...) в products.js)
  const srcName = p => (p.mw.site === 'printables' ? 'Printables' : 'MakerWorld');
  const mwUrl = p => (p.mw.site === 'printables' ? `https://www.printables.com/model/${p.mw.id}` : `https://makerworld.com/en/models/${p.mw.id}`);
  const LICENSES = {
    'CC0': ['CC0 1.0', 'https://creativecommons.org/publicdomain/zero/1.0/'],
    'BY': ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
    'BY-SA': ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0/'],
  };
  const season = window.SLOY_SEASON || null;   // текущият празник (изчислява се в script.js)
  const activeSeason = season?.id || null;
  // Празничните продукти се виждат само в сезона си, освен ако са always
  const isAvailable = p => !p.seasons || p.always || p.seasons.includes(activeSeason);
  const catOrder = Object.keys(categories);
  const subcats = window.SLOY_CATALOG.subcategories || {};
  const subIdx = p => Object.keys(subcats[p.cat] || {}).indexOf(p.sub);
  const subLabel = p => subcats[p.cat]?.[p.sub];
  const shown = products.filter(isAvailable).sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || subIdx(a) - subIdx(b));

  // ---------- Количка (пази се в браузъра) ----------
  const CART_KEY = 'sloy-cart';
  const loadCart = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY)) || [];
      return raw.filter(i => byId(i.id) && isAvailable(byId(i.id)) && materials[i.mat])
        .map(i => (byId(i.id).sizes && !byId(i.id).sizes[i.size] ? { ...i, size: defSize(byId(i.id)) } : i));
    } catch { return []; }
  };
  let cart = loadCart();
  const colorsOf = i => [i.color, ...(i.extra || [])];
  const keyOf = i => [i.id, i.mat, i.size ?? '', ...colorsOf(i), i.note, JSON.stringify(i.opts || {})].join('|');
  const optsText = (i, translate = true) => Object.entries(i.opts || {}).map(([k, v]) => `${translate ? t(k) : k}: ${translate ? t(v) : v}`).join(' · ');
  const lineTotal = i => unitPrice(byId(i.id), i.mat, colorsOf(i), i.size) * i.qty;
  const subtotal = () => cart.reduce((s, i) => s + lineTotal(i), 0);
  let extras = null;      // експресна изработка и промокод (кутията в количката)
  let lastTotals = null;
  const totals = () => S.totals(subtotal(), extras?.express());
  const cartTotal = () => totals().total;

  // ---------- Продукти ----------
  const grid = $('#products');
  grid.innerHTML = shown.map(p => `
    <button class="product" type="button" data-id="${p.id}" data-cat="${p.cat}">
      <span class="product-media">${imgHTML(p, pick(p, 'name'))}</span>
      <span class="product-body">
        <span class="product-cat mono">${t(categories[p.cat])}</span>
        <span class="product-name">${esc(pick(p, 'name'))}</span>
        ${p.fits ? `<span class="product-fit">${esc(fitText(p))}</span>` : ''}
        <span class="product-foot">
          <span class="product-price"><small>${t('от')}</small>${fmt(fromPrice(p))}</span>
        </span>
      </span>
    </button>`).join('');
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG') e.target.parentElement.classList.add('noimg');
  }, true);
  const searchText = p => [p.name, p.desc, p.en?.name, p.en?.desc, categories[p.cat], t(categories[p.cat]), subLabel(p), subLabel(p) && t(subLabel(p)), ...(p.seasons || []).map(s => pick(seasons[s], 'label')),
    ...(p.fits || []).map(k => platforms[k].label), p.std].join(' ').toLowerCase();

  // ---------- Филтри, празници и търсене ----------
  const head = $('.catalog-head');
  const headDefaults = { eyebrow: $('#cat-eyebrow').textContent, title: $('#cat-title').innerHTML, lead: $('#cat-lead').textContent };
  const filters = $('#filters');
  const search = $('#catalog-search');
  let currentFilter = 'all';
  let currentSub = null;   // подкатегория в избраната категория
  let currentFit = null;   // airsoft: платформа (m4, ak, glock…)
  const subBox = $('#subfilters');
  const fitBox = $('#fitfilters');

  const renderFilters = () => {
    const keys = [['all', t('Всички'), shown.length]];
    if (season) keys.push([season.id, `${season.icon} ${pick(season, 'label')}`, shown.filter(p => p.seasons?.includes(season.id)).length, true]);
    Object.entries(categories).forEach(([k, v]) => {
      const n = shown.filter(p => p.cat === k).length;
      if (n) keys.push([k, t(v), n]);
    });
    filters.innerHTML = keys.map(([key, label, n, isSeason]) => `
      <button class="filter${isSeason ? ' filter-season' : ''}" type="button" data-filter="${key}" aria-pressed="${key === currentFilter}">${label}<span class="n">${n}</span></button>`).join('');
  };

  // втори ред: подкатегориите на избраната категория (само ако са поне 2 с продукти)
  const renderSubs = () => {
    const inCat = shown.filter(p => p.cat === currentFilter);
    const keys = Object.entries(subcats[currentFilter] || {})
      .map(([k, v]) => [k, t(v), inCat.filter(p => p.sub === k).length])
      .filter(([, , n]) => n);
    subBox.hidden = keys.length < 2;
    if (subBox.hidden) return;
    subBox.innerHTML = [['', t('Всички'), inCat.length], ...keys].map(([key, label, n]) => `
      <button class="subfilter" type="button" data-sub="${key}" aria-pressed="${(currentSub || '') === key}">${label}<span class="n">${n}</span></button>`).join('');
  };

  // трети ред (airsoft): „Пасва на“ M4 / AK / Glock… — универсалните се броят навсякъде
  const renderFits = () => {
    const inCat = shown.filter(p => p.cat === currentFilter && p.fits && (!currentSub || p.sub === currentSub));
    fitBox.hidden = !inCat.length;
    if (fitBox.hidden) return;
    const keys = [['', t('Всички'), inCat.length], ...Object.entries(platforms).map(([k, v]) => [k, t(v.label), inCat.filter(p => fitMatch(p, k)).length, t(v.hint)])];
    fitBox.innerHTML = `<span class="fit-label">${t('Пасва на:')}</span>`
      + keys.map(([key, label, n, hint]) => `
      <button class="subfilter" type="button" data-fit="${key}" aria-pressed="${(currentFit || '') === key}"${hint ? ` title="${esc(hint)}"` : ''}>${label}<span class="n">${n}</span></button>`).join('')
      + `<span class="fit-links"><a href="personalizirani.html#pozivna">${t('Табелка с позивна →')}</a><a href="poruchka.html">${t('Няма част за твоята реплика? Прати снимка и мерки →')}</a></span>`;
  };

  const renderHead = () => {
    const s = seasons[currentFilter];
    head.classList.toggle('is-season', !!s);
    if (s) {
      head.style.setProperty('--season-a', s.accent);
      head.style.setProperty('--season-b', s.accent2);
      $('#cat-eyebrow').textContent = `${s.icon} ${pick(s, 'label')}`;
      $('#cat-title').textContent = pick(s, 'title');
      $('#cat-lead').textContent = `${pick(s, 'text')} ${t('Последен ден за поръчка: {date}.', { date: dayMonth(season.orderBy) })}`;
    } else {
      $('#cat-eyebrow').textContent = headDefaults.eyebrow;
      $('#cat-title').innerHTML = headDefaults.title;
      $('#cat-lead').textContent = headDefaults.lead;
    }
  };

  const apply = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    $$('.product', grid).forEach(el => {
      const p = byId(el.dataset.id);
      const inFilter = (currentFilter === 'all' || p.cat === currentFilter || p.seasons?.includes(currentFilter)) && (!currentSub || p.sub === currentSub)
        && (!currentFit || (p.fits && fitMatch(p, currentFit)));
      el.hidden = !(inFilter && (!q || searchText(p).includes(q)));
      // при избрана платформа частите точно за нея са първи, универсалните — след тях
      el.style.order = currentFit && currentFit !== 'universal' && p.fits?.includes(currentFit) ? -1 : '';
      if (!el.hidden) shown++;
    });
    $('#no-results').hidden = shown > 0;
  };

  // origin = бутонът, от който да изскочат празничните анимации (fx.js)
  // f = 'категория', 'категория/подкатегория' (напр. airsoft/gear), а за airsoft и ':платформа' (airsoft/mags:glock)
  const setFilter = (f, origin) => {
    const [path, fitKey] = String(f || '').split(':');
    const [cat, subKey] = path.split('/');
    currentFilter = categories[cat] || (cat && cat === activeSeason) ? cat : 'all';
    currentSub = subKey && subcats[currentFilter]?.[subKey] ? subKey : null;
    currentFit = fitKey && platforms[fitKey] && shown.some(p => p.cat === currentFilter && p.fits) ? fitKey : null;
    renderFilters();
    renderSubs();
    renderFits();
    renderHead();
    // на телефон редовете с категории се превъртат — избраната да се вижда
    [$('.filter[aria-pressed="true"]', filters), $('.subfilter[aria-pressed="true"]', subBox)].forEach(b => {
      const row = b?.parentElement;
      if (!row || row.scrollWidth <= row.clientWidth) return;
      const br = b.getBoundingClientRect(), rr = row.getBoundingClientRect();
      row.scrollLeft += br.left - rr.left - (rr.width - br.width) / 2;
    });
    apply();
    if (seasons[currentFilter]) window.SLOY_FX?.play(currentFilter, origin || $('#cat-title'));
    else window.SLOY_FX?.stop();
  };
  const filterKey = (sub = currentSub, fit = currentFit) => currentFilter + (sub ? '/' + sub : '') + (fit ? ':' + fit : '');
  const syncHash = () => history.replaceState(null, '', currentFilter === 'all' ? location.pathname : '#' + filterKey());
  subBox.addEventListener('click', e => {
    const b = e.target.closest('.subfilter');
    if (!b) return;
    setFilter(filterKey(b.dataset.sub || null));
    syncHash();
  });
  fitBox.addEventListener('click', e => {
    const b = e.target.closest('.subfilter');
    if (!b) return;
    setFilter(filterKey(currentSub, b.dataset.fit || null));
    syncHash();
  });
  filters.addEventListener('click', e => {
    const b = e.target.closest('.filter');
    if (!b) return;
    setFilter(b.dataset.filter, b);
    syncHash();
  });
  search.addEventListener('input', apply);

  // ---------- Панел на продукта ----------
  const pdEl = $('#product-drawer');
  const pd = { product: null, mat: null, color: null, ncolors: 1, extra: [], qty: 1, size: 0 };

  // 3D преглед — появява се, ако има файл models/<id>.glb или .stl (размер с model: — свой файл)
  let viewerModule = null;
  let viewer = null;
  let modelToken = 0;
  // изгледи: photo = студийната снимка, 3d = въртящ се модел в избрания цвят, author = снимката на автора (реален принт)
  const setView = v => {
    const p = pd.product;
    $('#pd-3d').hidden = v !== '3d';
    $('#pd-img').hidden = v === '3d';
    $('#pd-3d-hint').hidden = v !== '3d';
    if (p && v !== '3d') {
      const src = v === 'author' ? p.mw.img : photoOf(p);
      if ($('#pd-img').getAttribute('src') !== src) $('#pd-img').src = src;
    }
    $$('#pd-views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  const showViews = has3D => {
    const own = studio(pd.product);
    $('#pd-views [data-view="3d"]').hidden = !has3D;
    $('#pd-views [data-view="author"]').hidden = !own;
    $('#pd-views').hidden = !has3D && !own;
  };
  const paint3D = () => {
    if (!viewer) return;
    viewer.setFinish(S.finishFor(pd.mat, pd.color));
    viewer.setColor(S.previewColor(pd.color));
  };
  // swap = смяна на размера: изгледът (3D или снимка) остава, сменя се само моделът
  const try3D = async (p, swap = false) => {
    const token = ++modelToken;
    const name = p.sizes?.[pd.size]?.model || p.id;
    if (!swap) {
      showViews(false);
      setView('photo');
    }
    try {
      // 3D прегледът от MakerWorld (.glb), а ако го няма — собствен STL
      let kind = 'glb';
      let res = await fetch(`models/${name}.glb`);
      if (!res.ok) { kind = 'stl'; res = await fetch(`models/${name}.stl`); }
      if (!res.ok || token !== modelToken) return;
      const buffer = await res.arrayBuffer();
      viewerModule ||= await import('./viewer.js');
      if (token !== modelToken) return;
      const model = kind === 'glb' ? await viewerModule.parseGLB(buffer) : viewerModule.parseSTL(buffer);
      if (token !== modelToken) return;
      if ($('#pd-views [data-view="3d"]').hidden) showViews(true);
      viewer ||= viewerModule.createViewer($('#pd-3d'));
      viewer.load(model.positions);
      paint3D();
    } catch { /* няма 3D файл или браузърът не поддържа WebGL — остава снимката */ }
  };
  $('#pd-views').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) setView(b.dataset.view);
  });

  const renderPrice = () => {
    const u = unitPrice(pd.product, pd.mat, [pd.color, ...pd.extra], pd.size);
    $('#pd-price').textContent = fmt(u * pd.qty);
    $('#pd-unit').textContent = pd.qty > 1 ? t('{price} / бр.', { price: fmt(u) }) : '';
    $('#pd-qty').value = pd.qty;
  };

  // ---------- Размер ----------
  // подсказката при задържане на мишката: мерки, пояснение и цена в избрания материал и цвят
  const sizeTipHTML = i => {
    const s = pd.product.sizes[i];
    const dims = dimsText(s.dims, s.approx);
    return `<strong>${esc(t(s.label))}</strong>`
      + [dims && esc(t('Размери: {d}', { d: dims })), s.note && esc(t(s.note))].filter(Boolean).join('<br>')
      + `<em>${t('Цена: {price} / бр.', { price: fmt(unitPrice(pd.product, pd.mat, [pd.color, ...pd.extra], i)) })}</em>`;
  };
  const renderSizeInfo = () => {
    const s = pd.product.sizes[pd.size];
    const dims = dimsText(s.dims, s.approx);
    $('#pd-size-info').textContent = [dims && t('Размери: {d}', { d: dims }), s.note && t(s.note)].filter(Boolean).join(' · ');
  };
  const renderSizes = () => {
    const p = pd.product;
    $('#pd-size-opt').hidden = !p.sizes;
    $('#pd-dims').hidden = !!p.sizes || !p.dims;
    if (!p.sizes) {
      $('#pd-dims').textContent = p.dims ? t('Размери: {d}', { d: dimsText(p.dims, p.approx) }) : '';
      return;
    }
    $('#pd-sizes').innerHTML = p.sizes.map((s, i) => `
      <label class="chip size-chip" data-size="${i}"><input type="radio" name="pd-size" value="${i}"${i === pd.size ? ' checked' : ''}><span>${esc(t(s.label))}</span></label>`).join('');
    renderSizeInfo();
  };
  $('#pd-sizes').addEventListener('change', e => {
    pd.size = +e.target.value;
    renderSizeInfo();
    renderPrice();
    if (pd.product.sizes.some(s => s.model)) try3D(pd.product, true);
  });
  S.bindTips($('#pd-sizes'), '.size-chip', l => sizeTipHTML(+l.dataset.size), $('.drawer-panel', pdEl));
  const renderExtra = () => {
    pd.extra = S.fitExtra(pd.mat, pd.color, pd.extra, pd.ncolors);
    $('#pd-extra-colors').innerHTML = S.extraColorsHTML(pd.mat, pd.extra, 'pd-color');
  };
  const renderMaterial = () => {
    const list = S.colorsFor(pd.mat);
    if (!list.some(c => c.name === pd.color)) pd.color = list[0].name;
    $('#pd-colors').innerHTML = S.swatchesHTML(pd.mat, pd.color, 'pd-color');
    $('#pd-color-name').textContent = t(pd.color);
    // многоцветен печат — само ако моделът го позволява (maxColors) и материалът има поне 2 цвята
    const cap = pd.product.maxColors || 1;
    const maxC = S.maxColorsFor(pd.mat, cap);
    pd.ncolors = Math.min(pd.ncolors, maxC);
    $('#pd-ncolors').innerHTML = S.ncolorsHTML(pd.ncolors, 'pd-ncolors', pd.mat, cap);
    $('#pd-ncolors').closest('.opt').hidden = maxC < 2;
    renderExtra();
    renderPrice();
    paint3D();
  };

  const openProduct = id => {
    const p = byId(id);
    if (!p || !isAvailable(p)) return;
    // цветът по подразбиране = цветът от снимката (ако го има за материала — иначе първият наличен)
    Object.assign(pd, { product: p, mat: firstMat(p), color: photoColors[p.id] || pd.color, ncolors: 1, extra: [], qty: 1, size: defSize(p) });
    const img = $('#pd-img');
    img.parentElement.classList.remove('noimg');
    img.src = photoOf(p);
    if (studio(p)) img.dataset.fallback = p.mw.img;
    img.alt = pick(p, 'name');
    $('#pd-cat').textContent = t(categories[p.cat]) + (subLabel(p) ? ' · ' + t(subLabel(p)) : '');
    $('#pd-title').textContent = pick(p, 'name');
    $('#pd-desc').textContent = pick(p, 'desc');
    const asm = p.assembly && S.assemblyItems(p.assembly);
    $('#pd-assembly').hidden = !p.assembly;
    $('#pd-assembly').textContent = p.assembly ? t('Сглобяваме го ние') + (asm ? ` · ${t('В комплекта:')} ${asm}` : '') : '';
    $('#pd-note').value = '';
    // airsoft: на какво пасва + „пасва или препринтираме“
    $('#pd-fit').hidden = !p.fits;
    $('#pd-fit-on').textContent = p.fits ? t('Пасва на: {list}', { list: fitText(p) }) : '';
    renderSizes();
    // избор под продукта (напр. модел на телефона, марка на репликата)
    const opts = p.options || [];
    $('#pd-options').hidden = !opts.length;
    $('#pd-options').innerHTML = opts.map(o => `
      <label class="field"><span>${esc(t(o.label))} *</span>
        <select data-opt="${o.key}">
          <option value="">${t('Избери…')}</option>
          ${(o.groups || [[null, o.choices]]).map(([g, list]) => {
            const items = list.map(x => `<option value="${esc(x)}">${esc(t(x))}</option>`).join('');
            return g ? `<optgroup label="${esc(g)}">${items}</optgroup>` : items;
          }).join('')}
          ${o.other ? `<option value="__other">${esc(t(o.otherLabel || 'Друг модел — ще го напиша'))}</option>` : ''}
        </select>
      </label>
      ${o.other ? `<label class="field" data-other-for="${o.key}" hidden><span>${esc(t(o.otherAsk || 'Кой модел?'))} *</span><input data-opt-other="${o.key}" maxlength="60" placeholder="${esc(t(o.otherPlaceholder || 'напр. Motorola Edge 50'))}"></label>` : ''}
      ${o.hint ? `<p class="opt-note">${esc(t(o.hint))}</p>` : ''}`).join('');
    $('#pd-materials').innerHTML = S.materialsHTML(S.available(ALL), pd.mat, 'pd-mat', p.materials);
    const [licName, licUrl] = LICENSES[p.mw.lic];
    $('#pd-credit').innerHTML = `${t('Модел: „{title}“ от {by}', { title: esc(p.mw.title), by: esc(p.mw.by) })} · <a href="${licUrl}" target="_blank" rel="noopener license">${licName}</a> · <a href="${mwUrl(p)}" target="_blank" rel="noopener">${srcName(p)} ↗</a>`;
    renderMaterial();
    S.openDrawer(pdEl);
    history.replaceState(null, '', '#p-' + p.id);
    try3D(p);
  };

  grid.addEventListener('click', e => {
    const card = e.target.closest('.product');
    if (card) openProduct(card.dataset.id);
  });
  pdEl.addEventListener('drawer:close', () => { modelToken++; syncHash(); });
  $('#pd-materials').addEventListener('change', e => { pd.mat = e.target.value; renderMaterial(); });
  $('#pd-colors').addEventListener('change', e => {
    pd.color = e.target.value;
    $('#pd-color-name').textContent = t(pd.color);
    renderPrice();
    paint3D();
  });
  $('#pd-ncolors').addEventListener('change', e => { pd.ncolors = +e.target.value; renderExtra(); renderPrice(); });
  $('#pd-extra-colors').addEventListener('change', e => {
    const row = e.target.closest('.extra-color');
    pd.extra[+row.dataset.idx] = e.target.value;
    $('.opt-value', row).textContent = t(e.target.value);
    renderPrice();
  });
  $('#pd-minus').addEventListener('click', () => { pd.qty = clampQty(pd.qty - 1); renderPrice(); });
  $('#pd-plus').addEventListener('click', () => { pd.qty = clampQty(pd.qty + 1); renderPrice(); });
  $('#pd-qty').addEventListener('change', e => { pd.qty = clampQty(e.target.value); renderPrice(); });
  S.bindMaterialTips($('#pd-materials'), $('.drawer-panel', pdEl));
  // складът се обнови (Google таблицата) — отвореният продукт показва само наличното
  document.addEventListener('sloy:stock', () => {
    if (pdEl.hidden || !pd.product) return;
    if (!S.available([pd.mat]).length) pd.mat = firstMat(pd.product);
    $('#pd-materials').innerHTML = S.materialsHTML(S.available(ALL), pd.mat, 'pd-mat', pd.product.materials);
    renderMaterial();
  });

  // ---------- Количка ----------
  const cartEl = $('#cart-drawer');
  const saveCart = () => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* браузърът не позволява запис */ }
    renderCart();
  };
  const renderCart = () => {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    $$('[data-cart-count]').forEach(el => {
      if (el.textContent !== String(count)) {
        el.textContent = count;
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      }
    });
    $('#cart-items').innerHTML = cart.map((i, idx) => {
      const p = byId(i.id);
      return `
      <div class="cart-item" data-idx="${idx}">
        ${imgHTML(p, '')}
        <div>
          <p class="ci-name">${esc(pick(p, 'name'))}</p>
          <p class="ci-meta">${p.sizes ? `${esc(t(sizeOf(p, i.size).label))} · ` : ''}${t(materials[i.mat].label)} · ${esc(colorsOf(i).map(c => t(c)).join(' + '))}</p>
          ${i.opts ? `<p class="ci-meta">${esc(optsText(i))}</p>` : ''}
          ${i.note ? `<p class="ci-note">„${esc(i.note)}“</p>` : ''}
          <div class="ci-controls">
            <div class="stepper stepper-sm">
              <button type="button" data-act="dec" aria-label="${t('По-малко')}">−</button>
              <input value="${i.qty}" inputmode="numeric" aria-label="${t('Брой')}" data-act="qty">
              <button type="button" data-act="inc" aria-label="${t('Повече')}">+</button>
            </div>
            <button type="button" class="ci-remove" data-act="remove">${t('Премахни')}</button>
          </div>
        </div>
        <p class="ci-price">${fmt(lineTotal(i))}</p>
      </div>`;
    }).join('');
    $('#cart-empty').hidden = cart.length > 0;
    $('#cart-summary').hidden = cart.length === 0;
    const tt = totals();
    $$('[data-cart-total]').forEach(el => { el.textContent = fmt(tt.total); });
    $$('[data-sum-lines]').forEach(el => { el.innerHTML = cart.length ? S.sumLinesHTML(tt) : ''; });
  };

  const addToCart = item => {
    const same = cart.find(i => keyOf(i) === keyOf(item));
    if (same) same.qty = clampQty(same.qty + item.qty);
    else cart.push(item);
    saveCart();
  };

  $('#cart-items').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const idx = +b.closest('.cart-item').dataset.idx;
    const act = b.dataset.act;
    if (act === 'inc') cart[idx].qty = clampQty(cart[idx].qty + 1);
    if (act === 'dec') cart[idx].qty = clampQty(cart[idx].qty - 1);
    if (act === 'remove') cart.splice(idx, 1);
    saveCart();
    const again = $(`.cart-item[data-idx="${idx}"] [data-act="${act}"]`, cartEl);
    (again || $('.drawer-close', cartEl)).focus({ preventScroll: true });
  });
  $('#cart-items').addEventListener('change', e => {
    if (e.target.dataset.act !== 'qty') return;
    cart[+e.target.closest('.cart-item').dataset.idx].qty = clampQty(e.target.value);
    saveCart();
  });

  const showCartStep = step => {
    $('#cart-view').hidden = step !== 'cart';
    $('#checkout-form').hidden = step !== 'checkout';
    $('#checkout-success').hidden = step !== 'success';
    $('.drawer-panel', cartEl).scrollTop = 0;
  };
  const openCart = () => { showCartStep('cart'); S.openDrawer(cartEl); };
  document.addEventListener('click', e => { if (e.target.closest('[data-open-cart]')) openCart(); });

  $('#pd-options').addEventListener('change', e => {
    const sel = e.target.closest('select[data-opt]');
    if (!sel) return;
    const other = $(`[data-other-for="${sel.dataset.opt}"]`, pdEl);
    if (other) {
      other.hidden = sel.value !== '__other';
      if (!other.hidden) $('input', other).focus();
    }
    sel.classList.remove('invalid');
  });
  // отговорите на избора под продукта; null = нещо не е попълнено
  const readOptions = () => {
    const out = {};
    for (const o of pd.product.options || []) {
      const sel = $(`select[data-opt="${o.key}"]`, pdEl);
      let v = sel.value === '__other' ? $(`[data-opt-other="${o.key}"]`, pdEl).value.trim() : sel.value;
      if (!v) {
        const field = sel.value === '__other' ? $(`[data-opt-other="${o.key}"]`, pdEl) : sel;
        field.classList.add('invalid');
        field.focus();
        S.toast(t('Попълни: {label}', { label: t(o.label) }));
        return null;
      }
      out[o.label] = v;
    }
    return out;
  };

  $('#pd-add').addEventListener('click', () => {
    const opts = readOptions();
    if (!opts) return;
    addToCart({ id: pd.product.id, mat: pd.mat, color: pd.color, extra: [...pd.extra], note: $('#pd-note').value.trim(), qty: pd.qty,
      ...(pd.product.sizes ? { size: pd.size } : {}), ...(Object.keys(opts).length ? { opts } : {}) });
    S.closeDrawer(pdEl);
    S.toast(t('„{name}“ е в количката', { name: pick(pd.product, 'name') }), t('Виж количката'));
  });

  // ---------- Поръчка ----------
  const form = $('#checkout-form');
  $('#to-checkout').addEventListener('click', () => { showCartStep('checkout'); $('[name=name]', form).focus({ preventScroll: true }); });
  $('#back-to-cart').addEventListener('click', () => showCartStep('cart'));
  S.setupCheckout(form, {
    build: orderNo => {
      if (!cart.length) throw new Error('Празна количка');
      const total = fmt(cartTotal());
      const items = cart.map((i, n) => {
        const p = byId(i.id);
        const s = sizeOf(p, i.size);
        return `${n + 1}. ${p.name} — ${materials[i.mat].label}, ${colorsOf(i).join(' + ')} × ${i.qty} = ${fmt(lineTotal(i))} (≈ ${s.grams} г/бр.)`
          + (p.sizes ? `\n   Размер: ${s.label}${s.dims ? ` (${dimsText(s.dims, s.approx, bg)})` : ''}` : '')
          + (p.assembly ? `\n   Сглобяване: ${p.assembly.minutes || 0} мин${p.assembly.items ? ` · Консумативи: ${S.assemblyItems(p.assembly, false)}` : ''}` : '')
          + (i.opts ? `\n   ${optsText(i, false)}` : '')
          + (i.note ? `\n   Бележка: ${i.note}` : '')
          + `\n   Файл: ${mwUrl(p)}`;
      }).join('\n');
      lastTotals = totals();
      const lines = cart.map(i => {
        const p = byId(i.id);
        return `${pick(p, 'name')}${p.sizes ? ` (${t(sizeOf(p, i.size).label)})` : ''} — ${t(materials[i.mat].label)}, ${colorsOf(i).map(c => t(c)).join(' + ')} × ${i.qty} = ${fmt(lineTotal(i))}`;
      });
      return {
        subject: `Нова поръчка ${orderNo} — ${total}${lastTotals.express ? ' — ЕКСПРЕСНА' : ''}`,
        fields: { 'Продукти': items, ...S.totalsFields(lastTotals), 'Общо': lastTotals.freeShip ? `${total} (доставката е безплатна)` : `${total} + доставка` },
        lines, amount: lastTotals.total,
        use: cart.map(i => { const p = byId(i.id); return S.useOf(i.mat, colorsOf(i), sizeOf(p, i.size).grams, i.qty, p.assembly); }),
        total: total + (lastTotals.freeShip ? t(' (доставката е безплатна)') : t(' + доставка')),
      };
    },
    onSuccess: orderNo => {
      S.afterOrder(lastTotals, orderNo);
      extras.reset();
      cart = [];
      saveCart();
      $('#order-no').textContent = orderNo;
      showCartStep('success');
    },
  });

  // ---------- Старт ----------
  extras = S.mountExtras($('#cart-extras'), renderCart);
  addEventListener('hashchange', () => {
    const h = decodeURIComponent(location.hash.slice(1));
    if (!h.startsWith('p-')) setFilter(h);
  });
  renderCart();
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash.startsWith('p-') && byId(hash.slice(2)) && isAvailable(byId(hash.slice(2)))) {
    setFilter('all');
    openProduct(hash.slice(2));
  } else {
    setFilter(hash || 'all');
    if (hash === 'cart') openCart();
  }
})();

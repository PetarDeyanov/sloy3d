(() => {
  const S = window.SLOY_SHOP;
  const { categories, seasons, materials, products } = window.SLOY_CATALOG;
  const { esc, fmt, clampQty, t } = S;
  const { pick, dayMonth } = window.SLOY_I18N;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const byId = id => products.find(p => p.id === id);
  // цената идва от формулата (грамове, материал, цвят, печалба) и се закръгля до 0,50 €
  const unitPrice = (p, mat, picks) => Math.max(0.5, Math.round(S.priceFor({ grams: p.grams, hours: p.hours, mat, picks, assembly: p.assembly }) * 2) / 2);
  // всеки продукт може във всеки материал; p.materials са препоръчаните (първият е по подразбиране)
  const ALL = Object.keys(materials);
  const fromPrice = p => Math.min(...S.available(ALL).map(m => unitPrice(p, m)));
  // първият препоръчан материал, който е на склад
  const firstMat = p => p.materials.find(m => S.available([m]).length) || S.available(ALL)[0];
  const mwUrl = p => `https://makerworld.com/en/models/${p.mw.id}`;
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
      return raw.filter(i => byId(i.id) && isAvailable(byId(i.id)) && materials[i.mat]);
    } catch { return []; }
  };
  let cart = loadCart();
  const colorsOf = i => [i.color, ...(i.extra || [])];
  const keyOf = i => [i.id, i.mat, ...colorsOf(i), i.note].join('|');
  const lineTotal = i => unitPrice(byId(i.id), i.mat, colorsOf(i)) * i.qty;
  const subtotal = () => cart.reduce((s, i) => s + lineTotal(i), 0);
  let extras = null;      // експресна изработка и промокод (кутията в количката)
  let lastTotals = null;
  const totals = () => S.totals(subtotal(), extras?.express());
  const cartTotal = () => totals().total;

  // ---------- Продукти ----------
  const grid = $('#products');
  grid.innerHTML = shown.map(p => `
    <button class="product" type="button" data-id="${p.id}" data-cat="${p.cat}">
      <span class="product-media"><img src="${p.mw.img}" alt="${esc(pick(p, 'name'))}" loading="lazy" referrerpolicy="no-referrer"></span>
      <span class="product-body">
        <span class="product-cat mono">${t(categories[p.cat])}</span>
        <span class="product-name">${esc(pick(p, 'name'))}</span>
        <span class="product-foot">
          <span class="product-price"><small>${t('от')}</small>${fmt(fromPrice(p))}</span>
        </span>
      </span>
    </button>`).join('');
  document.addEventListener('error', e => {
    if (e.target.tagName === 'IMG') e.target.parentElement.classList.add('noimg');
  }, true);
  const searchText = p => [p.name, p.desc, p.en?.name, p.en?.desc, categories[p.cat], t(categories[p.cat]), subLabel(p), subLabel(p) && t(subLabel(p)), ...(p.seasons || []).map(s => pick(seasons[s], 'label'))].join(' ').toLowerCase();

  // ---------- Филтри, празници и търсене ----------
  const head = $('.catalog-head');
  const headDefaults = { eyebrow: $('#cat-eyebrow').textContent, title: $('#cat-title').innerHTML, lead: $('#cat-lead').textContent };
  const filters = $('#filters');
  const search = $('#catalog-search');
  let currentFilter = 'all';
  let currentSub = null;   // подкатегория в избраната категория
  const subBox = $('#subfilters');

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
      const inFilter = (currentFilter === 'all' || p.cat === currentFilter || p.seasons?.includes(currentFilter)) && (!currentSub || p.sub === currentSub);
      el.hidden = !(inFilter && (!q || searchText(p).includes(q)));
      if (!el.hidden) shown++;
    });
    $('#no-results').hidden = shown > 0;
  };

  // origin = бутонът, от който да изскочат празничните анимации (fx.js)
  // f = 'категория' или 'категория/подкатегория' (напр. airsoft/gear)
  const setFilter = (f, origin) => {
    const [cat, subKey] = String(f || '').split('/');
    currentFilter = categories[cat] || (cat && cat === activeSeason) ? cat : 'all';
    currentSub = subKey && subcats[currentFilter]?.[subKey] ? subKey : null;
    renderFilters();
    renderSubs();
    renderHead();
    apply();
    if (seasons[currentFilter]) window.SLOY_FX?.play(currentFilter, origin || $('#cat-title'));
    else window.SLOY_FX?.stop();
  };
  const syncHash = () => history.replaceState(null, '', currentFilter === 'all' ? location.pathname : '#' + currentFilter + (currentSub ? '/' + currentSub : ''));
  subBox.addEventListener('click', e => {
    const b = e.target.closest('.subfilter');
    if (!b) return;
    setFilter(currentFilter + (b.dataset.sub ? '/' + b.dataset.sub : ''));
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
  const pd = { product: null, mat: null, color: null, ncolors: 1, extra: [], qty: 1 };

  // 3D преглед — появява се, ако има файл models/<id>.stl
  let viewerModule = null;
  let viewer = null;
  let modelToken = 0;
  const setView = v => {
    $('#pd-3d').hidden = v !== '3d';
    $('#pd-img').hidden = v === '3d';
    $('#pd-3d-hint').hidden = v !== '3d';
    $$('#pd-views button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  };
  const paint3D = () => {
    if (!viewer) return;
    viewer.setFinish(S.finishFor(pd.mat, pd.color));
    viewer.setColor(S.previewColor(pd.color));
  };
  const try3D = async p => {
    const token = ++modelToken;
    $('#pd-views').hidden = true;
    setView('photo');
    try {
      // 3D прегледът от MakerWorld (.glb), а ако го няма — собствен STL
      let kind = 'glb';
      let res = await fetch(`models/${p.id}.glb`);
      if (!res.ok) { kind = 'stl'; res = await fetch(`models/${p.id}.stl`); }
      if (!res.ok || token !== modelToken) return;
      const buffer = await res.arrayBuffer();
      viewerModule ||= await import('./viewer.js');
      if (token !== modelToken) return;
      const model = kind === 'glb' ? await viewerModule.parseGLB(buffer) : viewerModule.parseSTL(buffer);
      if (token !== modelToken) return;
      $('#pd-views').hidden = false;
      setView('3d');
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
    const u = unitPrice(pd.product, pd.mat, [pd.color, ...pd.extra]);
    $('#pd-price').textContent = fmt(u * pd.qty);
    $('#pd-unit').textContent = pd.qty > 1 ? t('{price} / бр.', { price: fmt(u) }) : '';
    $('#pd-qty').value = pd.qty;
  };
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
    Object.assign(pd, { product: p, mat: firstMat(p), ncolors: 1, extra: [], qty: 1 });
    const img = $('#pd-img');
    img.parentElement.classList.remove('noimg');
    img.src = p.mw.img;
    img.alt = pick(p, 'name');
    $('#pd-cat').textContent = t(categories[p.cat]) + (subLabel(p) ? ' · ' + t(subLabel(p)) : '');
    $('#pd-title').textContent = pick(p, 'name');
    $('#pd-desc').textContent = pick(p, 'desc');
    const asm = p.assembly && S.assemblyItems(p.assembly);
    $('#pd-assembly').hidden = !p.assembly;
    $('#pd-assembly').textContent = p.assembly ? t('Сглобяваме го ние') + (asm ? ` · ${t('В комплекта:')} ${asm}` : '') : '';
    $('#pd-note').value = '';
    $('#pd-materials').innerHTML = S.materialsHTML(S.available(ALL), pd.mat, 'pd-mat', p.materials);
    const [licName, licUrl] = LICENSES[p.mw.lic];
    $('#pd-credit').innerHTML = `${t('Модел: „{title}“ от {by}', { title: esc(p.mw.title), by: esc(p.mw.by) })} · <a href="${licUrl}" target="_blank" rel="noopener license">${licName}</a> · <a href="${mwUrl(p)}" target="_blank" rel="noopener">MakerWorld ↗</a>`;
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
        <img src="${p.mw.img}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div>
          <p class="ci-name">${esc(pick(p, 'name'))}</p>
          <p class="ci-meta">${t(materials[i.mat].label)} · ${esc(colorsOf(i).map(c => t(c)).join(' + '))}</p>
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

  $('#pd-add').addEventListener('click', () => {
    addToCart({ id: pd.product.id, mat: pd.mat, color: pd.color, extra: [...pd.extra], note: $('#pd-note').value.trim(), qty: pd.qty });
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
        return `${n + 1}. ${p.name} — ${materials[i.mat].label}, ${colorsOf(i).join(' + ')} × ${i.qty} = ${fmt(lineTotal(i))} (≈ ${p.grams} г/бр.)`
          + (p.assembly ? `\n   Сглобяване: ${p.assembly.minutes || 0} мин${p.assembly.items ? ` · Консумативи: ${S.assemblyItems(p.assembly, false)}` : ''}` : '')
          + (i.note ? `\n   Бележка: ${i.note}` : '')
          + `\n   Файл: ${mwUrl(p)}`;
      }).join('\n');
      lastTotals = totals();
      return {
        subject: `Нова поръчка ${orderNo} — ${total}${lastTotals.express ? ' — ЕКСПРЕСНА' : ''}`,
        fields: { 'Продукти': items, ...S.totalsFields(lastTotals), 'Общо': lastTotals.freeShip ? `${total} (доставката е безплатна)` : `${total} + доставка` },
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

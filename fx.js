// Празнични анимации в каталога: пускат се, когато клиентът отвори празничната страница (напр. 🎃 Хелоуин).
// Всичко е украса и не пречи на кликовете. При „намалено движение“ в настройките на устройството нищо не лети —
// прилепите, луната и паякът само се появяват и изчезват плавно.
// SLOY_FX.play('halloween', бутон) — шоу + бонбони от бутона; SLOY_FX.stop() — при смяна на филтъра.
window.SLOY_FX = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const rand = (a, b) => a + Math.random() * (b - a);
  const small = () => innerWidth < 640;
  let layer = null;
  let active = null;
  let timers = [];
  let spider = null;

  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const ensureLayer = () => {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.append(layer);
    }
    return layer;
  };
  const add = (cls, html, life, vars = {}) => {
    const el = document.createElement('div');
    el.className = cls;
    el.innerHTML = html;
    Object.entries(vars).forEach(([k, v]) => el.style.setProperty(k, v));
    ensureLayer().append(el);
    if (life) setTimeout(() => el.remove(), life);
    return el;
  };

  // ---------- Рисунки ----------
  const BAT = `<svg viewBox="0 0 100 48">
    <path class="wing wing-l" d="M50 24C42 8 24 4 3 11c8 4 10 10 8 18 7-6 15-5 19 3 3-8 11-9 20-4z"/>
    <path class="wing wing-r" d="M50 24c8-16 26-20 47-13-8 4-10 10-8 18-7-6-15-5-19 3-3-8-11-9-20-4z"/>
    <ellipse cx="50" cy="27" rx="7" ry="10"/><path d="M44 19l1-9 4 7zM56 19l-1-9-4 7z"/>
    <circle class="eye" cx="47" cy="24" r="1.6"/><circle class="eye" cx="53" cy="24" r="1.6"/></svg>`;
  const GHOST = `<svg viewBox="0 0 60 72">
    <path class="body" d="M6 34C6 16 16 4 30 4s24 12 24 30v30l-7-6-7 8-7-8-7 8-7-8-7 8-6-6z"/>
    <ellipse class="face" cx="22" cy="30" rx="4" ry="6"/><ellipse class="face" cx="38" cy="30" rx="4" ry="6"/>
    <ellipse class="face" cx="30" cy="45" rx="4" ry="5"/></svg>`;
  const SPIDER = `<svg viewBox="0 0 60 52">
    <g class="legs"><path d="M24 26 8 14 2 24M24 30 6 30 2 40M36 26l16-12 6 10M36 30h18l4 10"/><path d="M25 34 12 44l-2 8M35 34l13 10 2 8"/></g>
    <circle cx="30" cy="32" r="12"/><circle cx="30" cy="18" r="7"/>
    <circle class="eye" cx="27" cy="17" r="2"/><circle class="eye" cx="33" cy="17" r="2"/></svg>`;
  const PUMPKIN = `<svg viewBox="0 0 40 38"><path d="M20 10c0-4 2-7 6-8" fill="none" stroke="#3f6b1f" stroke-width="3" stroke-linecap="round"/>
    <g fill="#ff7a1a" stroke="#17151f" stroke-width="2"><ellipse cx="12" cy="24" rx="9" ry="12"/><ellipse cx="28" cy="24" rx="9" ry="12"/><ellipse cx="20" cy="24" rx="8" ry="13"/></g>
    <path d="M12 20l4 4H9zM28 20l4 4h-7z" fill="#17151f"/><path d="M12 30q8 5 16 0" fill="none" stroke="#17151f" stroke-width="2" stroke-linecap="round"/></svg>`;
  const CANDY = c => `<svg viewBox="0 0 44 24"><path d="M12 12 2 3v18zM32 12l10-9v18z" fill="#c6f432" stroke="#17151f" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="22" cy="12" r="10" fill="${c}" stroke="#17151f" stroke-width="2"/><path d="M16 9q6 7 12 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;

  // ---------- Елементи ----------
  const bat = (delay = 0) => later(() => {
    if (document.hidden) return;
    const d = rand(3.2, 5.5);
    const rtl = Math.random() < 0.4;
    add(`fx-bat${rtl ? ' rtl' : ''}`, `<div>${BAT}</div>`, d * 1000 + 100, {
      '--y': `${rand(8, 62)}vh`, '--s': `${rand(small() ? 34 : 44, small() ? 60 : 90)}px`, '--d': `${d}s`,
    });
  }, delay);
  const ghost = (delay = 0) => later(() => {
    if (document.hidden) return;
    const d = rand(4.5, 6.5);
    add('fx-ghost', `<div>${GHOST}</div>`, d * 1000 + 100, {
      '--x': `${rand(4, 88)}vw`, '--s': `${rand(small() ? 44 : 56, small() ? 64 : 92)}px`, '--d': `${d}s`,
    });
  }, delay);
  const dropSpider = (calm = false) => {
    if (spider) return;
    // конецът и паякът са едно цяло: конецът расте, докато паякът слиза, и двамата се люлеят от горната точка
    spider = add(`fx-spider${calm ? ' calm' : ''}`, `<div class="swing"><span class="thread"></span>${SPIDER}</div>`, 0, { '--y': `${small() ? 96 : 130}px` });
  };
  // прилеп, който само се появява и изчезва на място (за „намалено движение“)
  const stillBat = () => add('fx-still fx-calm', BAT, 4100, {
    '--x': `${rand(5, 85)}vw`, '--y': `${rand(12, 55)}vh`, '--s': `${rand(36, 70)}px`,
  });
  const liftSpider = () => {
    if (!spider) return;
    const s = spider;
    spider = null;
    s.classList.add('up');
    setTimeout(() => s.remove(), 900);
  };

  // бонбони, тикви и прилепчета изскачат от бутона и падат
  const burst = origin => {
    const r = origin?.getBoundingClientRect?.() || { left: innerWidth / 2 - 20, top: innerHeight * 0.3, width: 40, height: 0 };
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const kinds = [PUMPKIN, PUMPKIN, CANDY('#9b5cff'), CANDY('#ff5fa2'), CANDY('#ff7a1a'), `<div class="mini-bat">${BAT}</div>`];
    const bits = Array.from({ length: small() ? 16 : 26 }, () => {
      const el = add('fx-bit', kinds[Math.floor(Math.random() * kinds.length)]);
      el.style.width = `${rand(22, 38)}px`;
      return { el, x: x0, y: y0, vx: rand(-7, 7), vy: rand(-15, -6), r: rand(0, 360), vr: rand(-12, 12), life: rand(1300, 2000) };
    });
    const t0 = performance.now();
    let last = t0;
    const step = now => {
      const dt = Math.min(2, (now - last) / 16.7);
      last = now;
      let alive = 0;
      bits.forEach(b => {
        const age = now - t0;
        if (age > b.life) { b.el.remove(); return; }
        alive++;
        b.vy += 0.42 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.r += b.vr * dt;
        const fade = Math.min(1, (b.life - age) / (b.life * 0.3));
        b.el.style.transform = `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) rotate(${b.r}deg)`;
        b.el.style.opacity = fade;
      });
      if (alive) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // ---------- Шоута по празници ----------
  // calm = устройството е с „намалено движение“: нищо не лети, само се появява и изчезва плавно
  const SHOWS = {
    halloween: (origin, calm) => {
      if (calm) {
        add('fx-dim fx-calm', '', 4100);
        add('fx-moon fx-calm', '', 4100);
        for (let i = 0; i < 5; i++) stillBat();
        dropSpider(true);
        return;
      }
      add('fx-dim', '', 3700);
      add('fx-moon', '', 3700);
      for (let i = 0; i < (small() ? 7 : 12); i++) bat(i * rand(120, 260));
      for (let i = 0; i < 3; i++) ghost(400 + i * 650);
      later(dropSpider, 600);
      burst(origin);
      // докато е отворена празничната страница: от време на време прелита прилеп или излита призрак
      const ambient = () => {
        if (active !== 'halloween') return;
        if (Math.random() < 0.7) bat(); else ghost();
        later(ambient, rand(7000, 13000));
      };
      later(ambient, 6000);
    },
  };

  const stop = () => {
    active = null;
    timers.forEach(clearTimeout);
    timers = [];
    liftSpider();
  };
  const play = (id, origin) => {
    if (!SHOWS[id]) { stop(); return; }
    if (active === id) { if (!reduce.matches) burst(origin); return; }   // втори клик — само бонбоните
    stop();
    active = id;
    SHOWS[id](origin, reduce.matches);
  };

  return { play, stop };
})();

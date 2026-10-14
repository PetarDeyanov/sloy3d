// Цени (ceni.html): картите „Малки / Средни / Големи“ и бележките се смятат от каталога и от pricing
// в products.js — по същата формула като каталога, затова не се разминават, когато смениш цените.
(() => {
  const S = window.SLOY_SHOP;
  const { products, pricing } = window.SLOY_CATALOG;
  const { fmt, t } = S;
  const tiersBox = document.getElementById('price-tiers');
  const notesBox = document.getElementById('price-notes');
  if (!tiersBox) return;

  // цена на брой в PLA, закръглена като в каталога (до 0,50 €)
  const unit = p => Math.max(0.5, Math.round(S.priceFor({ grams: p.grams, hours: p.hours, mat: 'PLA', assembly: p.assembly }) * 2) / 2);
  const TIERS = [
    { label: 'Малки', max: 25, text: 'Ключодържатели, щипки, зарове, малки фигурки — до 25 г.' },
    { label: 'Средни', max: 120, text: 'Стойки, кашпи, органайзери, играчки — от 25 до 120 г.', featured: true },
    { label: 'Големи', max: Infinity, text: 'Лампи, шах, големи фигури и модели от няколко части — над 120 г.' },
  ];
  let from = 0;
  tiersBox.innerHTML = TIERS.map(tier => {
    const list = products.filter(p => p.grams > from && p.grams <= tier.max).map(unit).sort((a, b) => a - b);
    from = tier.max;
    if (!list.length) return '';
    const mid = list[Math.floor(list.length / 2)];
    return `
      <div class="price${tier.featured ? ' price-featured' : ''}">
        <p class="price-label">${t(tier.label)}</p>
        <p class="price-value"><small>${t('от')}</small>${fmt(list[0])}</p>
        <p>${t(tier.text)}</p>
        <p class="price-range">${t('В каталога: {min} – {max}, обикновено около {mid}', { min: fmt(list[0]), max: fmt(list[list.length - 1]), mid: fmt(mid) })}</p>
      </div>`;
  }).join('');

  if (notesBox) {
    notesBox.innerHTML = [
      t('Цените са в PLA — Silk, карбон и техническите материали са по-скъпи'),
      t('Минимална поръчка {min}', { min: fmt(pricing.minOrder) }),
      t('Безплатна доставка над {sum}', { sum: fmt(pricing.freeShippingFrom) }),
      t('{pct}% отстъпка за първата поръчка', { pct: Math.round(pricing.firstOrderDiscount * 100) }),
      t('Експресна изработка до {days} работни дни: +{pct}%', { days: pricing.expressDays, pct: Math.round(pricing.expressRate * 100) }),
      t('Серии от 10+ броя — до −20%'),
      t('Оферта за твоя идея — безплатно'),
    ].map(x => `<li>${x}</li>`).join('');
  }
})();

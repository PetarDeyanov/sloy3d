// Страницата след плащане с карта (Stripe връща клиента тук): проверява в Google таблицата дали поръчката е платена.
(() => {
  const { t } = window.SLOY_I18N;
  const cfg = window.SLOY_CONFIG || {};
  const q = new URLSearchParams(location.search);
  const order = q.get('order') || '';
  const session = q.get('session_id') || '';
  const box = document.getElementById('pay-status');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const show = (kind, title, text, link) => {
    box.className = `pay-status ${kind}`;
    box.innerHTML = `<h1>${esc(title)}</h1>${text ? `<p>${esc(text)}</p>` : ''}`
      + (link ? `<a class="btn btn-primary" href="${esc(link)}">${esc(t('Плати сега'))}</a>` : `<a class="btn btn-ghost" href="katalog.html">${esc(t('Към каталога'))}</a>`);
  };
  if (!/^SL-\d{6}-\d{3,4}$/.test(order)) {
    show('warn', t('Няма такава поръчка'), t('Провери линка от имейла или ни пиши.'));
    return;
  }
  if (q.get('cancel')) {
    show('warn', t('Плащането е прекъснато'), t('Поръчка {order} е записана, но не е платена. Линкът за плащане е в имейла ти — или ни пиши и ще ти изпратим нов.', { order }));
    return;
  }
  show('', t('Проверяваме плащането…'), '');
  box.querySelector('.btn')?.remove();
  fetch(cfg.appsScriptUrl, { method: 'POST', body: JSON.stringify({ action: 'payCheck', order, session }) })
    .then(r => r.json())
    .then(j => {
      if (!j.ok) throw new Error(j.error);
      if (j.paid) show('ok', t('Плащането е прието ✓'), t('Благодарим! Поръчка {order} е платена. Ще ти пишем, когато тръгне към теб.', { order }));
      else show('warn', t('Плащането още не е потвърдено'), t('Ако си платил, ще го видим до няколко минути. Ако не си — можеш да опиташ пак.'), j.url);
    })
    .catch(() => show('warn', t('Плащане'), t('Не успяхме да проверим плащането. Опитай да презаредиш страницата или ни пиши.')));
})();

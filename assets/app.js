/* Прототип «Victory Park — сайт с нуля по разбору Ильи». Экраны главного пути:
   аттракционы → «Ваш день» → проверка заказа → демо-оплата → билет с QR → «Мои билеты». */
(function () {
  'use strict';

  var D = window.YVN_DATA, S = window.YVNStore, C = window.YVNCalc, Q = window.VPQR;
  var lang = document.documentElement.getAttribute('data-lang') || 'ru';
  var T = window.YVN_I18N[lang];
  var LANGS = ['ru', 'en', 'hy'];
  var PACK_PRICE = 800;
  var PACKS = [3, 5, 10, 20, 30, 40, 60, 80, 100].map(function (n) { return { size: n, price: n * PACK_PRICE }; });
  var HITS = 5;
  var PAY_DELAY = 700;                       // «банк думает», мс
  var CONSENT_ROW = 44;                      // высота плашки согласия, под которую заранее оставлено место
  function sumRow() { return window.innerWidth < 520 ? 54 : 40; }   // высота строки суммы (как в app.css: до 519 px — две строки, уже 360 px — сколько нужно)
  var OPEN_STATUSES = ['new', 'cancelled', 'failed', 'processing', 'unknown'];

  var byId = {}, prices = {};
  D.rides.forEach(function (r) { byId[r.id] = r; prices[r.id] = r.price; });
  var params = new URLSearchParams(location.search);
  /* служебный параметр проверки: ?pause=kobra,koleso ставит аттракционы на паузу на время сеанса */
  var qaPause = (params.get('pause') || '').split(',').filter(Boolean);
  function isPaused(r) { return r.paused || qaPause.indexOf(r.id) >= 0; }

  var state = S.load(D.rides.map(function (r) { return r.id; }));
  /* Первым стоит автодром: решение Константина 20.11.2026 по совету Ильи (S305). ?first=passes — прежний вариант для сравнения, колесо первым */
  var qFirst = params.get('first');
  state.first = qFirst === 'passes' ? 'passes' : 'autodrom'; // выбор не запоминается: без параметра всегда автодром первым
  /* платёж, оборванный перезагрузкой: исход неизвестен, второй раз платить нельзя */
  S.orders().forEach(function (o) {
    if (o.status !== 'processing') return;
    o.status = 'unknown';
    var a = o.attempts[o.attempts.length - 1]; if (a && !a.outcome) a.outcome = 'interrupted';
    S.putOrder(o);
  });

  var view = document.getElementById('view'), dock = document.getElementById('dock'), sheet = document.getElementById('sheet'), mine = document.getElementById('mine');
  var scrollMemo = {}, lastRoute = null, busy = false, payError = '';

  // ---------- мелкие помощники ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0'); }
  function money(n) { return num(n) + '\u00A0֏'; }
  function approx(n) { return T.cur(num(n / D.currency.RUB), num(n / D.currency.USD)); }
  function dmy(iso) { var p = iso.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function name(r) { return r.names[lang] || r.names.ru; }
  function text(r) { var t = T.rides[r.id]; return t ? { line: t[0], tags: t[1] } : { line: name(r), tags: T.cats[r.cat] || [] }; }
  function persons() { return S.people(state.company, T); }
  function save() { S.save(state); }
  function route() {
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    return { name: parts[0] || 'home', arg: parts[1] || null };
  }
  function yerevanParts(date) {
    var out = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Yerevan', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
        .formatToParts(date).forEach(function (p) { out[p.type] = p.value; });
    } catch (e) {
      out = { weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()], day: ('0' + date.getDate()).slice(-2), month: ('0' + (date.getMonth() + 1)).slice(-2),
        year: String(date.getFullYear()), hour: ('0' + date.getHours()).slice(-2), minute: ('0' + date.getMinutes()).slice(-2) };
    }
    return out;
  }
  function yerevanDay() { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(yerevanParts(new Date()).weekday); }
  function stamp(iso, withTime) { var p = yerevanParts(new Date(iso)); return p.day + '.' + p.month + '.' + p.year + (withTime ? ' ' + p.hour + ':' + p.minute : ''); }
  function plusDays(iso, days) { return new Date(Date.parse(iso) + days * 86400000).toISOString(); }

  // ---------- подборка ----------
  /* Основа — порядок по числу проходов в парке, автодром поставлен первым; ?first=passes — без этой перестановки. */
  function ordered() {
    var list = D.rides.slice();
    if (state.first === 'autodrom') {
      var at = -1; list.forEach(function (r, i) { if (r.id === 'autodrom') at = i; });
      if (at > 0) list.unshift(list.splice(at, 1)[0]);
    }
    return list;
  }
  /* Кого отметили в компании — тому свои категории. Отметили нескольких — карточки идут по очереди
     от каждой группы, чтобы первое для каждого оказалось наверху («чтобы никто не ушёл обиженным»). */
  function groups() {
    var c = state.company, out = [], seen = {};
    function add(cats) { var k = cats.join(); if (!seen[k]) { seen[k] = true; out.push(cats); } }
    if (c.her) add(['family']);
    if (c.him) add(['extreme', 'games']);
    if (c.kids > 0) add(['kids']);
    if (c.friends > 0) add(['extreme', 'games']);
    return out;
  }
  function lineup() {
    var gs = groups(), open = [], paused = [], pos = {};
    ordered().forEach(function (r, i) { pos[r.id] = i; (isPaused(r) ? paused : open).push(r); });
    var taken = {}, order = open;
    if (gs.length) {
      var queues = gs.map(function (cats) { return open.filter(function (r) { return cats.indexOf(r.cat) >= 0; }); })
        .filter(function (q) { return q.length; })
        .sort(function (x, y) { return pos[x[0].id] - pos[y[0].id]; });
      var fitList = [], more = true;
      while (more) {
        more = false;
        queues.forEach(function (q) {
          while (q.length && taken[q[0].id]) q.shift();
          if (q.length) { var r = q.shift(); taken[r.id] = true; fitList.push(r); more = true; }
        });
      }
      order = fitList.concat(open.filter(function (r) { return !taken[r.id]; }));
    } if (state.first === 'autodrom') order = order.filter(function (r) { return r.id === 'autodrom'; }).concat(order.filter(function (r) { return r.id !== 'autodrom'; })); // первым при любой компании
    return order.map(function (r) { return { r: r, paused: false, fit: !!taken[r.id] }; })
      .concat(paused.map(function (r) { return { r: r, paused: true, fit: false }; }));
  }

  // ---------- расчёт ----------
  function demand() {
    var ps = persons(), out = [];
    state.hearts.forEach(function (id) {
      var r = byId[id];
      if (!r || isPaused(r)) return;
      S.ridersOf(state, r, ps).forEach(function (p) { out.push({ person: p.id, ride: id, qty: 1 }); });
    });
    return out;
  }
  function offers() { return C.offer({ demand: demand(), prices: prices, packs: PACKS }); }
  function chosen(res) {
    if (!res.offers.length) return null;
    var hit = res.offers.filter(function (o) { return o.kind === state.choice; })[0];
    return hit || res.offers[0];
  }
  function draft() {
    var r = route();
    if (r.name === 'order' && r.arg === 'direct') {
      var size = state.direct ? state.direct.size : 5;
      var p = PACKS.filter(function (x) { return x.size === size; })[0] || PACKS[1];
      return { source: 'direct', lines: [{ type: 'pack', size: p.size, qty: 1, unit: p.price, sum: p.price }], total: p.price, retail: null, saving: null, spare: 0 };
    }
    var res = offers(), o = chosen(res);
    return o ? { source: 'day', lines: o.lines, total: o.total, retail: res.retail.total, saving: o.saving, spare: o.packSpare } : null;
  }
  function sigOf(d) { return JSON.stringify([d.source, d.lines.map(function (l) { return [l.type, l.size || 0, l.person || '', l.ride || '', l.qty, l.sum]; })]); }

  // ---------- разметка ----------
  var HEART = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 20.6 4.4 13a5 5 0 0 1 7.1-7.1l.5.5.5-.5A5 5 0 0 1 19.6 13z"/></svg>';
  var ICON = {
    cancel: '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#5C5872" stroke-width="3"/><path d="M12 12l12 12M24 12L12 24" stroke="#5C5872" stroke-width="3" stroke-linecap="round"/></svg>',
    fail: '<svg viewBox="0 0 36 36" aria-hidden="true"><path d="M18 4l15 27H3z" fill="none" stroke="#B3261E" stroke-width="3" stroke-linejoin="round"/><path d="M18 14v8" stroke="#B3261E" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="26.5" r="1.8" fill="#B3261E"/></svg>',
    unknown: '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="#8A6A00" stroke-width="3"/><path d="M18 9v10l6 4" fill="none" stroke="#8A6A00" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function photo(r, big, eager) {
    var base = '../assets/media/' + r.id;
    return '<img src="' + base + '-780.webp" srcset="' + base + '-390.webp 390w, ' + base + '-780.webp 780w" sizes="' +
      (big ? '(min-width: 900px) 380px, 100vw' : '(min-width: 900px) 250px, 50vw') + '" width="780" height="520" alt="' + esc(name(r)) + '"' +
      (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async">';
  }
  function heartBtn(r) {
    var on = state.hearts.indexOf(r.id) >= 0;
    return '<button type="button" class="heart' + (on ? ' on' : '') + '" data-act="heart" data-id="' + r.id + '" aria-pressed="' + on +
      '" aria-label="' + esc((on ? T.wanted : T.want) + ': ' + name(r)) + '">' + HEART + '</button>';
  }
  function reacts(r) {
    var my = state.reacts[r.id], set = [['h', '❤️', T.rHeart], ['f', '🔥', T.rFire], ['g', '💎', T.rGem]];
    return '<div class="reacts" role="group" aria-label="' + esc(T.reactTitle) + '">' + set.map(function (x, i) {
      var on = my === x[0];
      return '<button type="button" class="react' + (on ? ' on' : '') + '" data-act="react" data-id="' + r.id + '" data-r="' + x[0] +
        '" aria-pressed="' + on + '" aria-label="' + esc(x[2]) + '"><b>' + (r.reactions[i] + (on ? 1 : 0)) + '</b> <span aria-hidden="true">' + x[1] + '</span></button>';
    }).join('') + '<span class="demo">' + esc(T.demoCounts) + '</span></div>';
  }
  function status(x) { return '<span class="st ' + (x.paused ? 'off' : 'on') + '">' + esc(x.paused ? T.stOff : T.stOn) + '</span>'; }

  function cardBig(x, i) {
    var r = x.r, t = text(r);
    return '<li class="card big' + (x.paused ? ' paused' : '') + '" data-ride="' + r.id + '"><div class="ph">' + photo(r, true, i === 0) +
      heartBtn(r) + reacts(r) + '</div><div class="cap"><div class="capmain"><h2>' + esc(t.line) + '</h2><p class="tags">' +
      (x.fit ? '<span class="fit">' + esc(T.forYou) + '</span> · ' : '') + esc(t.tags.join(' · ')) + '</p></div><div class="capside"><span class="dm">' + esc(T.demoTag) + '</span>' + status(x) +
      '<span class="price">' + money(r.price) + '</span></div></div></li>';
  }
  function cardSmall(x) {
    var r = x.r, t = text(r);
    return '<li class="card small' + (x.paused ? ' paused' : '') + '" data-ride="' + r.id + '"><div class="ph">' + photo(r, false, false) + heartBtn(r) +
      '</div><div class="cap"><h3>' + esc(name(r)) + '</h3><p class="tags">' + (x.fit ? '<span class="fit">' + esc(T.forYou) + '</span> · ' : '') +
      esc(t.tags.join(' · ')) + '</p><p class="meta">' + status(x) + '<span class="price">' + money(r.price) + '</span></p></div></li>';
  }
  function firstSwitch() {
    /* Переключатель первого хита снят 20.11.2026 (решение Константина): первым стоит автодром. */
    /* На адресе ?first=passes остаётся пометка, что это вариант для сравнения (колесо первым). */
    var compare = params.get('first') === 'passes';
    if (!compare) return '';
    return '<p class="basis">' + esc(T.firstCompare) + '</p>';
  }

  function viewHome() {
    var all = lineup(), shown = state.showPaused ? all : all.filter(function (x) { return !x.paused; });
    var hits = shown.slice(0, HITS), rest = shown.slice(HITS), autoFirst = !!hits.length && hits[0].r.id === 'autodrom'; // подпись по тому, кто реально первый
    var period = dmy(D.passes_period.from).slice(0, 5) + '–' + dmy(D.passes_period.to);
    return '<section class="hero"><h1><span>' + esc(T.h1a) + '</span> <span class="pk">' + esc(T.h1b) + '</span></h1>' +
      '<p class="invite">' + esc(T.invite) + ' <a href="https://www.google.com/maps/search/?api=1&amp;query=Victory%20Park%20Yerevan%20Azatutyan%20Ave%202" target="_blank" rel="noopener">' + esc(T.address) + '</a></p>' +
      '<p class="hours">' + esc(T.hours) + ' <a href="tel:+37495900060">' + esc(T.phone) + '</a></p>' +
      '<p class="warm">' + esc(T.warm[yerevanDay()]) + '</p></section>' +
      '<div class="listbar"><span class="hint">' + esc(T.likeHint) + '</span><button type="button" class="chip' + (state.showPaused ? '' : ' on') +
      '" data-act="filter" data-fk="filter" aria-pressed="' + (!state.showPaused) + '"><i aria-hidden="true"></i>' + esc(T.openToday) + '</button></div>' +
      '<ol class="cards hits">' + hits.map(cardBig).join('') + '</ol>' +
      '<p class="basis">' + esc(S.companySet(state.company) ? (autoFirst ? T.hitsNoteCoAuto(period) : T.hitsNoteCo(period)) : autoFirst ? T.hitsNoteAuto(period) : T.hitsNote(period)) + ' ' + esc(T.showing(shown.length, all.length)) + ' · ' + esc(T.demoStatus) + '.</p>' +
      firstSwitch() +
      (rest.length ? '<h2 class="sub">' + esc(T.allTitle) + '</h2><p class="basis">' + esc(T.demoPrices + ' · ' + T.demoStatus) + '</p><ol class="cards grid">' + rest.map(cardSmall).join('') + '</ol>' : '') +
      '<p class="foot">' + esc(T.tDemo) + ' ' + esc(T.photoNote) + (S.consent() === 'yes' ? ' <a href="#/log">' + esc(T.logLink) + '</a>' : '') + ' <span class="ver">r05 · 20.11.2026</span></p>'; // метка сборки: по ней замечания связываются с версией
  }

  function linesHtml(lines, ps) {
    var packs = lines.filter(function (l) { return l.type === 'pack'; });
    var tickets = {}, order = [];
    lines.filter(function (l) { return l.type === 'ticket'; }).forEach(function (l) {
      if (!tickets[l.ride]) { tickets[l.ride] = { qty: 0, sum: 0, who: [] }; order.push(l.ride); }
      tickets[l.ride].qty += l.qty; tickets[l.ride].sum += l.sum;
      var p = ps.filter(function (x) { return x.id === l.person; })[0];
      if (p) tickets[l.ride].who.push(p.label + (l.qty > 1 ? ' ×' + l.qty : ''));
    });
    return '<ul class="lines">' + packs.map(function (l) {
      return '<li><span>' + esc(T.packName(l.size)) + (l.qty > 1 ? ' × ' + l.qty : '') + '</span><b>' + money(l.sum) + '</b></li>';
    }).join('') + order.map(function (id) {
      var t = tickets[id];
      return '<li><span>' + esc(T.ticketLine(byId[id] ? name(byId[id]) : id, t.qty, ps.length > 1 ? t.who.join(', ') : '')) + '</span><b>' + money(t.sum) + '</b></li>';
    }).join('') + '</ul>';
  }
  function savingHtml(o, retail) {
    if (o.kind === 'tickets') return '';
    if (o.saving > 0) return '<p class="save">' + esc(T.saving(money(o.saving), money(retail))) + '</p>';
    if (o.saving === 0) return '<p class="save flat">' + esc(T.noSaving) + '</p>';
    return '<p class="save flat">' + esc(T.dearer(money(-o.saving))) + '</p>';
  }
  function offerTitle(o) {
    if (o.kind !== 'pack') return T.ticketsOnly;
    var packs = o.lines.filter(function (l) { return l.type === 'pack'; }), hasTickets = o.lines.some(function (l) { return l.type === 'ticket'; });
    if (packs.length === 1 && packs[0].qty === 1 && !hasTickets) return T.packName(packs[0].size);
    return T.packsTotal(o.packCapacity, hasTickets);
  }
  function terms(open, title) {
    return '<details class="terms"' + (open ? ' open' : '') + '><summary><span>' + esc(title || T.termsTitle) + '</span><small>' + esc(T.termsOpen) +
      '</small></summary><dl><dt>' + esc(T.tIncl) + '</dt><dd>' + esc(T.tInclTicket) + ' ' + esc(T.tInclPack) + '</dd><dt>' + esc(T.tValid) + '</dt><dd>' +
      esc(T.tValidTicket) + ' ' + esc(T.tValidPack) + '</dd><dt>' + esc(T.tRefund) + '</dt><dd>' + esc(T.tRefundText) + '</dd><dt>' + esc(T.tAdmit) +
      '</dt><dd>' + esc(T.tAdmitText) + '</dd></dl><p class="demoline">' + esc(T.tDemo) + '</p></details>';
  }
  function backLink(href, label) { return '<a class="back" href="' + href + '" data-fk="back"><span aria-hidden="true">←</span> ' + esc(label) + '</a>'; }
  function totalRow(total) {
    return '<p class="totalrow"><span>' + esc(T.total) + '</span><b>' + money(total) + '</b><small>' + esc(approx(total)) + '</small></p>' +
      (approx(total) ? '<p class="rate">' + esc(T.rate(dmy(D.currency.date))) + '</p>' : '');
  }

  function viewDay() {
    var ps = persons(), html = backLink('#/', T.toRides) + '<h1 class="page">' + esc(T.dayTitle) + '</h1>';
    if (state.removed) html += '<p class="undo" role="status">' + esc(T.removed(name(byId[state.removed.id]))) +
      ' <button type="button" class="link" data-act="restore" data-fk="restore">' + esc(T.restore) + '</button></p>';
    if (!state.hearts.length) return html + '<p class="empty">' + esc(T.dayEmpty) + '</p><p><a class="btn ghost" href="#/tickets">' + esc(T.directTitle) + '</a></p>';
    html += '<ul class="day">' + state.hearts.map(function (id) {
      var r = byId[id], p = isPaused(r), riders = S.ridersOf(state, r, ps);
      return '<li class="dayitem' + (p ? ' paused' : '') + '"><img src="../assets/media/' + r.id + '-390.webp" width="390" height="260" alt="" loading="lazy"><div class="dbody"><h2>' +
        esc(name(r)) + '</h2><p class="meta">' + money(r.price) + ' ' + esc(T.perRide) + ' · ' + esc(p ? T.stOff : T.stOn) + '</p>' +
        (p ? '<p class="pnote">' + esc(T.pausedNote) + '</p>' : '<div class="riders" role="group" aria-label="' + esc(T.whoRides + ': ' + name(r)) + '">' + ps.map(function (x) {
          var on = riders.indexOf(x) >= 0;
          return '<button type="button" class="chip sm' + (on ? ' on' : '') + '" data-act="rider" data-id="' + r.id + '" data-p="' + x.id + '" data-fk="rider-' + r.id + '-' + x.id +
            '" aria-pressed="' + on + '">' + esc(x.label) + '</button>';
        }).join('') + (riders.length ? '' : '<span class="muted">' + esc(T.nobody) + '</span>') + '</div>') +
        '</div><button type="button" class="x" data-act="remove" data-id="' + r.id + '" aria-label="' + esc(T.remove + ': ' + name(r)) + '">×</button></li>';
    }).join('') + '</ul>';

    var res = offers(), pick = chosen(res);
    if (pick) {
      html += '<section class="offers"><h2>' + esc(T.offerTitle) + '</h2>' + res.offers.slice(0, 2).map(function (o, i) {
        var on = o === pick;
        return '<article class="offer' + (on ? ' on' : '') + '"><header><h3>' + esc(offerTitle(o)) +
          '</h3><b class="sum">' + money(o.total) + '</b></header>' + (i ? '<p class="alt">' + esc(T.offerAlt) + '</p>' : '') + linesHtml(o.lines, ps) + savingHtml(o, res.retail.total) +
          (o.kind === 'pack' && o.packSpare > 0 ? '<p class="spare">' + esc(T.spare(o.packSpare)) + '</p>' : '') +
          '<button type="button" class="pick" data-act="choose" data-kind="' + o.kind + '" data-fk="choose-' + o.kind + '" aria-pressed="' + on + '">' + esc(on ? T.chosen : T.choose) + '</button></article>';
      }).join('') + '<p class="units">' + esc(T.unitTicket) + ' ' + esc(T.unitPack) + '</p>' +
        totalRow(pick.total) + '</section>' + terms(false) +
        '<p class="go"><a class="btn" href="#/order">' + esc(T.toOrder) + '</a> <a class="btn ghost" href="#/tickets" data-act="direct">' + esc(T.directTitle) + '</a></p>';
    }
    return html;
  }

  function viewTickets() {
    var cur = state.direct ? state.direct.size : 5;
    return backLink(state.hearts.length ? '#/day' : '#/', T.back) + '<h1 class="page">' + esc(T.directTitle) + '</h1><p class="units">' + esc(T.unitPack) + ' ' + esc(T.unitTicket) + '</p>' +
      '<div class="packs" role="radiogroup" aria-label="' + esc(T.directTitle) + '">' + PACKS.map(function (p) {
        var on = p.size === cur;
        return '<button type="button" role="radio" class="pack' + (on ? ' on' : '') + '" data-act="pack" data-size="' + p.size + '" data-fk="pack-' + p.size + '" aria-checked="' + on + '"><span>' +
          esc(T.packName(p.size)) + '</span><b>' + money(p.price) + '</b><small>' + esc(approx(p.price)) + '</small></button>';
      }).join('') + '</div>' + (approx(1000) ? '<p class="rate">' + esc(T.rate(dmy(D.currency.date))) + '</p>' : '') + terms(false);
  }

  function viewOrder() {
    var r = route(), d = draft();
    var html = backLink(r.arg === 'direct' ? '#/tickets' : '#/day', T.back) + '<h1 class="page">' + esc(T.orderTitle) + '</h1>';
    if (!d) return html + '<p class="empty">' + esc(T.dayEmpty) + '</p>';
    var sig = sigOf(d), paid = S.orders().filter(function (o) { return o.sig === sig && o.status === 'paid'; }).pop();
    if (paid) html += '<p class="note" role="status">' + esc(T.paidAlready) + ' <a href="#/ticket/' + paid.id + '">' + esc(T.openTicket) + '</a></p>';
    if (payError) html += '<p class="note warn" role="alert">' + esc(payError) + '</p>';
    html += '<section class="offers"><article class="offer on">' + linesHtml(d.lines, persons()) +
      (d.saving > 0 ? '<p class="save">' + esc(T.saving(money(d.saving), money(d.retail))) + '</p>' : '') +
      (d.spare > 0 ? '<p class="spare">' + esc(T.spare(d.spare)) + '</p>' : '') + '</article>' +
      (d.source === 'day' ? '<p class="for"><span>' + esc(T.orderFor) + ':</span> ' + esc(persons().map(function (p) { return p.label; }).join(', ')) + '</p>' : '') +
      totalRow(d.total) + '</section>' + terms(true) + '<p class="units">' + esc(T.unitTicket) + ' ' + esc(T.unitPack) + '</p>';
    return html;
  }

  // ---------- заказ, оплата, билет ----------
  function orderPeople(o) { return S.people(o.company || { him: false, her: false, kids: 0, friends: 0 }, T); }
  function orderBox(o) {
    var ps = orderPeople(o);
    return '<section class="offers"><article class="offer on">' + linesHtml(o.lines, ps) +
      (o.saving > 0 ? '<p class="save">' + esc(T.saving(money(o.saving), money(o.retail))) + '</p>' : '') + '</article>' +
      (o.source === 'day' ? '<p class="for"><span>' + esc(T.orderFor) + ':</span> ' + esc(ps.map(function (p) { return p.label; }).join(', ')) + '</p>' : '') +
      totalRow(o.total) + '</section>';
  }
  function resultBox(kind, title, body) {
    return '<div class="result r-' + kind + '" role="status">' + ICON[kind] + '<div><h2>' + esc(title) + '</h2><p>' + esc(body) + '</p></div></div>';
  }
  function missing(title) { return backLink('#/', T.toRides) + '<h1 class="page">' + esc(title) + '</h1><p class="empty">' + esc(T.notFound) + '</p>'; }

  function viewPay(id) {
    var o = S.order(id);
    if (!o) return missing(T.payTitle);
    var back = o.source === 'direct' ? '#/order/direct' : '#/order';
    var html = backLink(back, T.toOrderBack) + '<h1 class="page">' + esc(T.payTitle) + '</h1><p class="orderno">' + esc(T.orderNo(o.id)) + '</p>';
    if (o.status === 'processing') return html + '<p class="busy" role="status" data-busy="1"><i class="spin" aria-hidden="true"></i><span>' + esc(T.payBusy) + '</span></p>' + orderBox(o);
    if (o.status === 'cancelled' || o.status === 'failed') {
      var c = o.status === 'cancelled';
      return html + resultBox(c ? 'cancel' : 'fail', c ? T.resCancelT : T.resFailT, c ? T.resCancelP : T.resFailP) + orderBox(o) +
        '<p class="go"><button type="button" class="btn" data-act="pay-reset" data-id="' + o.id + '" data-fk="pay-reset">' + esc(T.retry) + '</button> <a class="btn ghost" href="' + back + '">' + esc(T.toOrderBack) + '</a></p>';
    }
    if (o.status === 'unknown') {
      return html + resultBox('unknown', T.resUnknownT, T.resUnknownP) + orderBox(o) +
        '<p class="go"><button type="button" class="btn" data-act="pay-check" data-id="' + o.id + '" data-fk="pay-check">' + esc(T.check) + '</button></p><p class="muted small">' + esc(T.checkDemo) + '</p>';
    }
    return html + '<p class="demoline solo">' + esc(T.payLead) + '</p>' + orderBox(o) +
      '<p class="go"><button type="button" class="btn wide" data-act="pay" data-o="success" data-id="' + o.id + '" data-fk="pay-success">' + esc(T.payNow(money(o.total))) + '</button></p>' +
      '<fieldset class="outcomes"><legend>' + esc(T.payOther) + '</legend>' +
      [['cancel', T.payCancel], ['fail', T.payFail], ['unknown', T.payUnknown]].map(function (x) {
        return '<button type="button" data-act="pay" data-o="' + x[0] + '" data-id="' + o.id + '" data-fk="pay-' + x[0] + '">' + esc(x[1]) + '</button>';
      }).join('') + '</fieldset>' + terms(false);
  }

  function viewTicket(id) {
    var o = S.order(id);
    if (!o || o.status !== 'paid' || !o.ticket) return missing(T.ticketTitle);
    var code = o.ticket.code, hasPack = o.lines.some(function (l) { return l.type === 'pack'; }), hasTicket = o.lines.some(function (l) { return l.type === 'ticket'; });
    var ps = orderPeople(o);
    return backLink('#/', T.toRides) + '<h1 class="page">' + esc(T.ticketTitle) + '</h1><article class="ticket" data-order="' + o.id + '"><p class="tdemo">' + esc(T.ticketDemo) + '</p>' +
      '<div class="qr">' + Q.svg('VICTORYPARK-DEMO/' + o.id + '/' + code, { label: 'QR ' + o.id }) + '</div>' +
      '<p class="tcode"><span>' + esc(T.ticketCode) + '</span> <b>' + esc(code.slice(0, 5) + '-' + code.slice(5)) + '</b></p>' +
      '<p class="orderno">' + esc(T.orderNo(o.id)) + ' · ' + esc(T.ticketPaid(stamp(o.paidAt, true))) + '</p>' + linesHtml(o.lines, ps) +
      (o.source === 'day' ? '<p class="for"><span>' + esc(T.orderFor) + ':</span> ' + esc(ps.map(function (p) { return p.label; }).join(', ')) + '</p>' : '') +
      '<p class="totalrow"><span>' + esc(T.total) + '</span><b>' + money(o.total) + '</b></p>' +
      '<p class="valid">' + (hasPack ? esc(T.validPack(stamp(plusDays(o.paidAt, 30), false))) + ' ' : '') + (hasTicket ? esc(T.validTicket) : '') + '</p></article>' +
      '<p class="muted small keep">' + esc(T.ticketKeep) + '</p>' + terms(false, T.termsTicket) +
      '<p class="go"><a class="btn ghost" href="#/my">' + esc(T.mine) + '</a> <a class="btn ghost" href="#/">' + esc(T.toRides) + '</a></p>';
  }

  var ST_LABEL = { paid: 'stPaid', cancelled: 'stCancelled', failed: 'stFailed', unknown: 'stUnknown', processing: 'stUnknown', 'new': 'stNew' };
  function viewMine() {
    var list = S.orders().slice().reverse();
    var html = backLink('#/', T.toRides) + '<h1 class="page">' + esc(T.mine) + '</h1>';
    if (!list.length) return html + '<p class="empty">' + esc(T.mineEmpty) + '</p>';
    return html + '<ul class="mylist">' + list.map(function (o) {
      var paid = o.status === 'paid';
      return '<li data-order="' + o.id + '" data-status="' + o.status + '"><div><b>' + esc(T.orderNo(o.id)) + '</b><span class="tag t-' + o.status + '">' + esc(T[ST_LABEL[o.status] || 'stNew']) + '</span><p class="meta">' +
        esc(stamp(o.paidAt || o.created, true)) + ' · ' + money(o.total) + '</p></div><a class="btn ghost sm" href="#/' + (paid ? 'ticket' : 'pay') + '/' + o.id + '">' +
        esc(paid ? T.openTicket : T.continuePay) + '</a></li>';
    }).join('') + '</ul>';
  }

  function viewLog() {
    var ev = S.events(), html = backLink('#/', T.toRides) + '<h1 class="page">' + esc(T.logTitle) + '</h1><p class="muted">' + esc(T.logLead) + '</p>';
    if (!ev.length) return html + '<p class="empty">' + esc(T.logEmpty) + '</p>';
    return html + '<div class="logwrap"><table class="logtable"><thead><tr>' + T.logCols.map(function (c) { return '<th scope="col">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      ev.slice().reverse().map(function (e) {
        return '<tr><td>' + esc(stamp(e.t, true)) + '</td><td>' + esc(e.e) + '</td><td>' + esc(Object.keys(e.p || {}).map(function (k) { return k + '=' + e.p[k]; }).join(', ')) + '</td></tr>';
      }).join('') + '</tbody></table></div><p class="go"><button type="button" class="btn ghost" data-act="log-clear" data-fk="log-clear">' + esc(T.logClear) + '</button></p>';
  }

  function checkout() {
    var d = draft(); if (!d) return;
    var sig = sigOf(d);
    var o = S.orders().filter(function (x) { return x.sig === sig && OPEN_STATUSES.indexOf(x.status) >= 0; })[0];
    if (!o) {
      o = { v: 1, id: S.newOrderId(), created: new Date().toISOString(), source: d.source, sig: sig,
        company: d.source === 'day' ? JSON.parse(JSON.stringify(state.company)) : null,
        lines: JSON.parse(JSON.stringify(d.lines)), total: d.total, retail: d.retail, saving: d.saving, spare: d.spare || 0,
        status: 'new', attempts: [], ticket: null, paidAt: null };
      if (!S.putOrder(o)) { payError = T.storeFail; return render(true); }
      S.track('order_create', { order: o.id, source: o.source, total: o.total, lines: o.lines.length });
    }
    payError = '';
    location.hash = '#/pay/' + o.id;
  }
  function pay(id, outcome) {
    var o = S.order(id);
    if (busy || !o || o.status !== 'new') return;            // повторное нажатие второй платёж не начинает
    busy = true;
    o.status = 'processing'; o.attempts.push({ t: new Date().toISOString(), outcome: null });
    S.putOrder(o);
    S.track('pay_start', { order: id, total: o.total, attempt: o.attempts.length });
    render(true); view.focus({ preventScroll: true });
    setTimeout(function () { settle(id, outcome); }, PAY_DELAY);
  }
  function settle(id, outcome) {
    busy = false;
    var o = S.order(id);
    if (!o || o.status !== 'processing') return render(true);
    var now = new Date().toISOString();
    o.attempts[o.attempts.length - 1].outcome = outcome;
    if (outcome === 'success' || outcome === 'confirmed') { o.status = 'paid'; o.paidAt = now; o.ticket = { code: S.newTicketCode(), issued: now, opens: 0 }; }
    else o.status = outcome === 'cancel' ? 'cancelled' : outcome === 'fail' ? 'failed' : 'unknown';
    S.putOrder(o);
    S.track('pay_result', { order: id, outcome: outcome, status: o.status });
    if (o.status === 'paid') { S.track('ticket_issue', { order: id }); location.replace(location.pathname + location.search + '#/ticket/' + id); }
    else { render(true); view.focus({ preventScroll: true }); }
  }
  function payReset(id) {
    var o = S.order(id);
    if (busy || !o || (o.status !== 'cancelled' && o.status !== 'failed')) return;
    o.status = 'new'; S.putOrder(o); S.track('pay_retry', { order: id }); render(true);
  }
  function payCheck(id) {
    var o = S.order(id);
    if (busy || !o || o.status !== 'unknown') return;
    busy = true;
    o.status = 'processing'; o.attempts.push({ t: new Date().toISOString(), outcome: null, check: true });
    S.putOrder(o); S.track('pay_check', { order: id });
    render(true); view.focus({ preventScroll: true });
    setTimeout(function () { settle(id, 'confirmed'); }, PAY_DELAY);
  }

  // ---------- нижняя панель ----------
  function whoSummary() {
    var c = state.company, parts = [];
    if (c.him) parts.push(T.him);
    if (c.her) parts.push(T.her);
    if (c.kids) parts.push(c.kids === 1 ? T.kidN(1).replace(/\s*1$/, '') : T.kids + ' · ' + c.kids);
    if (c.friends) parts.push(c.friends === 1 ? T.friendN(1).replace(/\s*1$/, '') : T.friends + ' · ' + c.friends);
    return parts.join(', ');
  }
  function renderDock() {
    var r = route(), keep = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-fk') : null;
    var html = '';
    if (S.consent() === null) html += '<div class="consent" role="region" aria-label="' + esc(T.consentQ) + '"><p>' + esc(T.consentQ) + '</p><button type="button" data-act="consent" data-v="yes" data-fk="c-yes">' +
      esc(T.yes) + '</button><button type="button" data-act="consent" data-v="no" data-fk="c-no">' + esc(T.no) + '</button></div>';
    var cta = null, who = false, ps = persons();
    if (r.name === 'home') {
      who = true; cta = { href: '#/tickets', label: T.cta0, sub: '' };
      if (state.hearts.length) {
        var pick = chosen(offers()), sum = pick ? pick.total : 0, sub = [];
        if (pick && pick.kind === 'pack') sub.push(T.withPack);
        if (approx(sum)) sub.push(approx(sum) + ', ' + T.rateShort(dmy(D.currency.date).slice(0, 5)));
        sub.push(T.demoPrices);
        html += '<p class="sumline"><span class="sl"><b>≈ ' + money(sum) + '</b> ' + esc(S.companySet(state.company) ? T.forAll(ps.length) : T.perOne) +
          '<small>' + esc(sub.join(' · ')) + '</small></span><a href="#/tickets" data-act="direct">' + esc(T.directTitle) + '</a></p>';
        cta = { href: '#/day', label: T.ctaDay, sub: '♥ ' + state.hearts.length };
      }
    } else if (r.name === 'day') {
      who = true;
      var d = draft();
      cta = d ? { href: '#/order', label: T.toOrder, sub: money(d.total) } : { href: '#/', label: T.toRides, sub: '' };
    } else if (r.name === 'tickets') {
      cta = { href: '#/order/direct', label: T.toOrder, sub: money((state.direct ? state.direct.size : 5) * PACK_PRICE) };
    } else if (r.name === 'order') {
      who = r.arg !== 'direct';
      var dd = draft();
      cta = dd ? { act: 'checkout', label: T.toPay, sub: money(dd.total) } : { href: '#/', label: T.toRides, sub: '' };
    }
    if (cta) {
      var sumWho = whoSummary(), inner = '<span>' + esc(cta.label) + '</span>' + (cta.sub ? '<small>' + esc(cta.sub) + '</small>' : '');
      html += '<div class="bar' + (who ? '' : ' solo') + '">' + (who ? '<button type="button" class="who" data-act="who-open" data-fk="who" aria-haspopup="dialog" aria-expanded="' + (!sheet.hidden) + '"><span>' +
        esc(T.withWho) + '</span>' + (sumWho ? '<small>' + esc(sumWho) + '</small>' : '') + '</button>' : '') +
        (cta.act ? '<button type="button" class="cta" data-act="' + cta.act + '" data-fk="cta">' + inner + '</button>' : '<a class="cta" href="' + cta.href + '" data-fk="cta">' + inner + '</a>') + '</div>';
    }
    dock.innerHTML = html; dock.hidden = !html;
    document.documentElement.style.setProperty('--dock', (html ? dock.offsetHeight : 0) + 'px');
    if (keep) { var el = dock.querySelector('[data-fk="' + keep + '"]'); if (el) el.focus(); }
  }
  /* Первая карточка целиком помещается над панелью, даже когда в панели одновременно плашка согласия
     и строка суммы: место под них оставлено заранее, поэтому после первого сердечка панель карточку не закрывает. */
  function fitFirst() {
    var ph = view.querySelector('.cards.hits .card.big .ph');
    if (!ph) return;
    ph.style.height = ''; ph.style.aspectRatio = '';
    if (window.innerWidth >= 900 || route().name !== 'home') return;
    var card = ph.parentNode, cr = card.getBoundingClientRect(), pr = ph.getBoundingClientRect();
    var bar = dock.querySelector('.bar'), consent = dock.querySelector('.consent');
    var reserve = (bar ? bar.offsetHeight : 68) + sumRow() + Math.max(CONSENT_ROW, consent ? consent.offsetHeight : 0);
    var room = window.innerHeight - reserve - (cr.top + window.scrollY) - (cr.height - pr.height) - 6;
    var h = Math.max(130, Math.min(pr.height, room));
    if (h < pr.height - 0.5) { ph.style.aspectRatio = 'auto'; ph.style.height = Math.round(h) + 'px'; }
  }

  // ---------- выбор компании ----------
  var sheetBody = sheet.querySelector('.sheet-body');
  function renderSheet() {
    var c = state.company;
    function chip(k, label, on) { return '<button type="button" class="chip lg' + (on ? ' on' : '') + '" data-act="who" data-k="' + k + '" data-fk="who-' + k + '" aria-pressed="' + on + '">' + esc(label) + '</button>'; }
    function stepper(k, label, v, max) {
      return '<div class="stepper"><span>' + esc(label) + '</span><button type="button" data-act="step" data-k="' + k + '" data-d="-1" data-fk="st-' + k + '-m" aria-label="' + esc(label) + ' −1"' + (v <= 1 ? ' disabled' : '') +
        '>−</button><output aria-live="polite">' + v + '</output><button type="button" data-act="step" data-k="' + k + '" data-d="1" data-fk="st-' + k + '-p" aria-label="' + esc(label) + ' +1"' + (v >= max ? ' disabled' : '') + '>+</button></div>';
    }
    var keep = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-fk') : null;
    sheetBody.innerHTML = '<h2 id="who-title">' + esc(T.withWho) + '</h2><p class="muted">' + esc(T.withWhoHint) + '</p><div class="whochips">' +
      chip('him', T.him, c.him) + chip('her', T.her, c.her) + chip('kids', T.kids + (c.kids > 0 ? ' · ' + c.kids : ''), c.kids > 0) +
      chip('friends', T.friends + (c.friends > 0 ? ' · ' + c.friends : ''), c.friends > 0) + '</div>' +
      (c.kids > 0 ? stepper('kids', T.kidsHow, c.kids, S.MAX_KIDS) : '') +
      (c.friends > 0 ? stepper('friends', T.friendsHow, c.friends, S.MAX_FRIENDS) : '') +
      '<p class="muted small">' + esc(T.noAge) + '</p><button type="button" class="btn" data-act="who-close" data-fk="who-done">' + esc(T.done) + '</button>';
    if (keep) { var el = sheet.querySelector('[data-fk="' + keep + '"]'); if (el) el.focus(); }
  }
  function openSheet() {
    sheet.hidden = false; document.body.classList.add('sheet-open');
    renderSheet(); renderDock();
    var first = sheet.querySelector('.chip'); if (first) first.focus();
    S.track('company_open', {});
  }
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true; document.body.classList.remove('sheet-open');
    renderDock();
    var back = dock.querySelector('[data-fk="who"]'); if (back) back.focus();
  }

  // ---------- отрисовка ----------
  function renderTop() {
    document.getElementById('langs').innerHTML = LANGS.map(function (l) {
      return '<a href="../' + l + '/' + location.search + location.hash + '" data-lang-link="' + l + '"' + (l === lang ? ' aria-current="true"' : '') + ' hreflang="' + l + '">' + window.YVN_I18N[l].langName + '</a>';
    }).join('');
    if (mine) { var n = S.orders().length; mine.hidden = !n; mine.textContent = T.mine; }
  }
  function body(r) {
    switch (r.name) {
      case 'day': return viewDay();
      case 'tickets': return viewTickets();
      case 'order': return viewOrder();
      case 'pay': return viewPay(r.arg);
      case 'ticket': return viewTicket(r.arg);
      case 'my': return viewMine();
      case 'log': return viewLog();
      default: return viewHome();
    }
  }
  function render(keepScroll) {
    var r = route(), key = r.name + '/' + (r.arg || ''), fresh = lastRoute !== key;
    if (r.name === 'pay') {                                  // оплаченный заказ второй раз не оплачивают: сразу к билету
      var po = S.order(r.arg);
      if (po && po.status === 'paid') return location.replace(location.pathname + location.search + '#/ticket/' + po.id);
    }
    var keep = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-fk') : null;
    var y = window.scrollY;
    view.className = 'view v-' + r.name;
    view.innerHTML = body(r);
    renderTop(); renderDock(); fitFirst();
    if (keepScroll) window.scrollTo(0, y);
    else if (fresh) window.scrollTo(0, scrollMemo[key] || 0);
    if (keep) { var el = view.querySelector('[data-fk="' + keep + '"]'); if (el) el.focus({ preventScroll: true }); }
    else if (fresh && lastRoute !== null) view.focus({ preventScroll: true });
    if (fresh) {
      if (r.name === 'day') S.track('day_view', { hearts: state.hearts.length, people: persons().length });
      if (r.name === 'order') S.track('order_view', { source: r.arg === 'direct' ? 'direct' : 'day' });
      if (r.name === 'tickets') S.track('direct_open', {});
      if (r.name === 'pay') S.track('checkout_open', { order: r.arg });
      if (r.name === 'ticket') {
        var t = S.order(r.arg);
        if (t && t.status === 'paid' && t.ticket) {
          if (t.ticket.opens > 0) S.track('ticket_reopen', { order: t.id, n: t.ticket.opens });
          t.ticket.opens += 1; S.putOrder(t);
        }
      }
    }
    lastRoute = key;
    watchCards();
  }

  /* Показ карточки: видна хотя бы наполовину. Пропуск: карточку видели, она ушла с экрана без сердечка. */
  var seen = {}, skipped = {}, observer = null;
  function watchCards() {
    if (observer) observer.disconnect();
    if (!('IntersectionObserver' in window) || route().name !== 'home') return;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.getAttribute('data-ride');
        if (en.isIntersecting && en.intersectionRatio >= 0.5) { if (!seen[id]) { seen[id] = true; S.track('card_view', { ride: id }); } }
        else if (!en.isIntersecting && seen[id] && !skipped[id] && state.hearts.indexOf(id) < 0) { skipped[id] = true; S.track('card_skip', { ride: id }); }
      });
    }, { threshold: [0, 0.5] });
    Array.prototype.forEach.call(view.querySelectorAll('.card'), function (el) { observer.observe(el); });
  }

  // ---------- действия ----------
  function toggleHeart(id, btn) {
    var i = state.hearts.indexOf(id);
    if (i >= 0) { state.hearts.splice(i, 1); S.track('heart_off', { ride: id }); }
    else { state.hearts.push(id); delete skipped[id]; if (state.removed && state.removed.id === id) state.removed = null; S.track('heart_on', { ride: id, rank: byId[id].rank }); }
    save();
    var on = i < 0;
    Array.prototype.forEach.call(document.querySelectorAll('.heart[data-id="' + id + '"]'), function (b) {
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      b.setAttribute('aria-label', (on ? T.wanted : T.want) + ': ' + name(byId[id]));
      if (b === btn && on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    renderDock();
  }
  function setReact(id, r) {
    if (state.reacts[id] === r) { delete state.reacts[id]; S.track('react_off', { ride: id }); }
    else { state.reacts[id] = r; S.track('react_on', { ride: id, r: r }); }
    save();
    var box = view.querySelector('.card[data-ride="' + id + '"] .reacts');
    if (box) {
      var tmp = document.createElement('div'); tmp.innerHTML = reacts(byId[id]);
      var keep = document.activeElement && document.activeElement.getAttribute('data-r'); box.replaceWith(tmp.firstChild);
      if (keep) { var el = view.querySelector('.card[data-ride="' + id + '"] .react[data-r="' + keep + '"]'); if (el) el.focus(); }
    }
  }
  function companyEvent() { var c = state.company; S.track('company_set', { him: c.him, her: c.her, kids: c.kids, friends: c.friends }); }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (act === 'heart') return toggleHeart(id, el);
    if (act === 'react') return setReact(id, el.getAttribute('data-r'));
    if (act === 'filter') { state.showPaused = !state.showPaused; save(); S.track(state.showPaused ? 'filter_open_off' : 'filter_open_on', {}); return render(true); }
    if (act === 'first') {
      state.first = el.getAttribute('data-v') === 'autodrom' ? 'autodrom' : 'passes'; save(); S.track('first_switch', { first: state.first });
      if (params.has('first')) { params.delete('first'); var q = params.toString(); history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash); }
      return render(true);
    }
    if (act === 'consent') { S.setConsent(el.getAttribute('data-v')); if (el.getAttribute('data-v') === 'yes') S.track('consent_yes', {}); return render(true); }
    if (act === 'who-open') return sheet.hidden ? openSheet() : closeSheet();
    if (act === 'who-close') return closeSheet();
    if (act === 'who') {
      var k = el.getAttribute('data-k'), c = state.company;
      if (k === 'him' || k === 'her') c[k] = !c[k]; else c[k] = c[k] > 0 ? 0 : (k === 'friends' ? 2 : 1);
      save(); companyEvent(); renderSheet(); return render(true);
    }
    if (act === 'step') {
      var kk = el.getAttribute('data-k'), max = kk === 'kids' ? S.MAX_KIDS : S.MAX_FRIENDS;
      state.company[kk] = Math.max(1, Math.min(max, state.company[kk] + parseInt(el.getAttribute('data-d'), 10)));
      save(); companyEvent(); renderSheet(); return render(true);
    }
    if (act === 'rider') {
      var pid = el.getAttribute('data-p'), on = el.getAttribute('aria-pressed') === 'true';
      state.riders[id] = state.riders[id] || {}; state.riders[id][pid] = !on; save();
      S.track('rider_set', { ride: id, on: !on }); return render(true);
    }
    if (act === 'remove') {
      var at = state.hearts.indexOf(id);
      if (at >= 0) { state.hearts.splice(at, 1); state.removed = { id: id, at: at }; save(); S.track('heart_off', { ride: id, from: 'day' }); }
      render(true); var u = view.querySelector('[data-fk="restore"]'); if (u) u.focus({ preventScroll: true }); return;
    }
    if (act === 'restore') {
      if (state.removed && state.hearts.indexOf(state.removed.id) < 0) { state.hearts.splice(Math.min(state.removed.at, state.hearts.length), 0, state.removed.id); S.track('heart_on', { ride: state.removed.id, from: 'restore' }); }
      state.removed = null; save(); return render(true);
    }
    if (act === 'choose') { state.choice = el.getAttribute('data-kind'); save(); S.track('offer_choose', { kind: state.choice }); return render(true); }
    if (act === 'pack') { state.direct = { size: parseInt(el.getAttribute('data-size'), 10) }; save(); S.track('direct_pack', { size: state.direct.size }); return render(true); }
    if (act === 'direct') { S.track('direct_click', { from: route().name }); return; }
    if (act === 'checkout') return checkout();
    if (act === 'pay') return pay(id, el.getAttribute('data-o'));
    if (act === 'pay-reset') return payReset(id);
    if (act === 'pay-check') return payCheck(id);
    if (act === 'log-clear') { S.setConsent('no'); return render(true); }
  });

  document.addEventListener('click', function (ev) { // «раскрытие условий» пишется только по действию гостя, не при показе открытыми
    var s = ev.target.closest && ev.target.closest('.terms > summary'); if (s && !s.parentNode.open) S.track('terms_open', { at: route().name });
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (sheet.hidden) return;
    if (ev.key === 'Escape') { ev.preventDefault(); return closeSheet(); }
    if (ev.key === 'Tab') {
      var f = sheet.querySelectorAll('button:not([disabled])'); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet || ev.target.classList.contains('sheet-bg')) closeSheet(); });

  window.addEventListener('scroll', function () { var r = route(); scrollMemo[r.name + '/' + (r.arg || '')] = window.scrollY; }, { passive: true });
  window.addEventListener('hashchange', function () { payError = ''; closeSheet(); render(false); });
  window.addEventListener('storage', function (ev) {
    if (ev.key === S.keys.state) { state = S.load(D.rides.map(function (r) { return r.id; })); state.first = qFirst === 'passes' ? 'passes' : 'autodrom'; render(true); } // вариант первого хита берётся из адреса этой вкладки
    else if (ev.key === S.keys.orders && !busy) render(true);
  });
  window.addEventListener('resize', function () { fitFirst(); document.documentElement.style.setProperty('--dock', (dock.hidden ? 0 : dock.offsetHeight) + 'px'); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fitFirst(); }); if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { fitFirst(); }); window.addEventListener('load', function () { fitFirst(); }); // шрифт может догрузиться после fonts.ready (так бывает с CSP и по сети) — пересчёт первой карточки после окончательной раскладки

  document.title = T.title;
  render(false);
  S.track('page_open', { lang: lang, route: route().name });
  window.YVNApp = { state: function () { return state; }, draft: draft, offers: offers, lineup: lineup, orders: S.orders, events: S.events };
})();

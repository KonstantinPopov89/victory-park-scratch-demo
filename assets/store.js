/* Состояние гостя: сердечки, компания, кто катается, выбранный вариант, согласие, журнал событий.
   Имена хранилища свои (yvn0.*), чтобы прототип не пересекался с другими версиями сайта. */
(function (root) {
  'use strict';

  var K = { state: 'yvn0.state.v1', consent: 'yvn0.consent.v1', events: 'yvn0.events.v1', orders: 'yvn0.orders.v1' };
  var MAX_KIDS = 4, MAX_FRIENDS = 6, MAX_EVENTS = 500;

  function blank() {
    return { hearts: [], company: { him: false, her: false, kids: 0, friends: 0 }, riders: {},
      showPaused: false, choice: 'best', reacts: {}, removed: null, direct: null, first: 'autodrom' };
  }
  function read(key, fallback) {
    try { var raw = root.localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function clampInt(v, max) { v = parseInt(v, 10); return isNaN(v) || v < 0 ? 0 : Math.min(v, max); }

  function normalize(s, rideIds) {
    var b = blank();
    if (!s || typeof s !== 'object') return b;
    var known = {}; rideIds.forEach(function (id) { known[id] = true; });
    if (Array.isArray(s.hearts)) s.hearts.forEach(function (id) { if (known[id] && b.hearts.indexOf(id) < 0) b.hearts.push(id); });
    var c = s.company || {};
    b.company = { him: !!c.him, her: !!c.her, kids: clampInt(c.kids, MAX_KIDS), friends: clampInt(c.friends, MAX_FRIENDS) };
    if (s.riders && typeof s.riders === 'object') Object.keys(s.riders).forEach(function (id) {
      if (known[id] && s.riders[id] && typeof s.riders[id] === 'object') b.riders[id] = s.riders[id];
    });
    b.showPaused = !!s.showPaused;
    b.choice = s.choice === 'tickets' || s.choice === 'pack' ? s.choice : 'best';
    if (s.reacts && typeof s.reacts === 'object') Object.keys(s.reacts).forEach(function (id) {
      if (known[id] && /^[hfg]$/.test(s.reacts[id])) b.reacts[id] = s.reacts[id];
    });
    if (s.removed && known[s.removed.id]) b.removed = { id: s.removed.id, at: clampInt(s.removed.at, 99) };
    if (s.direct && typeof s.direct === 'object') b.direct = { size: clampInt(s.direct.size, 100) || 5 };
    b.first = s.first === 'passes' ? 'passes' : 'autodrom';
    return b;
  }

  /* Люди компании. Ничего не отмечено — один гость. */
  function people(company, T) {
    var list = [];
    if (company.him) list.push({ id: 'him', label: T.him, kind: 'adult' });
    if (company.her) list.push({ id: 'her', label: T.her, kind: 'adult' });
    for (var k = 1; k <= company.kids; k++) list.push({ id: 'kid' + k, label: company.kids === 1 ? T.kidN(1).replace(/\s*1$/, '') : T.kidN(k), kind: 'child' });
    for (var f = 1; f <= company.friends; f++) list.push({ id: 'friend' + f, label: company.friends === 1 ? T.friendN(1).replace(/\s*1$/, '') : T.friendN(f), kind: 'adult' });
    if (!list.length) list.push({ id: 'guest', label: T.guest, kind: 'adult' });
    return list;
  }
  function companySet(company) { return company.him || company.her || company.kids > 0 || company.friends > 0; }

  /* Кто катается по умолчанию: все; на детских аттракционах, если в компании есть дети, — дети. */
  function rides(state, ride, persons) {
    var manual = state.riders[ride.id] || {};
    var hasKids = persons.some(function (p) { return p.kind === 'child'; });
    return persons.filter(function (p) {
      if (manual[p.id] === true) return true;
      if (manual[p.id] === false) return false;
      return !(ride.cat === 'kids' && hasKids && p.kind !== 'child');
    });
  }

  /* Случайная строка без похожих знаков (0/O, 1/I): номера заказов и коды билетов. */
  var ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  function rid(n) {
    var buf = [], out = '';
    try { buf = new Uint8Array(n); root.crypto.getRandomValues(buf); }
    catch (e) { buf = []; for (var i = 0; i < n; i++) buf.push(Math.floor(Math.random() * 256)); }
    for (var j = 0; j < n; j++) out += ABC[buf[j] % ABC.length];
    return out;
  }
  var MAX_ORDERS = 40;
  function orderList() { var o = read(K.orders, []); return Array.isArray(o) ? o.filter(function (x) { return x && typeof x.id === 'string'; }) : []; }

  var api = {
    keys: K, MAX_KIDS: MAX_KIDS, MAX_FRIENDS: MAX_FRIENDS,
    load: function (rideIds) { return normalize(read(K.state, null), rideIds); },
    save: function (state) { return write(K.state, state); },
    people: people, companySet: companySet, ridersOf: rides,
    consent: function () { var c = read(K.consent, null); return c === 'yes' || c === 'no' ? c : null; },
    setConsent: function (v) { write(K.consent, v === 'yes' ? 'yes' : 'no'); if (v !== 'yes') { try { root.localStorage.removeItem(K.events); } catch (e) {} } },
    /* Событие пишется только после согласия гостя, локально; внешнего счётчика нет. */
    track: function (name, props) {
      if (api.consent() !== 'yes') return false;
      var log = read(K.events, []);
      if (!Array.isArray(log)) log = [];
      log.push({ t: new Date().toISOString(), e: name, p: props || {} });
      if (log.length > MAX_EVENTS) log = log.slice(log.length - MAX_EVENTS);
      return write(K.events, log);
    },
    events: function () { var l = read(K.events, []); return Array.isArray(l) ? l : []; },
    /* Заказы и билеты: снимок состава на момент оформления, дальше не пересчитывается. */
    orders: orderList,
    order: function (id) { return orderList().filter(function (o) { return o.id === id; })[0] || null; },
    putOrder: function (order) {
      var list = orderList(), at = -1;
      list.forEach(function (o, i) { if (o.id === order.id) at = i; });
      if (at >= 0) list[at] = order; else list.push(order);
      if (list.length > MAX_ORDERS) list = list.slice(list.length - MAX_ORDERS);
      return write(K.orders, list);
    },
    newOrderId: function () { return 'YV-' + rid(4) + '-' + rid(4); },
    newTicketCode: function () { return rid(10); },
    clearEvents: function () { try { root.localStorage.removeItem(K.events); } catch (e) {} }
  };
  root.YVNStore = api;
})(typeof window !== 'undefined' ? window : globalThis);

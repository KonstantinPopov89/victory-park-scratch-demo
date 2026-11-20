/* Расчёт предложения для «Вашего дня».
   Правила продуктов те же, что в основной версии сайта (билет на одно катание одного
   человека; общий пакет на N катаний по одной цене за катание), код написан заново.

   Вход:  demand  — [{person, ride, qty}]  кто, на чём и сколько раз катается
          prices  — {ride: цена разового билета}
          packs   — [{size, price}] размеры общих пакетов
   Выход: {retail, best, offers[], rides}  — каждый вариант: {kind, total, saving, lines[]}
*/
(function (root) {
  'use strict';

  var MAX_LINE_QTY = 20;

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  /* Все достижимые ёмкости пакетов до limit: минимум цены, при равенстве меньше пакетов. */
  function packCombos(packs, required) {
    var step = packs.map(function (p) { return p.size; }).reduce(gcd);
    var biggest = Math.max.apply(null, packs.map(function (p) { return p.size; }));
    var limit = Math.max(biggest, Math.ceil(required / step) * step);
    var table = new Array(limit + 1);
    table[0] = { capacity: 0, cost: 0, count: 0, sizes: [] };
    for (var cap = step; cap <= limit; cap += step) {
      for (var i = 0; i < packs.length; i++) {
        var prev = table[cap - packs[i].size];
        if (!prev) continue;
        var cand = { capacity: cap, cost: prev.cost + packs[i].price, count: prev.count + 1,
          sizes: prev.sizes.concat(packs[i].size) };
        var cur = table[cap];
        if (!cur || cand.cost < cur.cost || (cand.cost === cur.cost && cand.count < cur.count)) table[cap] = cand;
      }
    }
    return table.filter(Boolean);
  }

  function packLines(combo, packs) {
    var bySize = {}, order = [];
    combo.sizes.forEach(function (s) { if (!bySize[s]) { bySize[s] = 0; order.push(s); } bySize[s]++; });
    var lines = [];
    order.forEach(function (size) {
      var left = bySize[size], price = packs.filter(function (p) { return p.size === size; })[0].price;
      while (left > 0) {
        var q = Math.min(left, MAX_LINE_QTY);
        lines.push({ type: 'pack', size: size, qty: q, unit: price, sum: price * q });
        left -= q;
      }
    });
    return lines;
  }

  function offer(input) {
    var prices = input.prices, packs = (input.packs || []).slice();
    var demand = [], seen = {};
    (input.demand || []).forEach(function (d) {
      if (!d || !(d.qty > 0) || prices[d.ride] == null) return;
      var key = d.person + '|' + d.ride;
      if (seen[key] == null) { seen[key] = demand.length; demand.push({ person: d.person, ride: d.ride, qty: 0 }); }
      demand[seen[key]].qty += d.qty;
    });

    var units = [];
    demand.forEach(function (d, idx) { for (var i = 0; i < d.qty; i++) units.push({ d: idx, price: prices[d.ride] }); });
    var ranked = units.map(function (u, i) { return { u: u, i: i }; })
      .sort(function (a, b) { return b.u.price - a.u.price || a.i - b.i; })
      .map(function (x) { return x.u; });

    var combos = packs.length ? packCombos(packs, ranked.length) : [{ capacity: 0, cost: 0, count: 0, sizes: [] }];
    var bestOfKind = {}, candidates = [], retail = null;

    combos.forEach(function (combo, order) {
      var kind = combo.capacity ? 'pack' : 'tickets';
      if (bestOfKind[kind] != null && combo.cost > bestOfKind[kind]) return;
      var inPack = new Array(demand.length).fill(0);
      ranked.slice(0, combo.capacity).forEach(function (u) { inPack[u.d]++; });
      var covered = Math.min(combo.capacity, ranked.length);
      var lines = combo.count ? packLines(combo, packs) : [];
      demand.forEach(function (d, idx) {
        var q = d.qty - inPack[idx];
        if (q > 0) lines.push({ type: 'ticket', person: d.person, ride: d.ride, qty: q, unit: prices[d.ride], sum: prices[d.ride] * q });
      });
      var total = lines.reduce(function (s, l) { return s + l.sum; }, 0);
      var cand = {
        kind: kind, total: total, lines: lines, order: order,
        packCapacity: combo.capacity, packUsed: covered, packSpare: combo.capacity - covered,
        signature: JSON.stringify(lines.map(function (l) { return [l.type, l.size || 0, l.person || '', l.ride || '', l.qty]; }).sort())
      };
      if (!combo.capacity) retail = cand;
      bestOfKind[kind] = bestOfKind[kind] == null ? total : Math.min(bestOfKind[kind], total);
      candidates.push(cand);
    });

    var uniq = {};
    candidates = candidates
      .sort(function (a, b) { return a.total - b.total || a.lines.length - b.lines.length || a.order - b.order; })
      .filter(function (c) { if (uniq[c.signature]) return false; uniq[c.signature] = true; return true; });

    var offers = [];
    if (candidates.length && ranked.length) {
      offers.push(candidates[0]);
      for (var i = 1; i < candidates.length && offers.length < 2; i++) {
        if (candidates[i].kind !== candidates[0].kind) offers.push(candidates[i]);
      }
      if (retail && offers.indexOf(retail) === -1) offers.push(retail);
      offers.forEach(function (o) { o.saving = retail ? retail.total - o.total : 0; });
    }
    return { rides: ranked.length, retail: ranked.length ? retail : null, best: offers[0] || null, offers: offers };
  }

  root.YVNCalc = { offer: offer, packCombos: packCombos };
})(typeof window !== 'undefined' ? window : globalThis);

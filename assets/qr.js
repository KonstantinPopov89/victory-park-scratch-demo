/* Генератор QR для демо-билета. Написан для этого прототипа по спецификации
   ISO/IEC 18004: байтовый режим, уровень коррекции M, версии 1–6. Внешних библиотек нет. */
(function (root) {
  'use strict';

  // версия -> [всего кодовых слов, слов коррекции на блок, число блоков]
  var SPEC = {
    1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1],
    4: [100, 18, 2], 5: [134, 24, 2], 6: [172, 16, 4]
  };

  // --- поле Галуа GF(256), порождающий многочлен 0x11D ---
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var v = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = v; LOG[v] = i;
      v <<= 1;
      if (v & 0x100) v ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  function rsDivisor(degree) {
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var k = 0; k < poly.length; k++) {
        next[k] ^= poly[k];
        next[k + 1] ^= gmul(poly[k], EXP[i]);
      }
      poly = next;
    }
    return poly.slice(1); // без старшего коэффициента
  }

  function rsRemainder(data, divisor) {
    var rem = new Array(divisor.length).fill(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ rem.shift();
      rem.push(0);
      for (var k = 0; k < divisor.length; k++) rem[k] ^= gmul(divisor[k], factor);
    }
    return rem;
  }

  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(String(text)));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function pickVersion(byteCount) {
    for (var v = 1; v <= 6; v++) {
      var s = SPEC[v], dataWords = s[0] - s[1] * s[2];
      if (4 + 8 + byteCount * 8 <= dataWords * 8) return v;
    }
    throw new Error('QR: строка длиннее 106 байт');
  }

  function buildCodewords(bytes, version) {
    var s = SPEC[version], total = s[0], ecLen = s[1], blocks = s[2];
    var dataWords = total - ecLen * blocks;
    var bits = [];
    function put(value, len) { for (var i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1); }
    put(4, 4);                 // байтовый режим
    put(bytes.length, 8);      // длина (версии 1–9: 8 бит)
    bytes.forEach(function (b) { put(b, 8); });
    put(0, Math.min(4, dataWords * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var words = [];
    for (var i = 0; i < bits.length; i += 8) {
      var w = 0;
      for (var k = 0; k < 8; k++) w = (w << 1) | bits[i + k];
      words.push(w);
    }
    for (var pad = 0xEC; words.length < dataWords; pad ^= 0xEC ^ 0x11) words.push(pad);

    // блоки одинаковой длины для версий 1–6 уровня M
    var per = dataWords / blocks, divisor = rsDivisor(ecLen), dataBlocks = [], ecBlocks = [];
    for (var b = 0; b < blocks; b++) {
      var chunk = words.slice(b * per, (b + 1) * per);
      dataBlocks.push(chunk);
      ecBlocks.push(rsRemainder(chunk, divisor));
    }
    var out = [];
    for (var c = 0; c < per; c++) for (var b1 = 0; b1 < blocks; b1++) out.push(dataBlocks[b1][c]);
    for (var e = 0; e < ecLen; e++) for (var b2 = 0; b2 < blocks; b2++) out.push(ecBlocks[b2][e]);
    return out;
  }

  function matrix(text) {
    var bytes = utf8(text), version = pickVersion(bytes.length);
    var size = version * 4 + 17, n = size;
    var mod = [], fn = [];
    for (var y = 0; y < n; y++) { mod.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); }
    function setFn(x, y, dark) { if (x >= 0 && x < n && y >= 0 && y < n) { mod[y][x] = !!dark; fn[y][x] = true; } }

    // поисковые узоры с разделителями
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(n - 4, 3); finder(3, n - 4);
    // синхронизация
    for (var i = 8; i < n - 8; i++) { setFn(i, 6, i % 2 === 0); setFn(6, i, i % 2 === 0); }
    // выравнивающий узор (версии 2–6: один, в правом нижнем углу)
    if (version >= 2) {
      var a = n - 7;
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++)
        setFn(a + ax, a + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    // место под форматную информацию
    function formatBits(mask) {
      var data = mask;            // уровень M = 00
      var rem = data;
      for (var k = 0; k < 10; k++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      return ((data << 10) | rem) ^ 0x5412;
    }
    function drawFormat(mask) {
      var bits = formatBits(mask);
      function bit(i) { return ((bits >>> i) & 1) === 1; }
      for (var i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (var j = 9; j < 15; j++) setFn(14 - j, 8, bit(j));
      for (var k = 0; k < 8; k++) setFn(n - 1 - k, 8, bit(k));
      for (var m = 8; m < 15; m++) setFn(8, n - 15 + m, bit(m));
      setFn(8, n - 8, true);      // тёмный модуль
    }
    drawFormat(0);

    // данные зигзагом
    var words = buildCodewords(bytes, version), idx = 0, totalBits = words.length * 8;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < n; vert++) {
        for (var j2 = 0; j2 < 2; j2++) {
          var x = right - j2;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? n - 1 - vert : vert;
          if (!fn[yy][x] && idx < totalBits) {
            mod[yy][x] = ((words[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1;
            idx++;
          }
        }
      }
    }

    var MASKS = [
      function (x, y) { return (x + y) % 2 === 0; },
      function (x, y) { return y % 2 === 0; },
      function (x, y) { return x % 3 === 0; },
      function (x, y) { return (x + y) % 3 === 0; },
      function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
      function (x, y) { return (x * y) % 2 + (x * y) % 3 === 0; },
      function (x, y) { return ((x * y) % 2 + (x * y) % 3) % 2 === 0; },
      function (x, y) { return ((x + y) % 2 + (x * y) % 3) % 2 === 0; }
    ];
    function applyMask(m) {
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++)
        if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    }
    function penalty() {
      var score = 0, x, y, run, color, dark = 0;
      function line(get) {
        var s = 0, history = '';
        for (var a = 0; a < n; a++) {
          run = 1;
          for (var b = 1; b < n; b++) {
            if (get(a, b) === get(a, b - 1)) { run++; if (run === 5) s += 3; else if (run > 5) s++; }
            else run = 1;
          }
          history = '';
          for (var c = 0; c < n; c++) history += get(a, c) ? '1' : '0';
          var from = 0, at;
          while ((at = history.indexOf('10111010000', from)) !== -1) { s += 40; from = at + 1; }
          from = 0;
          while ((at = history.indexOf('00001011101', from)) !== -1) { s += 40; from = at + 1; }
        }
        return s;
      }
      score += line(function (a, b) { return mod[a][b]; });
      score += line(function (a, b) { return mod[b][a]; });
      for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++) {
        color = mod[y][x];
        if (color === mod[y][x + 1] && color === mod[y + 1][x] && color === mod[y + 1][x + 1]) score += 3;
      }
      for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (mod[y][x]) dark++;
      score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
      return score;
    }

    var best = 0, bestScore = Infinity;
    for (var m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      var p = penalty();
      if (p < bestScore) { bestScore = p; best = m; }
      applyMask(m); // снять маску (XOR)
    }
    applyMask(best); drawFormat(best);
    return { size: n, version: version, mask: best, modules: mod };
  }

  /** SVG-разметка QR. quiet — поле вокруг в модулях. */
  function svg(text, opts) {
    opts = opts || {};
    var q = matrix(text), quiet = opts.quiet == null ? 4 : opts.quiet, n = q.size, d = '';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (!q.modules[y][x]) continue;
        var len = 1;
        while (x + len < n && q.modules[y][x + len]) len++;
        d += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + len + 'v1h-' + len + 'z';
        x += len - 1;
      }
    }
    var full = n + quiet * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + full + ' ' + full +
      '" shape-rendering="crispEdges" role="img" aria-label="' + (opts.label || 'QR') + '">' +
      '<rect width="' + full + '" height="' + full + '" fill="#fff"/>' +
      '<path d="' + d + '" fill="#000"/></svg>';
  }

  root.VPQR = { matrix: matrix, svg: svg };
})(typeof window !== 'undefined' ? window : globalThis);

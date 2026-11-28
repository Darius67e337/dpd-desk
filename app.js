/* Grok Bot · the desk app (STEP 10). Plain JS, no framework, no build step.
   Plan B (static GitHub Pages): it polls the published JSON every 15 s, never SSE, and it cannot write to the desk
   from Pages: pause, settings, Sell now and PAPER/LIVE are shown and routed through Telegram, and each row says so.
   Served by the desk itself (127.0.0.1) it talks to /api/* with the token and the writes are real.
   The secret data path (#d=) and the API token (#t=) are read once from the URL hash into localStorage and removed
   from the address bar. Nothing secret is in this file. FOMO links are used exactly as the desk sends them. */
(function () {
  'use strict';
  var TZ = 'Europe/Bucharest', POLL_S = 15;
  var BOTS = ['scanner', 'analyst', 'brain', 'executor', 'risk'];
  var NAMES = { scanner: 'Scanner', analyst: 'Analyst', brain: 'Brain', executor: 'Executor', risk: 'Risk' };
  var COL = { scanner: '#64d2ff', analyst: '#ffd60a', brain: '#bf5af2', executor: '#00d35a', risk: '#ff6b9a' };
  var RANGES = ['LIVE', '1H', '4H', '1D', '1W', 'ALL'];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) for (var k in props) {
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(e, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(e, x); }); else e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); }
  function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); return e; }

  /* ---------- formatting (only real numbers; a missing one is a dash) ---------- */
  var DASH = '–';
  function usd(v, d) { if (v == null || !isFinite(v)) return DASH; d = d == null ? 2 : d; return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function sgn(v, d) { if (v == null || !isFinite(v)) return DASH; return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(d == null ? 2 : d); }
  function pct(v, d) { if (v == null || !isFinite(v)) return DASH; return (v >= 0 ? '+' : '') + v.toFixed(d == null ? 2 : d) + '%'; }
  function compact(v) { if (v == null || !isFinite(v)) return DASH; var a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K'; return '$' + v.toFixed(0); }
  function price(v) {
    if (v == null || !isFinite(v)) return DASH;
    if (v >= 1) return '$' + v.toFixed(2);
    if (v >= 0.01) return '$' + v.toFixed(4);
    var s = v.toPrecision(4);
    if (/e-/.test(s)) s = v.toFixed(10).replace(/0+$/, '');
    return '$' + s;
  }
  function fmtTime(ts, secs) {
    var d = new Date(typeof ts === 'number' ? ts * 1000 : ts); if (isNaN(d)) return DASH;
    var o = { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }; if (secs) o.second = '2-digit';
    return d.toLocaleTimeString('en-GB', o);
  }
  function dayKey(ts) { return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ }); }
  function whenLabel(ts) { var k = dayKey(ts); return k === dayKey(Date.now()) ? fmtTime(ts) : new Date(ts).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }) + ' ' + fmtTime(ts); }
  function age(min) { if (min == null || !isFinite(min)) return DASH; if (min < 60) return Math.round(min) + 'm old'; if (min < 1440) return Math.round(min / 60) + 'h old'; return Math.round(min / 1440) + 'd old'; }
  function symOf(title) { var m = /^(?:Bought|Sold|Stopped|Rejected|Unverified)\s+(.+)$/.exec(title || ''); return m ? m[1] : (title || '?'); }

  /* ---------- where the data comes from ---------- */
  var LS = window.localStorage;
  var SRC = { mode: 'pages', dp: '', t: '' };
  (function readHash() {
    var hs = (location.hash || '').replace(/^#/, '');
    var go = null;
    if (hs && hs.charAt(0) !== '/') {
      hs.split('&').forEach(function (kv) {
        var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
        if (k === 'd' && v) LS.setItem('dpd_d', v);
        else if (k === 't' && v) LS.setItem('dpd_t', v);
        else if (k === 'go' && v.charAt(0) === '/') go = v;
      });
      /* In Safari keep the key hash so "Add to Home Screen" saves the private link; strip it only inside the home-screen app. */
      if (window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) history.replaceState(null, '', location.pathname + location.search + '#' + (go || '/home'));
    }
    SRC.dp = LS.getItem('dpd_d') || ''; SRC.t = LS.getItem('dpd_t') || '';
    var local = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    SRC.mode = local && SRC.t ? 'api' : 'pages';
  })();
  var BASE = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
  var MAP = {
    state: ['state.json', '/api/state'], beat: ['beat.json', '/api/beat'], account: ['account.json', '/api/account'],
    settings: ['settings.json', '/api/settings'], orders: ['orders.json', '/api/orders'], coins: ['coins.json', '/api/coins'],
    screen: ['screen.json', '/api/screen.json'], activity: ['activity.json', '/api/activity']
  };
  function srcUrl(key, arg) {
    var p, q;
    if (key === 'chart') { p = 'chart/' + arg + '.json'; q = '/api/chart?range=' + arg; }
    else if (key === 'coin') { p = 'coin/' + arg + '.json'; q = '/api/coin/' + arg; }
    else if (key === 'audit') { p = 'audit/' + arg + '.json'; q = '/api/audit/' + arg; }
    else if (key === 'decisions') { p = 'bots/' + arg + '/decisions.json'; q = '/api/bots/' + arg + '/decisions'; }
    else if (key === 'before') { p = 'activity/before-' + arg + '.json'; q = '/api/activity?before=' + arg; }
    else { p = MAP[key][0]; q = MAP[key][1]; }
    var u = SRC.mode === 'api' ? q : BASE + 'd/' + encodeURIComponent(SRC.dp) + '/' + p;
    return u + (u.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now();
  }
  function frameUrl(ts) { return (SRC.mode === 'api' ? '/api/screen.jpg' : BASE + 'd/' + encodeURIComponent(SRC.dp) + '/screen.jpg') + '?_=' + ts; }
  async function getJSON(key, arg) {
    var opts = { cache: 'no-store' };
    if (SRC.mode === 'api') opts.headers = { Authorization: 'Bearer ' + SRC.t };
    var r = await fetch(srcUrl(key, arg), opts);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (j && j.ok === false) throw new Error(j.error || 'not ok');
    return j;
  }

  /* ---------- state ---------- */
  var D = { state: null, beat: null, account: null, settings: null, orders: null, coins: null, screen: null, activity: null, chart: {}, dec: {}, coin: {}, audit: {}, more: [] };
  var sig = {};          // JSON text per resource: re-render only when it really changed
  var rangeSel = 'LIVE', lastOk = 0, nextAt = 0, failing = false, seenAct = LS.getItem('dpd_seen') || '0';

  async function load(key, arg, store) {
    var id = key + ':' + (arg || '');
    try {
      var j = await getJSON(key, arg), s = JSON.stringify(j);
      var changed = sig[id] !== s; sig[id] = s;
      store(j); return { ok: true, changed: changed };
    } catch (e) { return { ok: false, err: e }; }
  }

  /* one-time setup inside the home-screen app: paste the private link, kept only in localStorage */
  function setupBox() {
    if (document.getElementById('dpd-setup')) return;
    var w = document.createElement('div'); w.id = 'dpd-setup';
    w.style.cssText = 'position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top) + 140px);z-index:9999;background:#1c1c1e;border-radius:16px;padding:16px;font:15px -apple-system,system-ui;color:#fff';
    w.innerHTML = '<div style="font-weight:600;margin-bottom:6px">Connect your desk</div>' +
      '<div style="color:rgba(235,235,245,0.6);margin-bottom:10px">Long-press your private link in Telegram, tap Copy, then paste it here.</div>' +
      '<input id="dpd-setup-in" type="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://...#d=..." style="width:100%;box-sizing:border-box;min-height:44px;border-radius:10px;border:0;padding:0 12px;background:#2c2c2e;color:#fff;font:15px -apple-system,system-ui">' +
      '<button id="dpd-setup-go" style="margin-top:10px;width:100%;min-height:44px;border:0;border-radius:10px;background:#00d35a;color:#000;font:600 16px -apple-system,system-ui">Save</button>' +
      '<div id="dpd-setup-msg" style="color:#ff453a;margin-top:8px;min-height:18px"></div>';
    document.body.appendChild(w);
    document.getElementById('dpd-setup-go').onclick = function () {
      var v = (document.getElementById('dpd-setup-in').value || '').trim();
      var m = /[#&]d=([^&\s]+)/.exec(v), t = /[#&]t=([^&\s]+)/.exec(v);
      if (!m) { document.getElementById('dpd-setup-msg').textContent = 'That link has no #d= part. Copy the whole link from Telegram.'; return; }
      LS.setItem('dpd_d', decodeURIComponent(m[1])); if (t) LS.setItem('dpd_t', decodeURIComponent(t[1]));
      location.replace(location.pathname + '#/home'); location.reload();
    };
  }

  async function poll() {
    if (!SRC.dp && SRC.mode === 'pages') { showErr('Paste your private link below once. It stays only on this phone.', true); firstLoad(); setupBox(); return; }
    var jobs = [
      load('state', null, function (j) { D.state = j; }),
      load('chart', rangeSel, function (j) { D.chart[rangeSel] = j; }),
      load('activity', null, function (j) { D.activity = j; }),
      load('beat', null, function (j) { D.beat = j; }),
      load('screen', null, function (j) { D.screen = j; }),
      load('orders', null, function (j) { D.orders = j; }),
      load('account', null, function (j) { D.account = j; }),
      load('coins', null, function (j) { D.coins = j; })
    ];
    var v = view();
    if (v.name === 'bots') BOTS.forEach(function (b) { jobs.push(load('decisions', b, function (j) { D.dec[b] = j; })); });
    if (v.name === 'account' || v.name === 'bots') jobs.push(load('settings', null, function (j) { D.settings = j; }));
    if (v.name === 'coin') jobs.push(load('coin', v.arg, function (j) { D.coin[v.arg] = j; }));
    if (v.name === 'audit') jobs.push(load('audit', v.arg, function (j) { D.audit[v.arg] = j; }));
    var res = await Promise.all(jobs);
    var stateOk = res[0].ok;
    if (stateOk) lastOk = Date.now();
    var stale = false;
    if (stateOk && D.beat && D.beat.ts) stale = (Date.now() - new Date(D.beat.ts).getTime()) > ((D.beat.every_s || 300) * 4 * 1000);
    failing = !stateOk || stale;
    nextAt = Date.now() + POLL_S * 1000;
    firstLoad();
    renderAll();
    updateErr();
  }
  var loaded = false;
  function firstLoad() { if (!loaded && (D.state || failing)) { loaded = true; } if (D.state) $('#home').classList.remove('is-loading'); }

  /* ---------- error row ---------- */
  var errText = null;
  function showErr(t, fixed) { errText = fixed ? t : null; $$('[data-err]').forEach(function (e) { if (t) { e.textContent = t; e.classList.add('on'); } else e.classList.remove('on'); }); }
  function updateErr() {
    if (errText) return;
    if (!failing) return showErr(null);
    var n = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
    var last = D.beat && D.beat.ts ? D.beat.ts : (lastOk || (D.state && D.state.ts));
    showErr('Desk offline · retrying in ' + n + 's · last update ' + (last ? fmtTime(last) : DASH));
  }
  setInterval(function () { if (failing) updateErr(); }, 1000);

  /* ---------- router ---------- */
  function view() {
    var m = /^#\/([a-z]+)(?:\/(.+))?$/.exec(location.hash || '');
    var name = m ? m[1] : 'home';
    if (['home', 'bots', 'activity', 'account', 'audit', 'coin'].indexOf(name) < 0) name = 'home';
    return { name: name, arg: m && m[2] ? decodeURIComponent(m[2]) : null };
  }
  var auditPlayed = {};
  function show() {
    var v = view();
    $$('.screen').forEach(function (s) { s.classList.toggle('on', s.id === v.name); });
    var tab = ['audit', 'coin'].indexOf(v.name) >= 0 ? (LS.getItem('dpd_tab') || 'home') : v.name;
    if (['audit', 'coin'].indexOf(v.name) < 0) LS.setItem('dpd_tab', v.name);
    $$('.tabbar button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    window.scrollTo(0, 0);
    renderAll(true);
    poll();
  }
  window.addEventListener('hashchange', show);
  function go(path) { location.hash = '#/' + path; }

  /* ---------- toast, sheets ---------- */
  var toastT;
  function toast(t) { var e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { e.classList.remove('on'); }, 2200); }
  function sheet(content) { var s = $('#sheet'); clear(s); add(s, content); $('#scrim').classList.add('on'); requestAnimationFrame(function () { s.classList.add('on'); }); }
  function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
  $('#scrim').addEventListener('click', closeSheet);
  function copy(text, msg) {
    var done = function () { toast(msg || 'Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) { var t = h('textarea', { style: 'position:fixed;opacity:0' }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) { } t.remove(); }

  /* Plan B: Pages is read-only. A write shows the exact Telegram command and says why. */
  function viaTelegram(title, cmd, extra) {
    var a = D.account || {}, bot = a.telegram_bot;
    sheet([
      h('h3', { text: title }),
      h('p', { text: 'Plan B: this page is static (GitHub Pages) and cannot reach the desk. This runs through Telegram. Send:' }),
      h('div', { class: 'code', text: cmd }),
      extra || null,
      h('p', { style: 'color:rgba(235,235,245,.6);font-size:13px', text: a.telegram_commands === false ? 'The desk has no Telegram token or owner chat set, so it cannot answer yet.' : 'The bot answers only you. Anything that moves money asks you to confirm with yes first.' }),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn', text: 'Copy command', onclick: function () { copy(cmd, 'Command copied'); } }),
        bot ? h('a', { class: 'btn blue', href: 'https://t.me/' + bot, target: '_blank', rel: 'noopener', text: 'Open Telegram' }) : null),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Close', onclick: closeSheet }))
    ]);
  }
  async function post(path, body) {
    var r = await fetch(path, { method: 'POST', headers: { Authorization: 'Bearer ' + SRC.t, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    var j = {}; try { j = await r.json(); } catch (e) { }
    return { ok: r.ok && j.ok !== false, j: j };
  }
  async function write(kind, a) {
    if (SRC.mode !== 'api') {
      if (kind === 'pause' || kind === 'resume') return viaTelegram((kind === 'pause' ? 'Pause ' : 'Resume ') + NAMES[a.bot], kind + ' ' + NAMES[a.bot]);
      if (kind === 'set') return viaTelegram('Change a setting', 'set ' + a.key + ' to ' + a.value);
      if (kind === 'mode') return viaTelegram('Switch to ' + a.mode, a.mode.toLowerCase(), a.mode === 'LIVE' ? h('p', { text: 'Telegram will ask you to type LIVE.' }) : null);
      if (kind === 'sell') return viaTelegram('Sell ' + a.symbol + ' ' + a.pct + '%', 'sell ' + a.symbol + ' ' + a.pct);
      return;
    }
    var r;
    if (kind === 'pause' || kind === 'resume') r = await post('/api/bots/' + a.bot + '/' + kind);
    else if (kind === 'set') r = await post('/api/settings', { key: a.key, value: a.value });
    else if (kind === 'mode') r = await post('/api/mode', { mode: a.mode, confirm: a.mode === 'LIVE' ? 'LIVE' : undefined });
    else if (kind === 'sell') r = await post('/api/sell/' + a.mint, { pct: a.pct, confirm: true });
    toast(r.ok ? 'Done' : (r.j && r.j.error) || 'Refused');
    closeSheet(); poll();
  }

  /* ---------- odometer ---------- */
  function Odo(root) { this.root = root; this.cells = []; this.str = ''; }
  Odo.prototype.set = function (s) {
    if (s === this.str) return;
    var rebuild = s.length !== this.str.length; this.str = s;
    this.root.setAttribute('aria-label', s);
    if (rebuild) {
      clear(this.root); this.cells = [];
      for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (/\d/.test(ch)) {
          var col = h('span', { class: 'col' }); for (var n = 0; n < 10; n++) col.appendChild(h('i', { text: n }));
          col.style.transition = 'none'; col.style.transform = 'translateY(' + (-10 * +ch) + '%)'; col.dataset.v = ch;
          this.root.appendChild(h('span', { class: 'd' }, col)); this.cells.push(col);
        } else { this.root.appendChild(h('span', { class: 's', text: ch })); this.cells.push(null); }
      }
      void this.root.offsetWidth;
      this.cells.forEach(function (c) { if (c) c.style.transition = ''; });
      return;
    }
    var self = this;
    this.cells.forEach(function (c, i) {
      if (!c) { var sp = self.root.children[i]; if (sp.textContent !== s.charAt(i)) sp.textContent = s.charAt(i); return; }
      var ch = s.charAt(i); if (c.dataset.v === ch) return; c.dataset.v = ch;
      if (reduce) { c.style.transition = 'none'; } else { c.style.transition = ''; c.style.transitionDelay = (i * 30) + 'ms'; }
      c.style.transform = 'translateY(' + (-10 * +ch) + '%)';
    });
  };

  /* ---------- helpers for data ---------- */
  function isPaper() { return !D.state || D.state.mode !== 'LIVE'; }
  function coinInfo(mint) {
    var c = D.coins && D.coins.rows && D.coins.rows.filter(function (r) { return r.mint === mint; })[0];
    return c || null;
  }
  function orderLabel(o) {
    var c = o.checks || {}, none = c.screen == null && c.api == null && c.chain == null;
    if (o.status === 'done') return (o.mode === 'PAPER' || none) ? 'paper fill' : (c.screen && c.api && c.chain !== false ? 'verified' : 'unchecked');
    if (o.status === 'unverified') return 'unverified';
    if (o.status === 'clicking') return 'clicking';
    if (o.status === 'verifying') return 'verifying';
    return o.status || '';
  }
  function checkDots(o) {
    var c = (o && o.checks) || {};
    return [['screen', 'S'], ['api', 'A'], ['chain', 'C']].map(function (p) {
      var v = c[p[0]];
      return h('span', { class: 'chk ' + (v === true ? 'ok' : v === false ? 'bad' : ''), title: p[0] + ': ' + (v === true ? 'ok' : v === false ? 'does not match' : 'n/a'), text: v === true ? '✓' : v === false ? '✕' : '–' });
    });
  }
  function fomoLink(url, cls, label) { return url ? h('a', { class: cls || 'fomo', href: url, target: '_blank', rel: 'noopener', text: label || 'Open on FOMO', onclick: function (e) { e.stopPropagation(); } }) : null; }

  /* ================= HOME ================= */
  var odo = new Odo($('#odo')), line = new window.DeskCharts.LineChart($('#lineChart'));
  var bufs = [$('#imgA'), $('#imgB')], front = 0, shownTs = null, frameBusy = false;

  function renderRanges() {
    var box = $('#ranges'); if (box.children.length) { $$('button', box).forEach(function (b) { b.classList.toggle('on', b.dataset.r === rangeSel); }); return; }
    RANGES.forEach(function (r) { box.appendChild(h('button', { 'data-r': r, text: r, class: r === rangeSel ? 'on' : '', onclick: function () { rangeSel = r; renderRanges(); var c = D.chart[r]; if (c) drawChart(c); poll(); } })); });
  }
  function drawChart(c) {
    line.set({ points: c.points, marks: c.marks, start: c.start });
    var s = D.state, trades = s && ((s.last_order && true) || (s.positions && s.positions.length) || (c.marks && c.marks.length));
    var e = $('#chartEmpty');
    if (!c.points || c.points.length < 2) e.textContent = trades ? 'Not enough balance points in this range' : 'Waiting for the first trade';
    else e.textContent = trades ? '' : 'Waiting for the first trade';
    e.style.alignItems = c.points && c.points.length >= 2 ? 'end' : 'center'; e.style.paddingBottom = c.points && c.points.length >= 2 ? '34px' : '0';
  }
  function setFrame(ts) {
    if (frameBusy || ts === shownTs) return; frameBusy = true;
    var nxt = 1 - front, img = bufs[nxt];
    img.onload = function () { img.classList.add('show'); bufs[front].classList.remove('show'); front = nxt; shownTs = ts; frameBusy = false; $('#frameEmpty').style.display = 'none'; };
    img.onerror = function () { frameBusy = false; };
    img.src = frameUrl(ts);
  }
  function renderLive() {
    var sc = D.screen || {}, st = D.state || {}, lane = st.lane || {};
    var has = !!sc.has_frame, ageS = has && sc.frame_ts ? (Date.now() / 1000 - sc.frame_ts) : null;
    var dot = $('#liveDot'), txt = $('#liveTxt');
    if (sc.private) { dot.className = ''; txt.textContent = 'Paused · private'; }
    else if (has && ageS != null && ageS < 5) { dot.className = 'red'; txt.textContent = 'Live · Bot\u2019s computer'; }
    else if (has) { dot.className = ''; txt.textContent = 'Last frame ' + fmtTime(sc.frame_ts, true); }
    else { dot.className = ''; txt.textContent = 'No frame yet'; }
    if (has && !sc.private) setFrame(sc.frame_ts);
    else { bufs.forEach(function (b) { b.classList.remove('show'); b.removeAttribute('src'); }); shownTs = null; $('#frameEmpty').style.display = ''; $('#frameEmpty').firstChild.textContent = sc.private ? 'Paused · private' : 'No frame yet'; }
    var chip = $('#laneChip');
    if (lane.busy) { chip.textContent = NAMES[lane.bot] + ' · ' + lane.action; chip.style.color = COL[lane.bot]; }
    else { chip.textContent = 'Idle'; chip.style.color = 'rgba(235,235,245,0.6)'; }
    var o = st.last_order, t = $('#lastOrderTxt'), ck = clear($('#lastChecks'));
    if (!o) { t.textContent = 'No orders yet'; t.style.color = 'rgba(235,235,245,0.6)'; return; }
    t.style.color = ''; t.textContent = (o.side === 'buy' ? 'Bought ' : 'Sold ') + (o.symbol || '?') + ' · ' + usd(o.fill_usd != null ? o.fill_usd : o.usd) + ' · ' + orderLabel(o);
    add(ck, checkDots(o));
  }
  function runningCount(st) { return BOTS.filter(function (b) { var x = st.bots && st.bots[b]; return x && x.status === 'running' && !x.paused; }).length; }
  function ring(score, minScore) {
    var r = 28, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, score || 0)), col = v >= (minScore || 70) ? '#00d35a' : '#ffd60a';
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 64 64');
    [['rgba(84,84,88,.55)', c], [col, c * (1 - v / 100)]].forEach(function (p) { var k = document.createElementNS(ns, 'circle'); k.setAttribute('cx', 32); k.setAttribute('cy', 32); k.setAttribute('r', r); k.setAttribute('fill', 'none'); k.setAttribute('stroke', p[0]); k.setAttribute('stroke-width', 6); k.setAttribute('stroke-linecap', 'round'); k.setAttribute('stroke-dasharray', c); k.setAttribute('stroke-dashoffset', p[1]); svg.appendChild(k); });
    return h('div', { class: 'ring' }, svg, h('b', { text: score == null ? DASH : Math.round(v), style: 'color:' + col }));
  }
  function botCard(name, st) {
    var x = (st.bots || {})[name] || {}, col = COL[name], body = [];
    var sdot = h('i', { class: 'sdot' + (x.paused ? ' warn' : x.status === 'running' ? '' : ' off') });
    var head = h('div', { class: 'hd' }, sdot, h('span', { text: NAMES[name], style: 'color:' + col }), x.paused ? h('span', { class: 'note', text: 'paused' }) : null);
    if (name === 'scanner') {
      body.push(h('div', { class: 'big', text: (x.pools != null ? x.pools : DASH) + ' pools' }));
      var feed = h('div', { class: 'feed' });
      (x.feed || []).slice(0, 5).forEach(function (f) { var kill = f.verdict === 'kill'; feed.appendChild(h('div', { class: 'r ' + (kill ? 'kill' : 'pass') }, h('span', { class: 'n', text: f.symbol || '?' }), h('span', { class: 'w', text: kill ? (f.reason || 'killed') : '→ Analyst' }))); });
      if (!(x.feed || []).length) feed.appendChild(h('div', { class: 'note', text: 'No pools scanned yet' }));
      body.push(feed);
    } else if (name === 'analyst') {
      body.push(h('div', { class: 'big', text: (x.taken_apart != null ? x.taken_apart : DASH) + ' taken apart' }));
      var l = x.last;
      if (l) {
        var strips = h('div', { class: 'strips' }); (l.layers || []).forEach(function (p) { strips.appendChild(h('i', { class: p === true ? 'ok' : p === false ? 'bad' : '' })); });
        body.push(h('div', { class: 'ringrow' }, ring(l.score, x.min_score), h('div', { style: 'flex:1' }, h('div', { style: 'font-weight:600', text: l.symbol || '?' }), strips,
          h('div', { class: 'note', style: 'margin-top:6px', text: (l.social_pts ? 'Social +' + l.social_pts : 'Social: off') }))));
      } else body.push(h('div', { class: 'note', text: 'Nothing taken apart yet' }));
    } else if (name === 'brain') {
      body.push(h('div', { class: 'big', text: 'Sizing' }));
      var b = x.last;
      body.push(b ? h('div', { style: 'font-weight:600', text: usd(b.usd) + ' · ' + Math.round(b.pct || 0) + '% of cash' }) : h('div', { class: 'note', text: 'No order sized yet' }));
      if (b) body.push(h('div', { class: 'note', text: b.symbol || '' }));
      body.push(h('div', { class: 'note', text: (x.full_size_score != null ? x.full_size_score : DASH) + '+ = full size' }));
      body.push(h('div', { class: 'note', text: 'under ' + (x.full_size_score != null ? x.full_size_score : DASH) + ' = ' + (x.below_full_pct != null ? 'a ' + x.below_full_pct + '% size' : 'half size') }));
      (x.pauses || []).forEach(function (p) { body.push(h('div', { class: 'note', style: 'color:#ff9f0a;margin-top:6px', text: p.text })); });
    } else if (name === 'executor') {
      body.push(h('div', { class: 'big', text: (x.trades != null ? x.trades : DASH) + ' trades' }));
      var lane = st.lane || {}, o = st.last_order, msg;
      if (lane.busy && lane.bot === 'executor') msg = (lane.action === 'buying' ? 'Clicking Buy...' : 'Clicking Sell...');
      else if ((x.waiting || []).length) msg = 'Waiting for a dip -' + x.dip_pct + '%';
      else if (o && o.bot === 'executor' && o.status === 'done') msg = '✓ ' + (o.side === 'buy' ? 'Bought' : 'Sold') + ' · ' + orderLabel(o);
      else msg = 'Idle';
      body.push(h('div', { class: 'bar-s', text: msg }));
      if ((x.waiting || []).length) body.push(h('div', { class: 'note', text: x.waiting.map(function (w) { return w.symbol; }).join(', ') }));
    } else {
      var open = x.open || 0;
      body.push(h('div', { class: 'big', text: open ? 'Guarding' : 'Standing by' }));
      body.push(h('div', { class: 'note', text: open ? open + ' open position' + (open > 1 ? 's' : '') : 'Nothing open to guard' }));
      var pills = [h('span', { class: 'tpill red', text: 'stop -' + (x.stop_pct != null ? x.stop_pct : DASH) + '%' })];
      if (x.lock_arm_pct != null && x.lock_drop_pts != null) pills.push(h('span', { class: 'tpill green', text: 'lock +' + x.lock_arm_pct + '%/-' + x.lock_drop_pts + 'pts' }));
      if (x.hard_tp_pct != null) pills.push(h('span', { class: 'tpill green', text: 'hard TP +' + x.hard_tp_pct + '%' }));
      pills.push(h('span', { class: 'tpill green', text: 'trail ' + (x.trail_pct != null ? x.trail_pct : DASH) + '%' }));
      body.push(h('div', { class: 'pills' }, pills));
      if (x.lock_arm_pct != null && x.lock_drop_pts != null) body.push(h('div', { class: 'note', text: 'Lock: after +' + x.lock_arm_pct + '%, sell if profit drops ' + x.lock_drop_pts + ' pts from the peak.' }));
      if (x.hard_tp_pct != null) body.push(h('div', { class: 'note', text: 'Hard take-profit: sell 100% at +' + x.hard_tp_pct + '% from entry.' }));
      if (x.planb) body.push(h('div', { class: 'note', text: 'Plan B stop: tighter, clicks are slower' }));
    }
    return h('div', { class: 'card bot', onclick: function () { go('bots'); } }, head, body);
  }
  function actRow(r, withTime) {
    var kind = r.kind, trade = kind === 'bought' || kind === 'sold' || kind === 'stopped';
    var icol = kind === 'bought' ? '#0a84ff' : kind === 'sold' ? '#00d35a' : kind === 'stopped' ? '#ff453a' : kind === 'paused' ? '#ff9f0a' : kind === 'night' ? '#64d2ff' : 'rgba(235,235,245,.6)';
    var vcol = kind === 'sold' || kind === 'night' ? 'pos' : kind === 'stopped' ? 'neg' : '';
    var sym = symOf(r.title);
    var row = h('div', { class: 'row', role: 'button', tabindex: 0, onclick: function () { if (r.mint) go((trade ? 'coin/' : 'audit/') + r.mint); } },
      h('div', { class: 'ic', style: 'color:' + icol, text: sym.charAt(0).toUpperCase() }),
      h('div', { class: 'mid' }, h('div', { class: 't', text: r.title }), h('div', { class: 's', text: r.subtitle }), fomoLink(r.link)),
      h('div', { class: 'v ' + vcol }, r.value, h('small', { text: withTime ? whenLabel(r.ts) : fmtTime(r.ts) })));
    return row;
  }
  function renderHome() {
    var st = D.state; if (!st) return;
    var a = D.account || {};
    $('#avatar').textContent = (a.fomo_handle || 'D').charAt(0).toUpperCase();
    odo.set(usd(st.balance));
    $('#paperPill').hidden = !isPaper();
    var t = $('#today'); t.textContent = pct(st.today_pct); t.className = 'num ' + (st.today_pct >= 0 ? 'pos' : 'neg');
    var m = $('#mult'); m.textContent = (st.multiplier != null ? st.multiplier.toFixed(2) : DASH) + '×'; m.className = 'pill mult' + (st.multiplier < 1 ? ' neg' : '');
    renderRanges(); var c = D.chart[rangeSel]; if (c) drawChart(c);
    renderLive();
    $('#botsTitle').textContent = 'Bots · ' + runningCount(st) + ' running';
    var key = JSON.stringify([st.bots, st.lane, st.last_order]);
    if (key !== renderHome.k) { renderHome.k = key; var car = $('#carousel'); clear(car); BOTS.forEach(function (b) { car.appendChild(botCard(b, st)); }); }
    var rows = (D.activity && D.activity.rows) || [], box = clear($('#homeAct'));
    if (!rows.length) box.appendChild(h('div', { class: 'empty-card', text: 'Nothing yet tonight' }));
    else { var list = h('div', { class: 'list' }); rows.slice(0, 5).forEach(function (r) { list.appendChild(actRow(r, true)); }); box.appendChild(list); }
    var newest = rows[0] ? String(rows[0].id) : '0';
    $('#bellDot').hidden = !(rows[0] && +newest > +seenAct);
  }

  /* full screen frame: pinch to zoom, drag, double tap */
  (function fullscreen() {
    var full = $('#full'), img = $('#fullImg'), stage = $('#stage');
    var sc = 1, tx = 0, ty = 0, pts = {}, d0 = 0, sc0 = 1, last = 0;
    function apply() { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')'; }
    function reset() { sc = 1; tx = ty = 0; apply(); }
    $('#frame').addEventListener('click', function () {
      var s = D.screen || {}; if (!s.has_frame || s.private) return;
      img.src = frameUrl(s.frame_ts); reset(); full.classList.add('on');
      var ord = s.order && D.orders && D.orders.rows && D.orders.rows.filter(function (o) { return o.id === s.order; })[0];
      var a = $('#fullFomo'); if (ord && ord.link) { a.href = ord.link; a.hidden = false; } else a.hidden = true;
    });
    $('#fullClose').addEventListener('click', function () { full.classList.remove('on'); });
    stage.addEventListener('pointerdown', function (e) { pts[e.pointerId] = [e.clientX, e.clientY]; stage.setPointerCapture(e.pointerId); var ids = Object.keys(pts); if (ids.length === 2) { d0 = Math.hypot(pts[ids[0]][0] - pts[ids[1]][0], pts[ids[0]][1] - pts[ids[1]][1]); sc0 = sc; } var n = Date.now(); if (ids.length === 1 && n - last < 300) reset(); last = n; });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return; var ids = Object.keys(pts), p = pts[e.pointerId];
      if (ids.length === 2) { pts[e.pointerId] = [e.clientX, e.clientY]; var d = Math.hypot(pts[ids[0]][0] - pts[ids[1]][0], pts[ids[0]][1] - pts[ids[1]][1]); sc = Math.min(6, Math.max(1, sc0 * d / (d0 || 1))); }
      else if (sc > 1) { tx += e.clientX - p[0]; ty += e.clientY - p[1]; pts[e.pointerId] = [e.clientX, e.clientY]; }
      apply();
    });
    var up = function (e) { delete pts[e.pointerId]; if (sc <= 1) { tx = ty = 0; apply(); } };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  })();

  /* ================= BOTS TAB ================= */
  function todayCount(name, st) {
    var x = (st.bots || {})[name] || {};
    if (name === 'scanner') return (x.pools != null ? x.pools : DASH) + ' pools · ' + (x.passed || 0) + ' passed';
    if (name === 'analyst') return (x.taken_apart != null ? x.taken_apart : DASH) + ' taken apart · ' + (x.passed || 0) + ' passed';
    if (name === 'brain') return (x.sized != null ? x.sized : DASH) + ' sized';
    if (name === 'executor') return (x.trades != null ? x.trades : DASH) + ' trades';
    return (x.open || 0) + ' open';
  }
  function decRow(name, it) {
    var sym = it.symbol || (it.mint || '').slice(0, 6), dest = (name === 'executor' || name === 'risk') ? 'coin/' : 'audit/', txt;
    if (name === 'scanner') txt = (it.verdict || '') + (it.reason ? ' · ' + it.reason : '');
    else if (name === 'analyst') txt = 'score ' + (it.score != null ? Math.round(it.score) : DASH) + ' · ' + (it.pass ? 'pass' : 'fail') + (it.reason ? ' · ' + it.reason.split(' · ')[0] : '');
    else if (name === 'brain') txt = it.reason || it.title || '';
    else if (name === 'executor') txt = (it.side === 'buy' ? 'Bought ' : 'Sold ') + usd(it.usd) + ' · ' + (it.status || '');
    else txt = (it.title || '') + ' · ' + (it.reason || '');
    return h('div', { class: 'r' }, h('button', { class: 'a', style: 'color:#fff', text: sym, onclick: function () { if (it.mint) go(dest + it.mint); } }),
      h('span', { class: 'b', text: txt }), fomoLink(it.link, 'fomo', 'FOMO ↗'));
  }
  function renderBots() {
    var st = D.state, body = $('#botsBody'); if (!st) { if (!body.firstChild) skeleton(body, 5, 150); return; }
    var key = JSON.stringify([st.bots, st.protect, D.dec, st.positions]); if (key === renderBots.k) return; renderBots.k = key; clear(body);
    var pauses = (st.protect && st.protect.pauses) || (st.bots && st.bots.brain && st.bots.brain.pauses) || [];
    if (pauses.length) {
      var banner = h('div', { class: 'card', style: 'margin:0 0 14px;padding:14px 16px' });
      banner.appendChild(h('div', { style: 'font-weight:600;color:#ff9f0a', text: pauses.every(function (p) { return p.kind === 'cooldown'; }) ? (pauses.length === 1 ? 'Skipping 1 coin' : 'Skipping ' + pauses.length + ' coins') + ' · other buys on' : 'Buys paused' }));
      pauses.forEach(function (p) { banner.appendChild(h('div', { class: 'note', style: 'margin-top:4px', text: p.text })); });
      body.appendChild(banner);
    }
    BOTS.forEach(function (name) {
      var x = st.bots[name] || {}, dec = D.dec[name], locked = name === 'risk' && (x.open || 0) > 0;
      var sw = h('button', { class: 'switch' + (x.paused ? '' : ' on'), disabled: locked, 'aria-label': (x.paused ? 'Resume ' : 'Pause ') + NAMES[name], onclick: function () { write(x.paused ? 'resume' : 'pause', { bot: name }); } });
      var items = h('div', { class: 'decs' });
      if (!dec) items.appendChild(h('div', { class: 'r' }, h('span', { class: 'b', text: 'Loading…' })));
      else if (!dec.items.length) items.appendChild(h('div', { class: 'r' }, h('span', { class: 'b', style: 'text-align:left', text: 'No decisions yet' })));
      else dec.items.slice(0, 20).forEach(function (it) { items.appendChild(decRow(name, it)); });
      body.appendChild(h('div', { class: 'card botcard' },
        h('div', { class: 'top' }, h('i', { class: 'sdot', style: 'width:10px;height:10px;border-radius:5px;background:' + (x.paused ? '#ff9f0a' : x.status === 'running' ? '#00d35a' : 'rgba(235,235,245,.3)') }),
          h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'nm', style: 'color:' + COL[name], text: NAMES[name] }), h('div', { class: 'cnt', text: todayCount(name, st) })),
          h('div', { style: 'text-align:right' }, h('span', { class: 'switchwrap' }, sw), h('div', { class: 'note', style: 'font-size:11px;color:rgba(235,235,245,.6);margin-top:-6px', text: locked ? 'Locked while a position is open' : (SRC.mode === 'api' ? 'Pause switch' : 'Pause: via Telegram') }))),
        items,
        h('div', { class: 'foot' }, h('span', { class: 'note', style: 'align-self:center;color:rgba(235,235,245,.6);font-size:13px', text: 'Last ' + (dec ? dec.items.length : 0) + ' decisions' }), h('button', { class: 'linkbtn', text: 'Settings', onclick: function () { LS.setItem('dpd_open', name); go('account'); } }))));
    });
  }

  /* ================= ACTIVITY ================= */
  function skeleton(box, n, hgt) { clear(box); for (var i = 0; i < n; i++) box.appendChild(h('div', { class: 'sk', style: 'height:' + hgt + 'px;margin-bottom:12px;border-radius:18px' })); }
  function renderActivity() {
    var box = $('#actBody'); if (!D.activity) { if (!box.firstChild) skeleton(box, 6, 64); return; }
    var key = JSON.stringify([D.activity, D.more]); if (key === renderActivity.k) return; renderActivity.k = key; clear(box);
    var rows = D.activity.rows.concat(D.more.reduce(function (a, p) { return a.concat(p.rows); }, []));
    if (D.activity.night) box.appendChild(nightCard(D.activity.night, true));
    if (!rows.length) return box.appendChild(h('div', { class: 'empty-card', text: 'Nothing yet tonight' }));
    var list = h('div', { class: 'list' }); rows.forEach(function (r) { list.appendChild(actRow(r, true)); }); box.appendChild(list);
    var nb = D.more.length ? D.more[D.more.length - 1].next_before : D.activity.next_before;
    if (nb) box.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Load older', onclick: async function () {
      try { var j = await getJSON('before', nb); D.more.push(j); renderActivity(); } catch (e) { toast('Could not load older rows'); } } })));
    else box.appendChild(h('div', { class: 'hint', text: 'That is everything the desk has logged.' }));
    if (rows[0]) { LS.setItem('dpd_seen', String(rows[0].id)); seenAct = String(rows[0].id); }
  }

  /* ================= AUDIT ================= */
  function renderAudit() {
    var v = view(), box = $('#auditBody'), d = D.audit[v.arg];
    if (!d) { if (!box.firstChild || renderAudit.m !== v.arg) { renderAudit.m = v.arg; renderAudit.k = null; skeleton(box, 4, 110); } return; }
    var key = v.arg + JSON.stringify(d); if (key === renderAudit.k) return; renderAudit.k = key; clear(box);
    var first = !auditPlayed[v.arg]; auditPlayed[v.arg] = true;
    var grid = h('div', { class: 'disc-grid' }), discs = [];
    d.layers.forEach(function (l) {
      var cls = l.pass === true ? 'ok' : l.pass === false ? 'bad' : 'na';
      var disc = h('div', { class: 'disc ' + cls + (first && !reduce ? '' : ' done') },
        h('div', { class: 'c' }, h('i', { class: 'beam' }), h('span', { text: l.pass === true ? '✓' : l.pass === false ? '✕' : l.layer })),
        h('div', { class: 'nm', text: l.name }), h('div', { class: 'val', text: l.value || '' }));
      if (first && !reduce) { disc.classList.remove('ok', 'bad'); disc.dataset.cls = cls; disc.querySelector('.c span').textContent = l.layer; }
      discs.push(disc); grid.appendChild(disc);
    });
    var ok = d.layers.filter(function (l) { return l.pass === true; }).length;
    box.appendChild(h('div', { class: 'chead' }, h('h1', { text: d.symbol || (d.mint || '').slice(0, 6) }), h('span', { class: 'shield' + (ok === 8 ? '' : ' part'), text: '⛨ ' + ok + '/8' })));
    box.appendChild(h('div', { class: 'note', style: 'color:rgba(235,235,245,.6);margin-top:2px', text: d.name || '' }));
    box.appendChild(grid);
    var sc = d.score, soc = d.social;
    box.appendChild(h('div', { class: 'card', style: 'padding:0' },
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Score' }), h('span', { class: 'v', text: sc && sc.score != null ? Math.round(sc.score) + ' / 100 · ' + (sc.pass ? 'pass' : 'below the bar') : 'not scored' })),
      sc && sc.reason ? h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Why' }), h('span', { class: 'v', style: 'font-weight:500;font-size:13px', text: sc.reason })) : null,
      h('div', { class: 'kv' }, h('span', { class: 'k', text: soc === 'off' || soc == null ? 'Social: off' : 'Social +' + soc }), h('span', { class: 'v', text: soc === 'off' || soc == null ? '' : (sc && sc.social_pts != null ? '+' + sc.social_pts + ' pts' : '') }))));
    box.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Open coin', onclick: function () { go('coin/' + d.mint); } }), d.link ? h('a', { class: 'btn blue', href: d.link, target: '_blank', rel: 'noopener', text: 'Open on FOMO' }) : null));
    if (first && !reduce) playBeam(discs);
  }
  function playBeam(discs) {
    var i = 0; (function next() {
      if (i >= discs.length) return; var dsc = discs[i++];
      if (!dsc.isConnected) return;
      dsc.classList.add('scan');
      setTimeout(function () {
        dsc.classList.remove('scan'); dsc.classList.add('done', dsc.dataset.cls);
        var l = dsc.dataset.cls; dsc.querySelector('.c span').textContent = l === 'ok' ? '✓' : l === 'bad' ? '✕' : dsc.querySelector('.c span').textContent;
        next();
      }, 300);
    })();
  }

  /* ================= COIN ================= */
  var candles = new window.DeskCharts.Candles(h('canvas'));
  function renderCoin() {
    var v = view(), box = $('#coinBody'), d = D.coin[v.arg];
    if (!d) { if (!box.firstChild || renderCoin.m !== v.arg) { renderCoin.m = v.arg; renderCoin.k = null; skeleton(box, 4, 120); } return; }
    var key = v.arg + JSON.stringify(d); if (key === renderCoin.k) return; renderCoin.k = key; clear(box);
    var pos = d.position, sh = d.shield, full = sh && sh.split('/')[0] === sh.split('/')[1];
    box.appendChild(h('div', { class: 'chead' }, h('h1', { text: d.name || d.symbol || '?' }),
      sh ? h('span', { class: 'shield' + (full ? '' : ' part'), text: '⛨ ' + sh }) : null));
    box.appendChild(h('div', { class: 'note', style: 'color:rgba(235,235,245,.6);margin-top:2px', text: (d.symbol || '?') + ' · Solana · ' + age(d.age_min) }));
    box.appendChild(h('div', { class: 'cprice num', text: price(d.price) }));
    if (pos && pos.entry_price && d.price) { var ch = (d.price / pos.entry_price - 1) * 100; box.appendChild(h('div', { class: ch >= 0 ? 'pos' : 'neg', style: 'font-weight:600;margin-top:4px', text: (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(2) + '% since entry' })); }
    var cv = h('canvas'), wrap = h('div', { class: 'cchart' }, cv);
    if (!d.candles || !d.candles.length) wrap.appendChild(h('div', { class: 'chartbox overlay', style: 'position:absolute;inset:0;margin:0;height:auto;display:grid;place-items:center;color:rgba(235,235,245,.6)', text: 'No price points yet' }));
    box.appendChild(wrap);
    var cc = new window.DeskCharts.Candles(cv); requestAnimationFrame(function () { cc.set(d.candles, pos ? pos.stop_price : null); });
    box.appendChild(h('div', { class: 'card stats', style: 'padding:0' },
      h('div', null, h('div', { class: 'k', text: 'Market cap' }), h('div', { class: 'v', text: compact(d.mcap) })),
      h('div', null, h('div', { class: 'k', text: 'Liquidity' }), h('div', { class: 'v', text: compact(d.liquidity_usd) })),
      h('div', null, h('div', { class: 'k', text: 'Holders' }), h('div', { class: 'v', text: d.holders != null ? Number(d.holders).toLocaleString('en-US') : DASH }))));
    box.appendChild(pos ? h('div', { class: 'card', style: 'margin-top:12px;padding:0' },
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Your position' }), h('span', { class: 'v', text: usd(pos.size_usd) + ' in · Executor' })),
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Exit line' }), h('span', { class: 'v', style: 'color:#ff9f0a', text: price(pos.stop_price) })))
      : h('div', { class: 'empty-card', style: 'margin-top:12px;padding:18px', text: 'No position in ' + (d.symbol || 'this coin') }));
    box.appendChild(h('div', { class: 'btnrow' }, d.link ? h('a', { class: 'btn blue', href: d.link, target: '_blank', rel: 'noopener', text: 'Open on FOMO' }) : null,
      h('button', { class: 'btn red', disabled: !pos, text: 'Sell now', onclick: function () { sellSheet(d); } })));
    box.appendChild(h('div', { class: 'hint', text: pos ? (SRC.mode === 'api' ? 'Sell now queues an Executor sell on the desk.' : 'Sell now: plan B, confirmed through Telegram.') : 'Sell now needs an open position.' }));
    box.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'See the 8 checks', onclick: function () { go('audit/' + d.mint); } })));
  }
  function sellSheet(d) {
    var sel = 100, seg = h('div', { class: 'seg' });
    [25, 50, 100].forEach(function (p) { seg.appendChild(h('button', { text: p + '%', class: p === sel ? 'on' : '', onclick: function () { sel = p; $$('button', seg).forEach(function (b) { b.classList.toggle('on', b.textContent === p + '%'); }); } })); });
    sheet([h('h3', { text: 'Sell ' + (d.symbol || '') }), h('p', { text: SRC.mode === 'api' ? 'The Executor sells it and the desk verifies the fill.' : 'Plan B: confirming opens the Telegram command; this page cannot sell by itself.' }), seg,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn red', text: 'Confirm sell', onclick: function () { write('sell', { mint: d.mint, symbol: d.symbol, pct: sel }); } })),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Cancel', onclick: closeSheet }))]);
  }

  /* ================= ACCOUNT ================= */
  function humanKey(it) { return it.label || (it.key || '').split('.').slice(1).join('.').replace(/_/g, ' '); }
  var SETTINGS_HIDE = { 'desk.listen_host': 1, 'desk.listen_port': 1, 'desk.mode': 1 };
  var SETTING_NOTES = {
    'scanner.min_liquidity_usd': 'Kept at $40,000 (your decision; the v2 prompt default is $20,000).',
    'risk.stop_pct': "Brain sizes on this. On plan B the open-position stop is the lower of this and planb stop.",
    'risk.planb_stop_pct': 'Plan B click-run stop (default -22%). Effective stop is the lower of this and stop %.',
    'desk.rpc_url': "Use 'helius' — never paste an API key here.",
    'brain.max_ticket_usd': 'The prompt keeps this at $50 for LIVE nights 1–3, then you raise it.',
    'desk.withdraw_address': 'You set this yourself. The desk will not take a new address over Telegram.',
    'strategy.roi': 'Freqtrade-style ROI table: take a winner earlier as the trade ages. The profit lock and hard take-profit fire first when they apply; rows below the lock arm are unchanged.',
    'strategy.early_trail': 'Freqtrade-style trail that can arm once the offset is reached, before 2x. The profit lock fires first when it is tighter.',
    'strategy.lock': 'Once profit from entry reaches the arm %, sell 100% if it falls this many points off the peak (a +25% peak sells at +22%). Applies to open positions using the recorded peak. Fires before the early trail, 40% trail, 2x take-profit, and the ROI table.',
    'strategy.lock_arm_pct': 'Profit from entry that arms the lock. After this, a drop of lock drop pts from the peak sells 100%.',
    'strategy.lock_drop_pts': 'Profit points below the peak that trigger a 100% sell, once the lock is armed. Not a percent of the peak.',
    'strategy.hard_tp': 'Sell 100% as soon as profit from entry reaches hard tp %. Fires before every other take-profit; the stop still wins.',
    'strategy.hard_tp_pct': 'Sell 100% immediately when profit from entry reaches this %. Fires before every other take-profit; the stop still wins.'
  };

  function settingRow(it) {
    var lo = it.min, hi = it.max, val = it.value, edit = it.edit !== false;
    if (!it.note && SETTING_NOTES[it.key]) it.note = SETTING_NOTES[it.key];
    var unit = it.unit || '';
    if (!unit) {
      var tail = (it.key || '').split('.')[1] || '';
      if (tail.slice(-4) === '_usd' || tail === 'paper_start_cash') unit = '$';
      else if (tail.slice(-4) === '_pts') unit = 'pts';
      else if (tail.slice(-4) === '_pct' || tail === 'fee_pct') unit = '%';
      else if (tail.slice(-4) === '_min' || tail.slice(-9) === '_window_m' || tail.slice(-8) === '_pause_m') unit = 'min';
      else if (tail.slice(-2) === '_h') unit = 'h';
      else if (tail.slice(-2) === '_s') unit = 's';
      else if (tail === 'tp_x') unit = '×';
    }
    var row = h('div', { class: 'srow' + (edit ? '' : ' ro') });
    var k = h('div', { class: 'k' }, h('label', { text: humanKey(it), title: it.key }));
    var via = h('div', { class: 'via' }); via.hidden = true;
    function commit(v) { if (v === val || !edit) return; via.hidden = false; via.textContent = SRC.mode === 'api' ? 'Saving…' : 'Plan B: change it in Telegram, set ' + it.key + ' to ' + v; write('set', { key: it.key, value: v }); }
    function shown(x) { return unit === '$' ? '$' + x : (unit && unit !== '×' ? x + ' ' + unit : (unit === '×' ? x + '×' : String(x))); }
    if (typeof val === 'number' && lo != null && hi != null) {
      var cubic = hi > 10000, intg = Number.isInteger(lo) && Number.isInteger(hi) && Number.isInteger(val);
      var toPos = function (x) { var f = (x - lo) / (hi - lo); return Math.round((cubic ? Math.cbrt(f) : f) * 1000); };
      var toVal = function (p) { var f = p / 1000, x = lo + (cubic ? f * f * f : f) * (hi - lo); return intg ? Math.round(x) : Math.round(x * 100) / 100; };
      var num = h('input', { type: 'number', inputmode: 'decimal', value: val, min: lo, max: hi, step: intg ? 1 : 'any', 'aria-label': it.key, disabled: edit ? undefined : true });
      var rng = h('input', { type: 'range', min: 0, max: 1000, value: toPos(val), 'aria-label': it.key + ' slider', disabled: edit ? undefined : true });
      rng.addEventListener('input', function () { num.value = toVal(+rng.value); });
      rng.addEventListener('change', function () { commit(toVal(+rng.value)); });
      num.addEventListener('change', function () { var x = parseFloat(num.value); if (!isFinite(x) || x < lo || x > hi) { toast('Out of range. ' + humanKey(it) + ' must be ' + lo + ' to ' + hi + (unit ? ' ' + unit : '') + '.'); num.value = val; return; } rng.value = toPos(x); commit(x); });
      k.appendChild(num); row.appendChild(k); row.appendChild(rng);
      row.appendChild(h('div', { class: 'rng' }, h('span', { text: shown(lo) }), h('span', { text: shown(hi) })));
    } else if (it.allowed) {
      var sel = h('select', { 'aria-label': it.key, disabled: edit ? undefined : true }); it.allowed.forEach(function (o) { sel.appendChild(h('option', { value: o, text: o, selected: o === val })); });
      sel.addEventListener('change', function () { commit(sel.value); }); k.appendChild(sel); row.appendChild(k);
    } else if (typeof val === 'boolean') {
      var sw = h('button', { class: 'switch' + (val ? ' on' : ''), 'aria-label': it.key, disabled: edit ? undefined : true, onclick: function () { if (edit) commit(!val); } }); k.appendChild(sw); row.appendChild(k);
    } else if (it.format === 'HH:MM') {
      var tm = h('input', { type: 'time', value: val || '', 'aria-label': it.key, disabled: edit ? undefined : true });
      tm.addEventListener('change', function () { var v = tm.value; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) { toast('Use HH:MM, for example 22:00'); tm.value = val; return; } commit(v); });
      k.appendChild(tm); row.appendChild(k);
    } else {
      var tx = h('input', { type: 'text', value: val == null ? '' : String(val), 'aria-label': it.key, disabled: edit ? undefined : true }); tx.addEventListener('change', function () { commit(tx.value); }); k.appendChild(tx); row.appendChild(k);
    }
    if (it.note) row.appendChild(h('div', { class: 'snote', text: it.note }));
    row.appendChild(via); return row;
  }

  function moneyOrDash(n) {
    if (n == null || n === '') return DASH;
    var v = Number(n);
    if (!isFinite(v)) return DASH;
    if (Math.abs(v) < 0.005) return '$0.00';
    return (v > 0 ? '+' : v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
  }
  function nightCard(n, compact) {
    if (!n) return h('div', { class: 'empty-card', text: 'No night has closed yet. Stats appear after lock time (06:30).' });
    var wr = n.win_rate != null ? Math.round(n.win_rate * 100) + '% wins' : '0 trades';
    var head = h('div', { class: 'kv' }, h('span', { class: 'k', text: (n.started_at || '').slice(11, 16) + '–' + (n.ended_at || '').slice(11, 16) }), h('span', { class: 'v ' + (n.pnl_usd >= 0 ? 'pos' : 'neg'), text: moneyOrDash(n.pnl_usd) }));
    var body = [head, h('div', { class: 'note', style: 'margin-top:8px', text: n.compact || wr })];
    if (!compact && n.trades) {
      body.push(h('div', { class: 'note', text: 'Avg win ' + moneyOrDash(n.avg_win) + ' · avg loss ' + moneyOrDash(n.avg_loss) + ' · expectancy ' + moneyOrDash(n.expectancy) }));
      body.push(h('div', { class: 'note', text: 'Exits: take profit ' + (n.take_profit || 0) + ' · trail ' + (n.trail || 0) + ' · stop ' + (n.stop || 0) + ' · lock-time ' + (n.lock_time || 0) + (n.other ? ' · other ' + n.other : '') }));
      var feeShare = n.fee_share != null ? ' (' + Math.round(n.fee_share * 100) + '% of gross profit)' : ' (no gross profit)';
      body.push(h('div', { class: 'note', text: 'Fees $' + Number(n.fees_usd || 0).toFixed(2) + feeShare }));
      if (n.best_symbol) body.push(h('div', { class: 'note', text: 'Best ' + n.best_symbol + ' ' + moneyOrDash(n.best_pnl) + ' · worst ' + n.worst_symbol + ' ' + moneyOrDash(n.worst_pnl) }));
    }
    return h('div', { class: 'card', style: 'padding:14px 16px;margin-bottom:12px' }, body);
  }
  function nightSection(n) {
    return h('div', { class: 'group' }, h('h3', { text: 'Night' }), n ? nightCard(n, false) : h('div', { class: 'empty-card', text: 'No night has closed yet. Stats appear after lock time (06:30). They are a report only: nothing is changed automatically.' }));
  }

  function renderAccount() {
    var a = D.account, st = D.state, body = $('#accBody');
    if (!a || !st) { if (!body.firstChild) skeleton(body, 4, 120); return; }
    var key = JSON.stringify([a, st.mode, D.settings && D.settings.settings]); if (key === renderAccount.k) return;
    var openKeep = {}; $$('details.set', body).forEach(function (d) { openKeep[d.dataset.g] = d.open; });
    renderAccount.k = key; clear(body);
    var mode = st.mode;
    var seg = h('div', { class: 'seg' }, ['PAPER', 'LIVE'].map(function (m) { return h('button', { class: m === mode ? 'on' : '', text: m, onclick: function () { if (m === mode) return; if (m === 'PAPER') write('mode', { mode: 'PAPER' }); else liveSheet(); } }); }));
    body.appendChild(h('div', { class: 'group' }, h('h3', { text: 'Mode' }), h('div', { class: 'card' }, seg,
      h('p', { class: 'note', style: 'color:rgba(235,235,245,.6);font-size:13px;margin:10px 0 0', text: mode === 'PAPER' ? 'PAPER: no real money moves. LIVE needs you to type LIVE' + (SRC.mode === 'api' ? '.' : ' (via Telegram on plan B).') : 'LIVE is on.' }))));
    body.appendChild(h('div', { class: 'group' }, h('h3', { text: 'Cash' }), h('div', { class: 'list' },
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Cash' }), h('span', { class: 'v', text: usd(a.cash) })),
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Balance' }), h('span', { class: 'v', text: usd(a.balance) })),
      h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Paper start cash' }), h('span', { class: 'v', text: usd(a.paper_start_cash) + ' · change in settings, desk' })))));
    var fo = h('div', { class: 'list' },
      a.profile_url ? h('a', { class: 'fullrow', href: a.profile_url, target: '_blank', rel: 'noopener', style: 'color:#fff' }, h('span', null, 'Your FOMO profile', h('div', { class: 'sm', text: a.fomo_handle })), h('span', { class: 'r', text: 'Open ›' })) : h('div', { class: 'fullrow' }, h('span', { text: 'Your FOMO profile' }), h('span', { class: 'r', text: 'No handle set' })),
      h('button', { class: 'fullrow', onclick: function () { var u = a.signup_url; if (navigator.share) navigator.share({ url: u, title: 'FOMO' }).catch(function () { }); else copy(u, 'Link copied'); } }, h('span', null, 'Invite a friend', h('div', { class: 'sm', text: 'Share your sign-up link' })), h('span', { class: 'r', text: '↗' })));
    body.appendChild(nightSection(a.night));
    body.appendChild(h('div', { class: 'group' }, h('h3', { text: 'FOMO' }), fo));
    // copy picks
    var cp = h('div', { class: 'seg' }, ['Off', 'Every 24h', '12h', '6h'].map(function (t, i) { return h('button', { class: i === 0 ? 'on' : '', text: t, disabled: true }); }));
    body.appendChild(h('div', { class: 'group' }, h('h3', { text: 'Copy picks' }), h('div', { class: 'card' }, cp, h('p', { class: 'note', style: 'color:rgba(235,235,245,.6);font-size:13px;margin:10px 0 0', text: 'Not built yet (the picks chapter): nothing is scheduled, so this stays Off.' }))));
    // pushes
    var pushRows = [['Bought X · $N · Executor', ''], ['Sold X · +$N (+P%)', ''], ['Stopped X · -22% · -$N', ''], ['Unverified: X, check FOMO', ''], ['FOMO logged out', ''], ['Night over · $N', '']];
    body.appendChild(h('div', { class: 'group' }, h('h3', { text: 'Pushes' }), h('div', { class: 'list' },
      h('div', { class: 'fullrow' }, h('span', null, 'Plan B: Telegram only', h('div', { class: 'sm', text: 'Web push needs the home-screen app on plan A.' })), h('span', { class: 'r', text: a.telegram_commands === false ? 'Not connected' : 'Connected' })),
      h('div', { class: 'fullrow', role: 'button', tabindex: 0, onclick: function () { viaTelegram('Send test push', 'test'); } }, h('span', null, 'Send test push', h('div', { class: 'sm', text: 'Send test in Telegram: one message with the FOMO button' })), h('span', { class: 'r', text: '›' })),
      h('div', { class: 'fullrow', style: 'opacity:.45' }, h('span', null, 'Enable notifications', h('div', { class: 'sm', text: 'Home screen only; not used on plan B' })), h('span', { class: 'r', text: '–' })),
      h('div', { class: 'fullrow', style: 'opacity:.45' }, h('span', null, 'Watch in Grok Bot', h('div', { class: 'sm', text: 'Opens your own computer preview; not reachable from Pages' })), h('span', { class: 'r', text: '–' }))),
      h('div', { class: 'hint', text: 'Every push carries a FOMO button. Each says: ' + pushRows.map(function (r) { return '\u201c' + r[0] + '\u201d'; }).join(', ') + '.' })));
    // settings
    var sg = D.settings && D.settings.settings;
    var hold = h('div', { class: 'group', id: 'settingsGroup' }, h('h3', { text: 'Settings' }));
    if (!sg) hold.appendChild(h('div', { class: 'sk', style: 'height:120px;border-radius:18px' }));
    else {
      hold.appendChild(h('div', { class: 'hint', text: SRC.mode === 'api' ? 'Changes save straight to the desk and are logged.' : 'Plan B: this page is read-only. A change shows the exact Telegram command to send.' }));
      var order = ['scanner', 'analyst', 'social', 'brain', 'executor', 'risk', 'protect', 'desk'], want = LS.getItem('dpd_open');
      order.concat(Object.keys(sg).filter(function (g) { return order.indexOf(g) < 0; })).forEach(function (g) {
        if (!sg[g]) return;
        var d = h('details', { class: 'set', 'data-g': g, id: 'grp-' + g }, h('summary', null, g.charAt(0).toUpperCase() + g.slice(1), h('span', { text: sg[g].length + ' settings ›' })));
        if (openKeep[g] || want === g) d.open = true;
        var rows = sg[g].filter(function (it) { return !SETTINGS_HIDE[it.key]; });
        if (!rows.length) return;
        d.querySelector('summary span').textContent = rows.length + ' settings ›';
        rows.forEach(function (it) { d.appendChild(settingRow(it)); }); hold.appendChild(d);
      });
    }
    body.appendChild(hold);
    var log = (D.settings && D.settings.change_log) || [];
    var logBox = h('div', { class: 'group' }, h('h3', { text: 'Change log' }));
    if (!log.length) logBox.appendChild(h('div', { class: 'empty-card', text: 'No settings have been changed yet. Every change is recorded here.' }));
    else {
      var list = h('div', { class: 'list' });
      log.slice(0, 20).forEach(function (r) {
        list.appendChild(h('div', { class: 'fullrow' },
          h('span', null, r.key, h('div', { class: 'sm', text: String(r.old) + ' → ' + String(r.new) + ' · ' + (r.who || '') })),
          h('span', { class: 'r', text: fmtTime(r.ts) })));
      });
      logBox.appendChild(list);
    }
    body.appendChild(logBox);
    body.appendChild(h('div', { class: 'hint', style: 'margin-top:18px', text: 'Plan ' + (a.plan || 'B') + ' · static page, data every 15s · rpc ' + (a.rpc || DASH) }));
    if (LS.getItem('dpd_open')) { var el = $('#grp-' + LS.getItem('dpd_open')); LS.removeItem('dpd_open'); if (el) setTimeout(function () { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }, 30); }
  }
  function liveSheet() {
    var inp = h('input', { type: 'text', placeholder: 'Type LIVE', autocapitalize: 'characters', autocomplete: 'off', style: 'width:100%;min-height:48px;border-radius:12px;border:0;background:#000;padding:0 14px;font-size:17px' });
    var go2 = h('button', { class: 'btn red', disabled: true, text: 'Switch to LIVE', onclick: function () { write('mode', { mode: 'LIVE' }); } });
    inp.addEventListener('input', function () { go2.disabled = inp.value !== 'LIVE'; });
    sheet([h('h3', { text: 'Go LIVE?' }), h('p', { text: 'Real money. Type LIVE to continue. The desk can still refuse it (PAPER nights and sign-off come first).' }), inp, h('div', { class: 'btnrow' }, go2), h('div', { class: 'btnrow' }, h('button', { class: 'btn', text: 'Cancel', onclick: closeSheet }))]);
  }

  /* ================= SEARCH ================= */
  var base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  function runSearch() {
    var q = $('#q').value.trim().toLowerCase(), box = clear($('#qBody')), rows = (D.coins && D.coins.rows) || [];
    var hit = rows.filter(function (r) { return !q || (r.symbol || '').toLowerCase().indexOf(q) >= 0 || (r.name || '').toLowerCase().indexOf(q) >= 0 || r.mint.toLowerCase() === q || (q.length > 5 && r.mint.toLowerCase().indexOf(q) === 0); });
    if (!hit.length) { box.appendChild(h('div', { class: 'empty-card', text: base58.test($('#q').value.trim()) ? 'The desk has no data on that mint' : 'No coin matches' })); return; }
    var list = h('div', { class: 'list' });
    hit.slice(0, 30).forEach(function (r) { list.appendChild(h('div', { class: 'row', role: 'button', tabindex: 0, onclick: function () { closeSearch(); go('coin/' + r.mint); } }, h('div', { class: 'ic', text: (r.symbol || '?').charAt(0).toUpperCase() }), h('div', { class: 'mid' }, h('div', { class: 't', text: r.symbol }), h('div', { class: 's', text: r.name || r.mint.slice(0, 10) + '…' }), fomoLink(r.link)))); });
    box.appendChild(list);
  }
  function openSearch() { $('#search').classList.add('on'); $('#q').value = ''; runSearch(); setTimeout(function () { $('#q').focus(); }, 50); }
  function closeSearch() { $('#search').classList.remove('on'); }
  $('#searchBtn').addEventListener('click', openSearch); $('#qClose').addEventListener('click', closeSearch); $('#q').addEventListener('input', runSearch);

  /* ================= wiring ================= */
  function renderAll(force) {
    var v = view();
    $$('[data-paper]').forEach(function (e) { e.hidden = !isPaper(); });
    if (force) { renderHome.k = renderBots.k = renderActivity.k = renderAccount.k = null; }
    if (v.name === 'home') renderHome(); else if (D.state) renderHome();
    if (v.name === 'bots') renderBots();
    if (v.name === 'activity') renderActivity();
    if (v.name === 'account') renderAccount();
    if (v.name === 'audit') renderAudit();
    if (v.name === 'coin') renderCoin();
    if (!$('#home').classList.contains('is-loading')) { /* home ready */ }
  }
  $$('.tabbar button').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.tab); }); });
  $('#avatarBtn').addEventListener('click', function () { go('account'); });
  $('#titleBtn').addEventListener('click', function () { go('bots'); });
  $('#bellBtn').addEventListener('click', function () { go('activity'); });
  $('#seeAll').addEventListener('click', function () { go('activity'); });
  $$('[data-back]').forEach(function (b) { b.addEventListener('click', function () { var t = LS.getItem('dpd_tab') || 'home'; go(t); }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });

  show();
  setInterval(poll, POLL_S * 1000);
  setInterval(function () { if (D.screen && D.screen.has_frame) renderLive(); }, 1000);
})();

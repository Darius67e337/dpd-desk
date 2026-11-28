/* Charts by hand on <canvas>, devicePixelRatio aware. No library. */
(function () {
  'use strict';
  var GREEN = '#00d35a', RED = '#ff453a', BLUE = '#0a84ff', ORANGE = '#ff9f0a';
  var FONT = '-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fit(canvas) {
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  /* ---- balance line: green line, gradient under it, dashed start line, marks above the line ---- */
  function LineChart(canvas) {
    this.c = canvas; this.data = { points: [], marks: [], start: null }; this.prevLast = null; this.anim = 1; this.raf = 0;
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(canvas);
  }
  LineChart.prototype.set = function (d) {
    var pts = d.points || [], old = this.data.points || [];
    if (pts.length > old.length && old.length > 1 && !reduce) {
      this.prevLast = old[old.length - 1]; this.anim = 0; this.t0 = performance.now(); this.tick();
    }
    this.data = { points: pts, marks: d.marks || [], start: d.start };
    this.draw();
  };
  LineChart.prototype.tick = function () {
    var self = this; cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(function () {
      self.anim = Math.min(1, (performance.now() - self.t0) / 250); self.draw();
      if (self.anim < 1) self.tick();
    });
  };
  LineChart.prototype.draw = function () {
    var f = fit(this.c), ctx = f.ctx, W = f.w, H = f.h;
    ctx.clearRect(0, 0, W, H);
    var pts = (this.data.points || []).map(function (p) { return [new Date(p[0]).getTime(), +p[1]]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    this.geom = null;
    if (pts.length < 2) return;
    var padL = 16, padR = 16, padT = (this.data.marks || []).length ? 58 : 28, padB = 18;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0]; if (t1 === t0) t1 = t0 + 1;
    var lo = Infinity, hi = -Infinity, start = this.data.start;
    pts.forEach(function (p) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    // Scale to the data only. Including a far night-start line flattens small moves.
    if (!(hi > lo)) { var m = Math.max(Math.abs(hi) * 0.01, 0.05); lo -= m; hi += m; }
    else {
      var pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.0005, 0.02);
      lo -= pad; hi += pad;
    }
    var X = function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); };
    var xy = pts.map(function (p) { return [X(p[0]), Y(p[1])]; });
    if (this.anim < 1 && this.prevLast && xy.length > 2) {
      var a = xy[xy.length - 2], b = xy[xy.length - 1], e = ease(this.anim);
      xy[xy.length - 1] = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
    }
    // dashed start line
    if (start != null) {
      var yStart = Y(start);
      if (yStart >= 0 && yStart <= H) {
        ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(235,235,245,0.3)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, yStart); ctx.lineTo(W, yStart); ctx.stroke(); ctx.restore();
      }
    }
    // gradient under the line
    var g = ctx.createLinearGradient(0, padT, 0, H);
    g.addColorStop(0, 'rgba(0,211,90,0.28)'); g.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath(); ctx.moveTo(xy[0][0], H); xy.forEach(function (p) { ctx.lineTo(p[0], p[1]); });
    ctx.lineTo(xy[xy.length - 1][0], H); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    // the line
    ctx.beginPath(); xy.forEach(function (p, i) { i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
    ctx.strokeStyle = GREEN; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    var last = xy[xy.length - 1]; ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, 6.2832); ctx.fillStyle = GREEN; ctx.fill();
    this.geom = { X: X, Y: Y, pts: pts };
    this.marks(ctx, W, xy, pts, t0, t1, X, Y);
  };
  function markText(m) {
    var v = (m.value || '').split(' · ')[0];
    if (m.kind === 'bought') return { t: m.label || 'Bought', c: BLUE };
    if (m.kind === 'sold') return { t: v || m.label, c: GREEN };
    var pct = ((m.subtitle || '').match(/-\d+(?:\.\d+)?%/) || [''])[0];
    return { t: (pct ? pct + ' · ' : '') + (v || m.label), c: RED };
  }
  LineChart.prototype.marks = function (ctx, W, xy, pts, t0, t1, X, Y) {
    var marks = (this.data.marks || []).slice(-8), placed = [];
    ctx.font = '600 11px ' + FONT; ctx.textBaseline = 'middle';
    marks.forEach(function (m) {
      var t = new Date(m.ts).getTime(); if (!isFinite(t) || t < t0 || t > t1) return;
      var j = 0; for (var i = 0; i < pts.length; i++) if (Math.abs(pts[i][0] - t) < Math.abs(pts[j][0] - t)) j = i;
      var tx = markText(m), w = ctx.measureText(tx.t).width + 12, x = Math.min(Math.max(X(t), w / 2 + 4), W - w / 2 - 4);
      var row = 0, y;
      for (;;) {                       // a later mark moves up a row, never overlaps
        y = xy[j][1] - 16 - row * 20;
        var hit = placed.some(function (r) { return Math.abs(r.y - y) < 18 && Math.abs(r.x - x) < (r.w + w) / 2 + 2; });
        if (!hit || row > 4) break; row++;
      }
      placed.push({ x: x, y: y, w: w });
      ctx.strokeStyle = 'rgba(235,235,245,0.3)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(t), xy[j][1] - 4); ctx.lineTo(X(t), y + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(t), xy[j][1], 3, 0, 6.2832); ctx.fillStyle = tx.c; ctx.fill();
      ctx.fillStyle = '#1c1c1e'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - 9, w, 18, 9) : ctx.rect(x - w / 2, y - 9, w, 18); ctx.fill();
      ctx.fillStyle = tx.c; ctx.textAlign = 'center'; ctx.fillText(tx.t, x, y + 0.5);
    });
  };

  /* ---- 1-minute candles with the orange dashed exit line ---- */
  function Candles(canvas) {
    this.c = canvas; this.d = null; var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.draw(); }).observe(canvas);
  }
  Candles.prototype.set = function (candles, exit) { this.d = { candles: candles || [], exit: exit }; this.draw(); };
  Candles.prototype.draw = function () {
    var f = fit(this.c), ctx = f.ctx, W = f.w, H = f.h; ctx.clearRect(0, 0, W, H);
    var d = this.d; if (!d || d.candles.length < 1) return;
    var cs = d.candles.slice(-90), lo = Infinity, hi = -Infinity;
    cs.forEach(function (c) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); });
    if (d.exit) { lo = Math.min(lo, d.exit); hi = Math.max(hi, d.exit); }
    if (hi === lo) { lo *= 0.99; hi *= 1.01; }
    var s = (hi - lo) * 0.1; lo -= s; hi += s;
    var padL = 16, padR = 56, padT = 14, padB = 16, n = cs.length;
    var step = (W - padL - padR) / Math.max(n, 8), bw = Math.max(3, Math.min(10, step * 0.62));
    var Y = function (v) { return padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB); };
    cs.forEach(function (c, i) {
      var x = padL + step * (i + 0.5), up = c.close >= c.open, col = up ? GREEN : RED;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, Y(c.high)); ctx.lineTo(x, Y(c.low)); ctx.stroke();
      var y1 = Y(Math.max(c.open, c.close)), y2 = Y(Math.min(c.open, c.close));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(2, y2 - y1));
    });
    var lastC = cs[cs.length - 1].close; ctx.font = '600 11px ' + FONT; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (d.exit) {
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, Y(d.exit)); ctx.lineTo(W - padR + 4, Y(d.exit)); ctx.stroke(); ctx.restore();
      ctx.fillStyle = ORANGE; ctx.fillText('exit', W - padR + 8, Y(d.exit));
    }
    ctx.fillStyle = 'rgba(235,235,245,0.6)'; ctx.fillText('last', W - padR + 8, Y(lastC));
  };

  window.DeskCharts = { LineChart: LineChart, Candles: Candles };
})();

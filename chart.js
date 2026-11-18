/* Hand-drawn <canvas> charts. No chart library. Full candles come later. */
(function () {
  function drawPlaceholder(canvas) {
    if (!canvas || !canvas.getContext) return;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 320;
    var cssH = canvas.clientHeight || 120;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.beginPath();
    ctx.strokeStyle = "#3a3a3c";
    ctx.lineWidth = 1;
    var y = cssH / 2;
    ctx.moveTo(0, y);
    for (var x = 0; x < cssW; x += 8) {
      var yy = y + Math.sin(x / 28) * 16;
      ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  window.DeskChart = { drawPlaceholder: drawPlaceholder };
})();

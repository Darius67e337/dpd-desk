/* Plan B (GitHub Pages): read #d={DATA_PATH} once, keep it in localStorage,
   and poll d/{DATA_PATH}/*.json with paths relative to this page.
   No tokens, no secrets in this file. */
(function () {
  var statusEl = document.getElementById("status");
  var dataPath = null;

  function setStatus(ok, text) {
    statusEl.textContent = text;
    statusEl.className = "status " + (ok ? "ok" : "bad");
  }

  function readDataPath() {
    var hash = (location.hash || "").replace(/^#/, "");
    var parts = hash.split("&");
    var i, kv, k, v;
    for (i = 0; i < parts.length; i++) {
      kv = parts[i].split("=");
      k = decodeURIComponent(kv[0] || "");
      v = decodeURIComponent(kv.slice(1).join("=") || "");
      if (k === "d" && v.length >= 32) {
        try { localStorage.setItem("desk_data_path", v); } catch (e) {}
        return v;
      }
    }
    try { return localStorage.getItem("desk_data_path"); } catch (e) { return null; }
  }

  function checkHealth() {
    return fetch("health.json", { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        return !!(res.ok && res.j && res.j.ok);
      })
      .catch(function () { return false; });
  }

  function checkState() {
    if (!dataPath) return Promise.resolve(false);
    var url = "d/" + encodeURIComponent(dataPath) + "/state.json";
    return fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        return !!(res.ok && res.j && res.j.ok);
      })
      .catch(function () { return false; });
  }

  function tick() {
    checkHealth().then(function (okH) {
      if (okH) {
        setStatus(true, "Desk online · PAPER");
        return;
      }
      return checkState().then(function (okS) {
        if (okS) setStatus(true, "Desk online · PAPER");
        else setStatus(false, "Desk offline · retrying");
      });
    });
  }

  dataPath = readDataPath();
  tick();
  setInterval(tick, 15000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
  if (window.DeskChart) {
    window.DeskChart.drawPlaceholder(document.getElementById("chart"));
  }
})();

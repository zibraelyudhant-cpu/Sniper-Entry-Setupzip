// bridge.js = TAMBAHAN program ini (bukan kode referensi). Menyambungkan halaman Market Structure asli ke app:
//  1) section #tab-msa dibuat aktif (di program asli diaktifkan oleh menu tab)
//  2) openMoment (tidak disertakan program asli) -> buka chart TradingView koin & TF itu
//  3) di WebView HP: copyText -> clipboard HP; unduh PNG -> gambar dibuka layar penuh di browser HP (tekan lama untuk simpan)
//  4) daftar koin untuk input (datalist#symbols) dari gudang candle server
//  5) progres gudang candle (unduh / perbarui) di atas menu
(function () {
  const sec = document.getElementById("tab-msa");
  if (sec) sec.classList.add("active");
  const RN = window.ReactNativeWebView;
  const post = (m) => RN && RN.postMessage(JSON.stringify(m));
  const openUrl = (url) => { if (RN) post({ type: "open-url", url }); else window.open(url, "_blank", "noopener"); };

  window.openMoment = async function (symbol, tf, time, marks, text) {
    const m = IT_TF_MIN[tf] || 15;
    const iv = m >= 1440 ? "D" : String(m);
    toast(`${text || ""} — dibuka di TradingView; geser chart ke ${fmtTime(time)}.`);
    openUrl(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent("BINANCE:" + symbol + ".P")}&interval=${iv}`);
  };

  if (RN) {
    copyText = async function (text) { post({ type: "copy", text: String(text) }); };   // eslint-disable-line no-global-assign
    const click0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const href = this.href || "";
      if (this.download && href.startsWith("blob:")) {
        const name = this.download;
        (async () => {
          try {
            const blob = await (await fetch(href)).blob();
            const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
            const res = await fetch("/api/msa/png", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl, name }) });
            const j = await res.json();
            if (!res.ok) throw new Error(j.detail || res.statusText);
            toast("Gambar dibuka layar penuh — tekan lama gambarnya untuk simpan.");
            openUrl(location.origin + j.url);
          } catch (ex) { toast("Gagal membuka gambar: " + ex.message); }
        })();
        return;
      }
      return click0.call(this);
    };
  }

  fetch("/api/msa/symbols").then((r) => r.json()).then((j) => {
    const dl = document.getElementById("symbols");
    if (dl && j.symbols) dl.innerHTML = j.symbols.map((s) => `<option value="${s}">`).join("");
  }).catch(() => {});

  const box = document.getElementById("msaStore"), txt = document.getElementById("msaStoreTxt"), bar = document.getElementById("msaStoreBar");
  async function storeTick() {
    try {
      const s = await (await fetch("/api/msa/store/status")).json();
      const busy = s.phase === "download" || s.phase === "update" || s.phase === "rebuild";
      const pct = s.pairsTotal ? Math.round((s.pairsDone / s.pairsTotal) * 100) : 0;
      const ph = { download: "Mengunduh riwayat candle", update: "Memperbarui riwayat candle", rebuild: "Menyiapkan file riwayat dari database", error: "Gudang candle error", idle: "Gudang candle siap" }[s.phase] || s.phase;
      txt.innerHTML = `<b>${ph}</b>${busy ? ` · ${s.pairsDone}/${s.pairsTotal} (${pct}%)${s.current ? " · " + s.current : ""}` : ""} · ${s.coins || 0} koin · ${(s.candlesInDb || 0).toLocaleString("id-ID")} candle · ${s.npzFiles || 0} file` +
        `${s.dbBytes ? ` · DB ${(s.dbBytes / 1048576).toFixed(0)} MB` : ""}${s.pythonReady ? "" : " · ⏳ analisa belum siap"}${s.lastError ? `<br><span class="neg">⚠️ ${s.lastError}</span>` : ""}`;
      bar.style.width = (busy ? pct : 100) + "%";
      box.classList.toggle("hidden", !busy && !s.lastError && s.pythonReady && s.npzFiles > 0);
      setTimeout(storeTick, busy ? 4000 : 30000);
    } catch { setTimeout(storeTick, 15000); }
  }
  storeTick();
})();

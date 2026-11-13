// Potongan app.js: menu Market Structure (Screener + Cek entry posisi). Fungsi pembantu umum ($, esc, toast,
// copyText, pxTxt, fmtTime, openMoment, store, IT_TF_MIN) ada di program asli dan tidak disertakan.

// ------------------------------------------------------------------ 🔎 screener market structure (1 koin)
const MSC_S = { res: null, plan: 0 };
// jalankan Screener Market Structure 1 koin di latar belakang -> hasil (dipakai juga oleh menu Screener)
async function mscFetch(body, onProg) {
  const r = await fetch("/api/msa/screen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.detail || r.statusText);
  let st;
  for (;;) {
    st = await (await fetch(`/api/screener/job/${j.id}`)).json();
    if (st.status !== "running") break;
    if (st.total && onProg) onProg(st);
    await new Promise((ok) => setTimeout(ok, 400));
  }
  if (st.status === "error") throw new Error(st.error);
  if (!st.result) throw new Error(`scan berhenti tanpa hasil (status: ${st.status})`);
  return st.result;
}
async function runMsc() {
  const body = { symbol: ($("mscSym").value || "").trim().toUpperCase(), tf: $("mscTf").value, swing: $("mscSwing").value, scope: $("mscScope").value, htf: $("mscHtf").value };
  if (!body.symbol) return toast("Isi koin dulu, mis. BTCUSDT");
  store.set("mscForm", body);
  $("mscRun").disabled = true; $("mscStatus").innerHTML = `Membaca struktur ${esc(body.symbol)} &amp; mencari pola di riwayat<span class="dots"></span>`;
  $("mscEmpty").classList.remove("hidden"); $("mscOut").classList.add("hidden");
  $("mscEmpty").innerHTML = `<h3>⏳ Scan ${esc(body.symbol)} ${esc(body.tf.toUpperCase())}<span class="dots"></span></h3><p class="hint">Gambar visual entry muncul di sini sebentar lagi.</p>`;
  try {
    MSC_S.res = await mscFetch(body, (st) => { $("mscStatus").innerHTML = `Mencari pola di riwayat ${st.done}/${st.total} koin<span class="dots"></span>`; });
    MSC_S.plan = 0;
    try { localStorage.setItem("mscLast", JSON.stringify(MSC_S.res)); } catch { /* penyimpanan penuh / diblokir: abaikan */ }
    const R = MSC_S.res;
    $("mscStatus").textContent = `Selesai ${new Date().toLocaleTimeString()} · ${R.elapsed} dtk · struktur dari ${R.source === "binance" ? "Binance (live)" : "data lokal"}`;
    renderMsc();
    $("mscOut").scrollIntoView({ behavior: "smooth" });
  } catch (ex) {
    $("mscStatus").textContent = "⚠️ " + ex.message;
    $("mscEmpty").classList.remove("hidden"); $("mscOut").classList.add("hidden");
    $("mscEmpty").innerHTML = `<h3>⚠️ Scan gagal</h3><p>${esc(ex.message)}</p><p class="hint">Kirim tulisan ini kalau bingung.</p>`;
    console.error(ex);
  } finally { $("mscRun").disabled = false; }
}
// ---- ringkasan singkat DI DALAM gambar kartu (supaya cukup lihat 1 gambar)
const _p0 = (v) => (v == null ? "—" : `${v.toFixed(0)}%`), _r2 = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
function predLine(R) {
  const P = R.pred;
  if (!P || !(P.up + P.down)) return null;
  const down = P.pct_down > P.pct_up, pct = down ? P.pct_down : P.pct_up, bars = down ? P.bars_down : P.bars_up;
  let t = `${down ? "📉 Turun" : "📈 Naik"} 2 ATR duluan ${_p0(pct)}${bars ? ` (±${bars} candle)` : ""}`, c = "#c9d1db";
  if (P.base_up != null) {
    const nb = down ? P.base_down : P.base_up, ed = P.edge;
    t += ` · normal ${_p0(nb)} → keunggulan ${ed >= 0 ? "+" : ""}${ed.toFixed(0)}% ${ed > 0 ? (P.edge_txt === "meyakinkan" ? "meyakinkan ✓" : P.edge_txt === "lemah" ? "lemah" : "bisa kebetulan ⚠") : "tidak unggul ⚠"}`;
    c = ed > 0 && P.edge_txt === "meyakinkan" ? "#36e3a1" : ed > 0 && P.edge_txt === "lemah" ? "#f5c451" : "#ff8a8a";
  }
  return { t, c, b: true };
}
function htfLine(R, posDir) {
  const F = R.filters;
  if (!F) return null;
  const P = R.pred, down = P && P.pct_down > P.pct_up;
  const parts = [];
  if (F.htf) {
    const tn = F.htf_now, ref = posDir != null ? (posDir === 0 ? "naik" : "turun") : down ? "turun" : "naik";
    parts.push(`🧭 Tren ${F.htf.toUpperCase()}: ${tn || "belum jelas"}${tn === "naik" || tn === "turun" ? (tn === ref ? ` (searah ${posDir != null ? "posisi kamu" : "prediksi"} ✓)` : ` (melawan ${posDir != null ? "posisi kamu" : "prediksi"} ⚠)`) : ""}`);
  } else parts.push("🧭 Tren TF besar: mati");
  const m = (F.modes || []).find((x) => x.name === F.mode);
  parts.push(`kejadian dipakai: ${F.mode} (${R.n_occ}${F.n_all ? ` dari ${F.n_all}` : ""})${m && m.test_hit != null ? ` · tebakan benar di data uji ${_p0(m.test_hit)}` : ""}`);
  return { t: parts.join(" · "), c: "#c9d1db" };
}
function mscInsights(R, B) {
  const L = [predLine(R), htfLine(R, null)];
  const live = B && (B.usable != null ? B.usable : B.live !== false);
  if (B && live) {
    const mk = B.entry === "market";
    L.push({ t: `🎯 ${B.dir === 0 ? "BUY" : "SELL"} ${mk ? "MARKET" : "LIMIT"} ${pxTxt(B.price_entry)} · SL ${pxTxt(B.price_sl)} · TP ${pxTxt(B.price_tp)} (1:${B.rr}) · ${mk ? "masuk sekarang" : `limit terisi ${_p0(B.fill_pct)}`} · WR ${_p0(B.wr)} · ${_r2(B.exp_sig != null ? B.exp_sig : B.exp_r)}/sinyal ${B.proven ? "· terbukti di data uji ✓" : "· belum terbukti ⚠"}`, c: "#e6ebf2", b: true });
  } else if (B) L.push({ t: `⚠ Setup ini tidak layak (${B.why_not || B.status}) — jangan dipasang.`, c: "#ff8a8a", b: true });
  else if (R.last_plan) L.push({ t: `⏳ Jangan entry dulu — belum ada setup yang sering terisi (≥ 70%) DAN tidak rugi (setup terbaik: ${R.last_plan.why_not || R.last_plan.status}). Tunggu pola baru lalu Scan lagi.`, c: "#f5c451", b: true });
  else L.push({ t: "⚠ Tidak ada aturan entry RR ≥ 1:3 yang untung untuk pola ini — jangan dipaksakan.", c: "#ff8a8a", b: true });
  const P = R.pred || {}, strong = P.edge > 0 && P.edge_txt === "meyakinkan";
  L.push(B && live && strong && B.proven ? { t: "✅ Kesimpulan: pola punya keunggulan nyata & setup terbukti — boleh diikuti, SL wajib dipasang.", c: "#36e3a1" }
    : B && live && strong ? { t: "🟡 Kesimpulan: arah pola meyakinkan, tapi setup belum terbukti di data uji — kecilkan risiko.", c: "#f5c451" }
    : B && live ? { t: "🟡 Kesimpulan: keunggulan arah pola lemah — kalau ikut, kecilkan risiko.", c: "#f5c451" }
    : { t: "⏸ Kesimpulan: belum ada yang perlu dipasang sekarang.", c: "#8b96a5" });
  return L.filter(Boolean);
}
function mscFull(R, B) { return { ...R, insights: mscInsights(R, B || null) }; }
function pcInsights(R) {
  const S = R.stats || {}, tf = R.tf, L = [];
  L.push(R.filled
    ? { t: `📍 Dari sekarang: TP duluan ${_p0(S.wr)} / SL duluan ${_p0(S.sl_pct)} · biasanya selesai ${pcDur(S.exit_bars, tf)} · hasil ${_r2(S.exp_sig)}/sinyal (${R.n_occ} kejadian)`, c: (S.wr || 0) >= (S.sl_pct || 0) ? "#36e3a1" : "#ff8a8a", b: true }
    : { t: `⏳ Limit kamu terisi ${_p0(S.fill_pct)} kejadian, biasanya ${pcDur(S.fill_bars, tf)} · kalau terisi: TP duluan ${_p0(S.wr)} / SL duluan ${_p0(S.sl_pct)} · hasil ${_r2(S.exp_sig)}/sinyal`, c: (S.exp_sig || 0) > 0 ? "#36e3a1" : "#ff8a8a", b: true });
  if (!R.filled && S.fill_pct != null && S.fill_pct < 70)
    L.push({ t: `⚠ Limit kamu JARANG terisi (${_p0(S.fill_pct)} < 70%) — sering harga pergi tanpa kamu. Geser entry lebih dekat ke harga sekarang.`, c: "#ff8a8a", b: true });
  const pl = predLine(R);
  if (pl) L.push(pl);
  L.push(htfLine(R, R.dir));
  const nm = { entry: "Entry", sl: "SL", tp: "TP" };
  const why = (x) => x.kind === "sl" && x.shift_atr > 0 ? `${_p0(S.wick_pct)} trade kena wick lalu tetap ke TP`
    : x.kind === "tp" ? (x.shift_atr > 0 ? "harga sering lanjut melewati TP kamu" : "TP kamu sering tidak tercapai")
    : x.kind === "entry" ? `terisi ${_p0(S.fill_pct)}→${_p0(x.stats.fill_pct)}` : "harga jarang balik sejauh SL kamu";
  const sg = (R.suggestions || []).map((x) => `${nm[x.kind]} → ${pxTxt(x.price)} (${why(x)}; ${_r2(S.exp_sig)}→${_r2(x.stats.exp_sig)}${x.proven ? " ✓" : " ⚠"})`);
  if (sg.length) sg.forEach((t, i) => L.push({ t: `${i ? "   " : "💡 Saran: "}${t}`, c: "#a5b4fc", b: true }));
  else L.push({ t: "✅ Level kamu sudah termasuk yang terbaik untuk pola ini (tidak ada geseran yang lebih baik).", c: "#36e3a1" });
  const good = (S.exp_sig || 0) > 0 && R.test && (R.test.exp_sig || 0) > 0;
  L.push(good ? { t: "✅ Kesimpulan: entry kamu rata-rata untung di riwayat & di data uji — layak dipertahankan.", c: "#36e3a1" }
    : (S.exp_sig || 0) > 0 ? { t: "🟡 Kesimpulan: untung di riwayat tapi tidak di data uji terbaru — hati-hati, pertimbangkan saran.", c: "#f5c451" }
    : { t: "⚠ Kesimpulan: entry ini rata-rata rugi untuk pola ini — pakai saran atau lewati.", c: "#ff8a8a" });
  return L.filter(Boolean);
}
// 🎯 seberapa akurat: pembanding (arah normal), filter tren TF besar & leg mirip — dinilai di 30% kejadian terakhir
function accHtml(R) {
  const F = R.filters, P = R.pred;
  if (!F || !P || P.base_up == null) return "";
  const pc = (v) => (v == null ? "—" : `${v.toFixed(0)}%`), down = P.pct_down > P.pct_up;
  const nb = down ? P.base_down : P.base_up, ed = P.edge;
  const col = ed > 0 && P.edge_txt === "meyakinkan" ? "pos" : ed > 0 ? "" : "neg";
  return `<h4>🎯 Seberapa akurat prediksi ini?</h4>
    <ul><li>Setelah pola ini harga <b>${down ? "turun" : "naik"} 2 ATR duluan ${pc(down ? P.pct_down : P.pct_up)}</b>. Normalnya (setelah swing apa pun di koin &amp; TF yang sama)
      <b>${pc(nb)}</b> → keunggulan pola <b class="${col}">${ed >= 0 ? "+" : ""}${ed.toFixed(0)}%</b>
      (${ed > 0 ? (P.edge_txt === "meyakinkan" ? "meyakinkan ✅" : P.edge_txt === "lemah" ? "lemah — bisa jadi sebagian kebetulan" : "bisa kebetulan ⚠️") : "tidak lebih baik dari normal ⚠️"}).</li>
      <li>Tren ${F.htf ? `<b>${F.htf.toUpperCase()}</b> sekarang: <b>${esc(F.htf_now || "belum jelas")}</b>` : "TF besar: <b>mati</b>"}${F.legs_now ? ` · ukuran leg pola sekarang (ATR): ${F.legs_now.map((x) => (x > 0 ? "+" : "") + x).join(", ")}` : ""}.</li>
      <li>Kejadian yang dipakai: <b>${esc(F.mode)}</b> (${R.n_occ} dari ${F.n_all || R.n_occ}). Penyaring hanya dipakai kalau tebakan arah di 30% data terakhir lebih tepat ≥ 2%.</li></ul>
    <div class="scroll"><table class="tbl"><tr><th>Kejadian</th><th class="num">Jumlah</th><th class="num">Naik / turun duluan</th><th class="num">Tebakan benar di data uji</th><th></th></tr>` +
    F.modes.map((m) => `<tr${m.name === F.mode ? ' class="wh-best"' : ""}><td>${esc(m.name)}</td><td class="num">${m.n}</td><td class="num">${pc(m.pct_up)} / ${pc(m.pct_down)}</td>
      <td class="num">${m.test_hit == null ? "—" : `${pc(m.test_hit)} <small>(${m.n_test})</small>`}</td><td>${m.name === F.mode ? "✅ dipakai" : m.eligible ? "" : "<small class='hint'>sampel kurang</small>"}</td></tr>`).join("") + `</table></div>`;
}
function mscNorm(R) {                                               // hasil lama (≤ v3.84): setup yang sudah lewat jangan jadi sinyal utama
  if (R && R.best && (R.best.live === false || R.best.usable === false)) { R.last_plan = R.best; R.best = null; }
  return R;
}
function mscPlan() {
  const R = MSC_S.res;
  if (!R) return null;
  if (MSC_S.plan === 0) return R.best || null;
  return R.plans[MSC_S.plan - 1] || null;
}
function renderMsc() {
  const R = mscNorm(MSC_S.res), box = $("mscOut");
  box.classList.remove("hidden"); $("mscEmpty").classList.add("hidden");
  if (!R.pattern || !R.n_occ) {
    box.innerHTML = `<div class="card evalcard"><h3>🔎 ${esc(R.symbol)} · ${esc(R.tf.toUpperCase())}</h3><p>Pola sekarang ${esc((R.pattern || []).join(" › "))} tidak ditemukan di riwayat. Coba ukuran swing lain atau riwayat "Semua koin".</p></div>`;
    return;
  }
  const B = mscPlan(), P = R.pred, pc = (x) => `${x.toFixed(0)}%`, sg = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
  const dirW = (d) => (d === 0 ? "🟢 LONG" : "🔴 SHORT");
  const tabs = [`<button class="mini${MSC_S.plan === 0 ? " on" : ""}" data-mscp="0">⭐ Terbaik</button>`]
    .concat(R.plans.map((p, i) => `<button class="mini${MSC_S.plan === i + 1 ? " on" : ""}" data-mscp="${i + 1}">${dirW(p.dir)} ${sg(p.exp_sig != null ? p.exp_sig : p.exp_r)}/sinyal${p.usable === false ? " ⚠" : ""}</button>`)).join(" ");
  const nx = (P.next || []).map((x) => `<span class="chip">${esc(x.label)} <b>${pc(x.pct)}</b> <small>(${x.n})</small></span>`).join(" ");
  const ex = R.examples || [];
  box.innerHTML = `<div class="msc-card">${MSC.card(mscFull(R, B), B, false)}</div>
    <div class="msc-btns">${tabs}<span style="flex:1"></span>
      <button class="mini" id="mscCopy">📋 Salin sinyal</button><button class="mini" id="mscDl">⬇ Unduh gambar</button><button class="mini" id="mscReplay">▶ Putar ulang animasi</button></div>
    <details class="card evalcard msc-more"><summary><b>📄 Detail lengkap</b> <small class="hint">angka &amp; tabel di balik gambar — tidak wajib dibaca</small></summary>${R.note ? `<p class="hint">⚠️ ${esc(R.note)}</p>` : ""}
    ${!R.best && R.last_plan && MSC_S.plan === 0 ? `<p class="hint">⏳ <b>Jangan entry dulu.</b> Sinyal hanya diberikan kalau entry-nya di riwayat terisi ≥ 70% <b>dan</b> rata-rata untung (juga di data uji). Setup terbaik sekarang: ${esc(R.last_plan.why_not || R.last_plan.status)}.
      Entry dihitung saat swing terakhir terkonfirmasi, jadi tunggu swing / pola baru lalu klik Scan lagi. Setup lama tetap bisa dilihat lewat tombol LONG / SHORT di atas.</p>` : ""}
    ${!R.best && !R.last_plan ? `<p class="hint">⚠️ Tidak ada aturan entry RR ≥ 1:3 yang hasil backtest-nya untung untuk pola ini, jadi <b>tidak ada sinyal</b>. Prediksi arah tetap ditampilkan sebagai gambaran.</p>` : ""}
    ${B && !B.proven ? `<p class="hint">⚠️ Aturan ini <b>belum terbukti</b>: di 30% data terakhir hasilnya tidak untung / kejadiannya terlalu sedikit.</p>` : ""}
    <h4>📊 Biasanya sesudah pola ${R.pattern.map(esc).join(" › ")}</h4>
    <div class="chips"><span class="chip">🔢 <b>${R.n_occ}</b> kejadian · ${R.n_coins} koin</span>
      <span class="chip">▲ naik ${P.move_atr || 2} ATR duluan <b>${pc(P.pct_up)}</b>${P.bars_up ? ` · ±${P.bars_up} candle` : ""}</span>
      <span class="chip">▼ turun ${P.move_atr || 2} ATR duluan <b>${pc(P.pct_down)}</b>${P.bars_down ? ` · ±${P.bars_down} candle` : ""}</span>
      ${P.unclear ? `<span class="chip">↔ tidak jelas <b>${P.unclear}</b></span>` : ""}</div>
    <p class="hint">Swing berikutnya yang terbentuk: ${nx || "—"}</p>
    ${accHtml(R)}
    <details><summary><b>🧪 Semua aturan yang diuji</b> <small class="hint">${R.rules.length} aturan dengan ≥ 15 trade · diurutkan dari R per sinyal (R per trade × peluang terisi)</small></summary>
      <div class="scroll" style="max-height:360px"><table class="tbl"><tr><th>Arah</th><th>Entry</th><th>SL</th><th class="num">RR</th><th class="num">Trade</th><th class="num">Terisi</th><th class="num">WR</th><th class="num">R/trade</th><th class="num">R/sinyal</th><th class="num">Data uji</th><th></th></tr>` +
      R.rules.map((r) => `<tr><td>${dirW(r.dir)}</td><td>${esc(r.entry_txt)}</td><td>${esc(r.sl_txt)}</td><td class="num">1:${r.rr}</td><td class="num">${r.n}</td>
        <td class="num">${pc(r.fill_pct)}</td><td class="num">${pc(r.wr)}</td><td class="num ${r.exp_r >= 0 ? "pos" : "neg"}">${sg(r.exp_r)}</td>
        <td class="num ${(r.exp_sig || 0) >= 0 ? "pos" : "neg"}"><b>${r.exp_sig != null ? sg(r.exp_sig) : "—"}</b></td>
        <td class="num">${r.n_test ? `${sg(r.exp_test)} <small>(${r.n_test})</small>` : "—"}</td><td>${r.proven ? "✅" : ""}</td></tr>`).join("") + `</table></div></details>
    <details><summary><b>🔍 Contoh kejadian</b> <small class="hint">${ex.length} kejadian pola yang sama · klik untuk buka di Manual Replay</small></summary>
      <div class="scroll" style="max-height:360px"><table class="tbl"><tr><th>Waktu (UTC)</th><th>Koin</th><th>Gerak duluan</th><th>Pola</th></tr>` +
      ex.map((e, i) => `<tr data-mscx="${i}" title="Buka di chart"><td>${fmtTime(e.time).slice(0, 16)}</td><td>${esc(e.symbol)}</td>
        <td class="${e.first_move > 0 ? "pos" : e.first_move < 0 ? "neg" : ""}">${e.first_move > 0 ? "▲ naik" : e.first_move < 0 ? "▼ turun" : "↔ tidak jelas"}</td>
        <td>${e.swings.map((x) => esc(x.label || "?")).join(" › ")}</td></tr>`).join("") + `</table></div></details></details>`;
}
{
  const tfs = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];
  $("mscTf").innerHTML = tfs.map((t) => `<option value="${t}">${t.toUpperCase()}</option>`).join("");
  const f = store.get("mscForm", null) || {};
  $("mscTf").value = f.tf || "15m"; $("mscSwing").value = f.swing || "kecil"; $("mscScope").value = f.scope || "all"; $("mscHtf").value = f.htf || "auto";
  $("mscSym").value = f.symbol || $("symbol").value || "BTCUSDT";
  $("mscRun").onclick = runMsc;
  window.addEventListener("error", (e) => {                         // error tak terduga: tampilkan, jangan diam-diam
    if ($("tab-msa").classList.contains("active")) $("mscStatus").textContent = `⚠️ Error di halaman: ${e.message}`;
  });
  try {                                                              // tampilkan hasil scan terakhir (kalau ada)
    const last = JSON.parse(localStorage.getItem("mscLast") || "null");
    if (last && last.symbol) {
      MSC_S.res = last; renderMsc();
      $("mscStatus").textContent = `Hasil scan terakhir: ${last.symbol} ${last.tf.toUpperCase()} · candle ${fmtTime(last.now_time).slice(0, 16)} UTC — klik Scan untuk data terbaru`;
    }
  } catch { /* abaikan */ }
  $("mscOut").addEventListener("click", async (e) => {
    const R = MSC_S.res;
    if (!R) return;
    const t = e.target.closest("[data-mscp]");
    if (t) { MSC_S.plan = +t.dataset.mscp; renderMsc(); return; }
    if (e.target.id === "mscCopy") { await copyText(MSC.signal(mscFull(R, mscPlan()), mscPlan())); return toast("Sinyal disalin 📋"); }
    if (e.target.id === "mscDl") { try { await MSC.download(mscFull(R, mscPlan()), mscPlan()); } catch (ex) { toast("Gagal membuat gambar: " + ex.message); } return; }
    if (e.target.id === "mscReplay") { renderMsc(); return; }
    const tr = e.target.closest("tr[data-mscx]");
    if (tr) {
      const x = R.examples[+tr.dataset.mscx];
      await openMoment(x.symbol, R.tf, x.time, x.swings.map((sw) => ({ point: true, time: sw.time, price: sw.price, label: sw.label })),
        `Pola ${R.pattern.join(" › ")} di ${x.symbol} ${fmtTime(x.time).slice(0, 16)} UTC (candle terakhir = swing terakhir terkonfirmasi). Sesudahnya harga ${x.first_move > 0 ? "naik" : x.first_move < 0 ? "turun" : "tidak jelas bergerak"} ${R.pred.move_atr || 2} ATR duluan — lanjutkan replay untuk melihat.`);
    }
  });
}

// ------------------------------------------------------------------ 🧪 cek entry posisi (entry / SL / TP kamu vs pola di riwayat)
const PC = { res: null };
function pcDur(bars, tf) {
  if (bars == null) return "—";
  const m = bars * (IT_TF_MIN[tf] || 15);
  return m < 60 ? `±${Math.round(m)} menit` : m < 1440 ? `±${+(m / 60).toFixed(1)} jam` : `±${+(m / 1440).toFixed(1)} hari`;
}
async function runPc() {
  const body = { symbol: ($("pcSym").value || "").trim().toUpperCase(), tf: $("pcTf").value, swing: $("pcSwing").value, scope: $("pcScope").value, htf: $("pcHtf").value,
    filled: $("pcFilled").value === "1", entry: $("pcEntry").value, sl: $("pcSl").value, tp: $("pcTp").value };
  if (!body.symbol) return toast("Isi koin dulu, mis. BTCUSDT");
  if (!body.entry || !body.sl || !body.tp) return toast("Isi entry, SL dan TP");
  store.set("pcForm", body);
  $("pcRun").disabled = true;
  $("pcStatus").innerHTML = `Membaca struktur ${esc(body.symbol)} &amp; menguji entry kamu di pola yang sama<span class="dots"></span>`;
  $("pcOut").classList.remove("hidden");
  $("pcOut").innerHTML = `<div class="card evalcard msc-empty"><h3>⏳ Cek entry ${esc(body.symbol)} ${esc(body.tf.toUpperCase())}<span class="dots"></span></h3></div>`;
  try {
    const r = await fetch("/api/msa/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.detail || r.statusText);
    let st;
    for (;;) {
      st = await (await fetch(`/api/screener/job/${j.id}`)).json();
      if (st.status !== "running") break;
      if (st.total) $("pcStatus").innerHTML = `Mencari pola di riwayat ${st.done}/${st.total} koin<span class="dots"></span>`;
      await new Promise((ok) => setTimeout(ok, 400));
    }
    if (st.status === "error") throw new Error(st.error);
    if (!st.result) throw new Error(`cek berhenti tanpa hasil (status: ${st.status})`);
    PC.res = st.result;
    $("pcStatus").textContent = `Selesai ${new Date().toLocaleTimeString()} · ${PC.res.elapsed} dtk · struktur dari ${PC.res.source === "binance" ? "Binance (live)" : "data lokal"}`;
    renderPc();
    $("pcOut").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (ex) {
    $("pcStatus").textContent = "⚠️ " + ex.message;
    $("pcOut").innerHTML = `<div class="card evalcard msc-empty"><h3>⚠️ Cek entry gagal</h3><p>${esc(ex.message)}</p></div>`;
  } finally { $("pcRun").disabled = false; }
}
function pcSpec(R) {
  const S = R.stats || {}, tf = R.tf, long = R.dir === 0, sg = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
  const sug = Object.fromEntries((R.suggestions || []).map((x) => [x.kind, x]));
  const kind = R.filled ? "market" : (long ? R.entry < R.now_price : R.entry > R.now_price) ? "limit" : "stop";
  const walls = [];
  if (sug.entry) walls.push({ keep: true, price: sug.entry.price, color: "#a78bfa", label: `saran entry ${pxTxt(sug.entry.price)}` });
  if (sug.sl) walls.push({ keep: true, price: sug.sl.price, color: "#fb923c", label: `saran SL ${pxTxt(sug.sl.price)}` });
  if (sug.tp) walls.push({ keep: true, price: sug.tp.price, color: "#22d3ee", label: `saran TP ${pxTxt(sug.tp.price)}` });
  const pc = (v) => (v == null ? "—" : `${v.toFixed(0)}%`);
  const box4 = R.filled
    ? ["TP vs SL DULUAN", `${pc(S.wr)} / ${pc(S.sl_pct)}`, (S.wr || 0) >= (S.sl_pct || 0) ? "#36e3a1" : "#ff6b73", `TP / SL · selesai ${pcDur(S.exit_bars, tf)}`]
    : ["LIMIT TERISI", pc(S.fill_pct), "#e6ebf2", `biasanya ${pcDur(S.fill_bars, tf)} · TP duluan ${pc(S.wr)}`];
  const Rv = { ...R, sub: "Cek entry posisi", icon: "🧪", walls, insights: pcInsights(R),
    boxes: [["ENTRY KAMU", pxTxt(R.entry), "#60a5fa", sug.entry ? `saran: ${pxTxt(sug.entry.price)}` : R.filled ? "posisi sudah masuk" : "sudah pas"],
      ["STOP LOSS", pxTxt(R.sl), "#ff6b73", sug.sl ? `saran: ${pxTxt(sug.sl.price)}` : `kena wick ${pc(S.wick_pct)}`],
      ["TAKE PROFIT", pxTxt(R.tp), "#36e3a1", sug.tp ? `saran: ${pxTxt(sug.tp.price)}` : `RR 1:${R.rr.toFixed(2)}`],
      box4,
      ["HASIL / SINYAL", sg(S.exp_sig), (S.exp_sig || 0) > 0 ? "#36e3a1" : "#ff6b73", `${S.n_fill || 0} trade · data uji ${sg(R.test && R.test.exp_sig)}`]],
    lines: [`Peluang: ${R.filled ? "" : `limit terisi ${pc(S.fill_pct)} (${pcDur(S.fill_bars, tf)}) · `}TP duluan ${pc(S.wr)} · SL duluan ${pc(S.sl_pct)} · hasil ${sg(S.exp_sig)}/sinyal dari ${R.n_occ} kejadian`]
      .concat((R.suggestions || []).map((x) => `Saran ${x.kind.toUpperCase()}: ${pxTxt(x.price)}${x.proven ? " ✅" : ""}`)) };
  const B = { dir: R.dir, price_entry: R.entry, price_sl: R.sl, price_tp: R.tp, rr: R.rr, entry: kind === "market" ? "market" : "limit",
    entry_txt: R.filled ? "posisi sudah masuk" : kind === "stop" ? "order stop kamu" : "limit kamu", risk_pct: Math.abs(R.entry - R.sl) / R.entry * 100, live: true,
    status: R.filled ? `posisi berjalan · TP duluan ${pc(S.wr)}` : `menunggu · terisi ${pc(S.fill_pct)} dalam ${pcDur(S.fill_bars, tf)}` };
  return { R: Rv, B };
}
function renderPc() {
  const R = PC.res, box = $("pcOut");
  box.classList.remove("hidden");
  if (!R.n_occ || !R.stats) {
    box.innerHTML = `<div class="card evalcard"><h3>🧪 ${esc(R.symbol)} · ${esc(R.tf.toUpperCase())}</h3><p>Pola sekarang ${esc((R.pattern || []).join(" › "))} tidak ditemukan di riwayat. Coba ukuran swing lain.</p></div>`;
    return;
  }
  const S = R.stats, tf = R.tf, pc = (v) => (v == null ? "—" : `${v.toFixed(0)}%`), sg = (x) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`);
  const sp = pcSpec(R), st = R.story || {}, long = R.dir === 0, A = R.atr;
  const nm = { entry: "Entry", sl: "Stop loss", tp: "Take profit" };
  const sugg = (R.suggestions || []).map((x, i) => `<div class="pc-sug">
      <div><b>${nm[x.kind]}: ${pxTxt(R[x.kind])} → <span class="pos">${pxTxt(x.price)}</span></b> ${x.proven ? '<span class="badge pass">✅ terbukti di data uji</span>' : '<span class="badge fail">⚠️ belum terbukti di data uji</span>'}
        <button class="mini pc-use" data-i="${i}">Pakai saran ini</button></div>
      <p>${esc(x.why)}</p>
      <table class="tbl"><tr><th></th><th class="num">Terisi</th><th class="num">TP duluan</th><th class="num">Hasil / sinyal</th><th class="num">Data uji (30% terakhir)</th></tr>
        <tr><td>Punya kamu</td><td class="num">${pc(S.fill_pct)}</td><td class="num">${pc(S.wr)}</td><td class="num">${sg(S.exp_sig)}</td><td class="num">${sg(R.test.exp_sig)}</td></tr>
        <tr><td>Saran</td><td class="num">${pc(x.stats.fill_pct)}</td><td class="num">${pc(x.stats.wr)}</td><td class="num"><b>${sg(x.stats.exp_sig)}</b></td><td class="num">${sg(x.test.exp_sig)}</td></tr></table></div>`).join("");
  const C = R.combined;
  const ex = R.examples || [];
  box.innerHTML = `<div class="msc-card">${MSC.card(sp.R, sp.B, false)}</div>
    <div class="msc-btns"><span style="flex:1"></span><button class="mini" id="pcCopy">📋 Salin hasil</button><button class="mini" id="pcDl">⬇ Unduh gambar</button><button class="mini" id="pcReplay">▶ Putar ulang animasi</button></div>
    <details class="card evalcard msc-more"><summary><b>📄 Detail lengkap</b> <small class="hint">angka &amp; tabel di balik gambar — tidak wajib dibaca</small></summary>${R.note ? `<p class="hint">⚠️ ${esc(R.note)}</p>` : ""}
    <h4>🎯 ${R.filled ? "Posisi kamu" : "Entry kamu"} di ${R.n_occ} kejadian pola ${(R.pattern || []).map(esc).join(" › ")} (${R.n_coins} koin)</h4>
    <ul>
      ${R.filled ? "" : `<li>Limit <b>terisi ${pc(S.fill_pct)}</b> kejadian, biasanya dalam <b>${pcDur(S.fill_bars, tf)}</b> (umumnya ${pcDur(S.fill_p25, tf)} – ${pcDur(S.fill_p75, tf)}). Tidak terisi dalam ${pcDur(96, tf)} = dianggap batal.</li>`}
      <li>${R.filled ? "Dari sekarang" : "Kalau terisi"}: <b class="pos">kena TP duluan ${pc(S.wr)}</b> · <b class="neg">kena SL duluan ${pc(S.sl_pct)}</b>${S.to_pct ? ` · belum kena dua-duanya ${pc(S.to_pct)}` : ""} · biasanya selesai dalam ${pcDur(S.exit_bars, tf)}.</li>
      <li>Hasil rata-rata <b>${sg(S.exp_sig)} per sinyal</b> (${sg(S.exp_r)} per trade terisi). Data uji 30% terakhir: ${sg(R.test.exp_sig)} per sinyal.</li>
      ${S.wick_pct ? `<li>${pc(S.wick_pct)} trade kena SL dulu lalu harga tetap sampai TP (kena wick / gocekan).</li>` : ""}
      ${st.counter_atr != null ? `<li>Pola ini rata-rata <b>${long ? "turun" : "naik"} dulu ±${st.counter_atr.toFixed(2)} ATR</b> (≈ ${pxTxt(long ? R.now_price - st.counter_atr * A : R.now_price + st.counter_atr * A)}) sebelum ${long ? "naik" : "turun"} 2 ATR.</li>` : ""}
      ${st.mfe_atr != null ? `<li>Median gerak maksimal searah setelah entry ±${st.mfe_atr.toFixed(2)} ATR (≈ ${pxTxt(long ? R.entry + st.mfe_atr * A : R.entry - st.mfe_atr * A)}).</li>` : ""}
      ${R.pred ? `<li>Prediksi arah dari pola: <b>${R.pred.pct_up >= 50 ? `naik ${pc(R.pred.pct_up)}` : `turun ${pc(R.pred.pct_down)}`}</b> (2 ATR duluan) — ${(R.pred.pct_up >= 50) === long ? "searah posisi kamu ✅" : "<span class='neg'>melawan posisi kamu ⚠️</span>"}.</li>` : ""}
    </ul>
    ${accHtml(R)}
    <h4>💡 Saran ${R.filled ? "TP" : "entry / SL / TP"}</h4>
    ${sugg || `<p class="hint">Tidak ada geseran ${R.filled ? "TP" : "entry / SL / TP"} yang menaikkan hasil ≥ 0,05R per sinyal — level kamu sudah termasuk yang terbaik untuk pola ini.</p>`}
    ${C ? `<div class="pc-sug"><div><b>Semua saran dipakai sekaligus:</b> entry ${pxTxt(C.entry)} · SL ${pxTxt(C.sl)} · TP ${pxTxt(C.tp)}
        ${C.proven ? '<span class="badge pass">✅ terbukti di data uji</span>' : '<span class="badge fail">⚠️ belum terbukti</span>'} <button class="mini pc-use" data-i="all">Pakai semua</button></div>
        <p>Terisi ${pc(C.stats.fill_pct)} · TP duluan ${pc(C.stats.wr)} · hasil <b>${sg(C.stats.exp_sig)}</b> per sinyal (kamu ${sg(S.exp_sig)}) · data uji ${sg(C.test.exp_sig)}.</p></div>` : ""}
    <details><summary><b>🔍 Contoh kejadian</b> <small class="hint">${ex.length} kejadian · level kamu dipasang di tiap kejadian · klik untuk buka di Manual Replay</small></summary>
      <div class="scroll" style="max-height:360px"><table class="tbl"><tr><th>Waktu (UTC)</th><th>Koin</th><th>Terisi</th><th>Hasil</th></tr>` +
      ex.map((e, i) => `<tr data-pcx="${i}" title="Buka di chart"><td>${fmtTime(e.time).slice(0, 16)}</td><td>${esc(e.symbol)}</td>
        <td>${R.filled ? "—" : e.filled ? `✅ ${pcDur(e.fill_bars, tf)}` : "❌ tidak terisi"}</td>
        <td class="${e.code === 1 ? "pos" : e.code === -1 ? "neg" : ""}">${e.code === 1 ? "TP" : e.code === -1 ? "SL" : e.filled ? "waktu habis" : "—"}${e.result != null ? ` (${sg(e.result)})` : ""}</td></tr>`).join("") + `</table></div></details></details>`;
}
{
  const tfs = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];
  $("pcTf").innerHTML = tfs.map((t) => `<option value="${t}">${t.toUpperCase()}</option>`).join("");
  const f = store.get("pcForm", null) || {};
  $("pcTf").value = f.tf || "15m"; $("pcSwing").value = f.swing || "kecil"; $("pcScope").value = f.scope === "coin" ? "coin" : "all"; $("pcHtf").value = f.htf || "auto"; $("pcFilled").value = f.filled ? "1" : "0";
  $("pcSym").value = f.symbol || $("symbol").value || "BTCUSDT";
  for (const k of ["entry", "sl", "tp"]) if (f[k]) $("pc" + k[0].toUpperCase() + k.slice(1)).value = f[k];
  const dirInfo = () => {
    const e = +$("pcEntry").value, s = +$("pcSl").value, t = +$("pcTp").value;
    $("pcInfo").innerHTML = !(e && s && t) ? "LONG = SL &lt; entry &lt; TP · SHORT = TP &lt; entry &lt; SL. Arah dibaca otomatis dari susunan harga."
      : t > e && e > s ? `🟢 <b>LONG</b> · RR 1:${((t - e) / (e - s)).toFixed(2)}` : t < e && e < s ? `🔴 <b>SHORT</b> · RR 1:${((e - t) / (s - e)).toFixed(2)}`
      : `<span class="neg">⚠️ Susunan salah: LONG = SL &lt; entry &lt; TP, SHORT = TP &lt; entry &lt; SL</span>`;
  };
  ["pcEntry", "pcSl", "pcTp"].forEach((id) => $(id).addEventListener("input", dirInfo)); dirInfo();
  $("pcRun").onclick = runPc;
  $("pcOut").addEventListener("click", async (e) => {
    const R = PC.res;
    if (!R) return;
    const u = e.target.closest(".pc-use");
    if (u) {
      const pick = u.dataset.i === "all" ? R.combined : R.suggestions[+u.dataset.i];
      if (u.dataset.i === "all") { $("pcEntry").value = +pick.entry.toPrecision(6); $("pcSl").value = +pick.sl.toPrecision(6); $("pcTp").value = +pick.tp.toPrecision(6); }
      else $("pc" + { entry: "Entry", sl: "Sl", tp: "Tp" }[pick.kind]).value = +pick.price.toPrecision(6);
      dirInfo(); toast("Saran dipasang ke form. Klik 🧪 Cek entry untuk menguji ulang.");
      $("pcRun").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const sp = pcSpec(R);
    if (e.target.id === "pcCopy") { await copyText(MSC.signal(sp.R, sp.B)); return toast("Hasil disalin 📋"); }
    if (e.target.id === "pcDl") { try { await MSC.download(sp.R, sp.B); } catch (ex) { toast("Gagal membuat gambar: " + ex.message); } return; }
    if (e.target.id === "pcReplay") return renderPc();
    const tr = e.target.closest("tr[data-pcx]");
    if (tr) {
      const x = R.examples[+tr.dataset.pcx];
      await openMoment(x.symbol, R.tf, x.time, [
        { price: x.entry, color: "#42a5f5", size: 2, label: `E ${pxTxt(x.entry)}` },
        { price: x.sl, color: "#ef5350", dash: true, label: `SL ${pxTxt(x.sl)}` },
        { price: x.tp, color: "#26a69a", dash: true, label: `TP ${pxTxt(x.tp)}` }].concat(x.swings.map((sw) => ({ point: true, time: sw.time, price: sw.price, label: sw.label }))),
        `Pola ${(R.pattern || []).join(" › ")} di ${x.symbol} ${fmtTime(x.time).slice(0, 16)} UTC. Entry / SL / TP kamu dipasang dengan jarak ATR yang sama. ` +
        `${R.filled ? "" : x.filled ? `Limit terisi ${pcDur(x.fill_bars, R.tf)} kemudian. ` : "Limit tidak terisi. "}Hasil: ${x.code === 1 ? "TP" : x.code === -1 ? "SL" : x.filled ? "waktu habis" : "—"}. Step maju untuk melihat.`);
    }
  });
}


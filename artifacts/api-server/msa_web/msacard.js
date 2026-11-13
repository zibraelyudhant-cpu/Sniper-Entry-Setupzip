// 🔎 Screener Market Structure — kartu sinyal (satu SVG utuh: tampil di app, bisa diunduh jadi PNG).
// msaCard(R, plan, still): R = hasil /api/msa/screen, plan = rencana entry (boleh null), still = tanpa animasi (untuk unduh).
(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const CSS = `
.ghost{opacity:0;animation:mscPop .35s ease-out forwards}
@keyframes mscPop{from{opacity:0}to{opacity:.95}}
.path{stroke-dasharray:2400;stroke-dashoffset:2400;animation:mscDraw 4.4s linear .3s forwards}
@keyframes mscDraw{to{stroke-dashoffset:0}}
.cone,.zone,.lbl,.tgt{opacity:0;animation:mscFade .8s ease-out forwards}
@keyframes mscFade{to{opacity:1}}
.ring{transform-origin:center;transform-box:fill-box;opacity:0;animation:mscRing 1.8s ease-out infinite}
@keyframes mscRing{0%{opacity:.8;transform:scale(.6)}100%{opacity:0;transform:scale(2.6)}}
.dot{animation:mscBlink 1.6s infinite}@keyframes mscBlink{50%{opacity:.35}}`;

  function card(R, B, still) {
    // R umum: candles, symbol, tf, now_time, now_price; opsional: pred/proj (prediksi), swings_vis, pattern, sub (subjudul),
    // boxes (5 kotak [judul, nilai, warna, sub]), footer (teks kiri bawah), walls ([{price, label, color}])
    const C = R.candles.slice(-(R.nbar || 64)), P = R.pred || {}, isL = B ? B.dir === 0 : (P.pct_up >= 50), proj = R.proj, PT = proj && proj.path;
    const W = 1180, H = 470, padR = 92, padT = 18, padB = 26, left = 14, OY = 74;
    const dt = C[1][0] - C[0][0], tLast = C[C.length - 1][0], t0 = C[0][0];
    const NP = PT ? PT.close.length : 20, tEnd = tLast + (NP + 6) * dt;
    const lastC = R.now_price != null ? R.now_price : C[C.length - 1][4], A = proj && proj.atr ? proj.atr : lastC * 0.005;
    const pp = (r) => lastC + r * A;
    const RL = PT && (PT.real || PT);
    let lo = Math.min(...C.map((c) => c[3])), hi = Math.max(...C.map((c) => c[2]));
    if (PT) { lo = Math.min(lo, ...PT.p25.map(pp), ...RL.low.map(pp)); hi = Math.max(hi, ...PT.p75.map(pp), ...RL.high.map(pp)); }
    // skala mengikuti candle + jalur prediksi (+ entry). SL / TP yang terlalu jauh tidak memencet chart:
    // garisnya ditempel di tepi dengan tanda panah (supaya prediksi selalu terlihat jelas & sama di semua menu)
    if (B) { lo = Math.min(lo, B.price_entry); hi = Math.max(hi, B.price_entry); }
    const span0 = hi - lo;
    if (B) for (const p of [B.price_sl, B.price_tp]) {
      if (p < lo && p >= lo - 0.6 * span0) lo = p;
      if (p > hi && p <= hi + 0.6 * span0) hi = p;
    }
    const pd = (hi - lo) * 0.05; lo -= pd; hi += pd;
    const X = (t) => left + (t - t0) / (tEnd - t0) * (W - padR - left), Y = (p) => OY + padT + (hi - p) / (hi - lo) * (H - padT - padB);
    const yTop = OY + padT + 2, yBot = OY + H - padB - 2, Yc = (p) => Math.min(yBot, Math.max(yTop, Y(p)));
    const off = (p) => (p > hi ? "↑" : p < lo ? "↓" : "");                 // level di luar layar
    const cw = Math.max(2.5, (X(t0 + dt) - X(t0)) * 0.62), dec = lastC >= 1000 ? 1 : lastC >= 100 ? 2 : lastC >= 1 ? 4 : lastC >= 0.01 ? 6 : 8;
    const fmt = (p) => p.toFixed(dec);
    const an = (cls, d) => (still ? "" : ` class="${cls}"${d != null ? ` style="animation-delay:${d}s"` : ""}`);
    // panel ringkasan DI BAWAH chart (tidak menutupi chart): R.insights = [{t: teks, c: warna}]
    const INS = (R.insights || []).filter((x) => x && x.t), insH = INS.length ? INS.length * 24 + 22 : 0;
    const tot = 690 + insH;
    let g = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${tot}" width="${W}" height="${tot}" font-family="Inter,Segoe UI,system-ui,sans-serif">
<style>${still ? "" : CSS}</style>
<defs>
 <linearGradient id="mscBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f151d"/><stop offset="1" stop-color="#0a0e13"/></linearGradient>
 <linearGradient id="mscT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16c784" stop-opacity="${isL ? ".28" : ".06"}"/><stop offset="1" stop-color="#16c784" stop-opacity="${isL ? ".06" : ".28"}"/></linearGradient>
 <linearGradient id="mscS" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ea3943" stop-opacity="${isL ? ".08" : ".3"}"/><stop offset="1" stop-color="#ea3943" stop-opacity="${isL ? ".3" : ".08"}"/></linearGradient>
 <radialGradient id="mscIc" cx=".3" cy=".3" r=".9"><stop offset="0" stop-color="#f7c948"/><stop offset="1" stop-color="#e8890c"/></radialGradient>
 <filter id="mscGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${W}" height="${tot}" rx="18" fill="url(#mscBg)" stroke="#1d2733"/>`;
    // ---- header
    const chg = (lastC / C[Math.max(0, C.length - 25)][4] - 1) * 100;
    g += `<circle cx="39" cy="37" r="19" fill="url(#mscIc)"/><text x="39" y="42.5" text-anchor="middle" fill="#1a1200" font-size="15" font-weight="800">${esc(R.symbol[0])}</text>
<text x="70" y="33" fill="#e6ebf2" font-size="19" font-weight="700">${esc(R.symbol)} <tspan fill="#6b7686" font-weight="500">Perpetual</tspan></text>
<text x="70" y="52" fill="#6b7686" font-size="12.5">Binance Futures · ${esc(R.tf.toUpperCase())} · ${esc(R.sub || "Screener Market Structure")}</text>
<text x="400" y="45" fill="#e6ebf2" font-size="22" font-weight="700">${fmt(lastC)}</text>
<text x="${400 + fmt(lastC).length * 13 + 14}" y="44" fill="${chg >= 0 ? "#16c784" : "#ea3943"}" font-size="12.5">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</text>`;
    let side, sideCol, stTxt, stCol;
    if (B) {
      const kind = B.entry === "market" ? "MARKET" : "LIMIT", st0 = String(B.status || "");
      const live = B.usable != null ? B.usable : B.live != null ? B.live : /^aktif/i.test(st0);
      const st = live || B.usable == null ? st0 : B.why_not || st0;
      const tag = !B.live && B.live != null ? "LEWAT" : B.fill_ok === false ? "JARANG TERISI" : B.profit_ok === false ? "RUGI · JANGAN" : "LEWAT";
      side = live ? `${isL ? "▲ BUY" : "▼ SELL"} ${kind}` : `${isL ? "BUY" : "SELL"} ${kind} · ${tag}`;
      sideCol = !live ? "#8b96a5" : isL ? "#16c784" : "#ea3943";
      stTxt = live ? st.replace(/^aktif/i, "AKTIF") : st; stCol = live ? "#16c784" : /kena TP/.test(st) ? "#36e3a1" : /SL|batal/.test(st) ? "#ea3943" : "#f5a524";
    } else if (R.last_plan) {
      side = "⏳ JANGAN ENTRY DULU"; sideCol = "#f5a524"; stTxt = `belum layak: ${R.last_plan.why_not || R.last_plan.status}`; stCol = /SL|batal/.test(R.last_plan.status) ? "#ea3943" : "#f5a524";
    } else { side = "TIDAK ADA SETUP"; sideCol = "#8b96a5"; stTxt = "belum ada aturan yang untung"; stCol = "#8b96a5"; }
    const maxSt = R.filters && R.filters.htf ? 30 : 40;                    // sisakan tempat untuk chip tren TF besar
    if (stTxt.length > maxSt) stTxt = stTxt.slice(0, maxSt - 1) + "…";              // kalimat lengkap ada di panel ringkasan
    const sw1 = side.length * 8.6 + 28, sx = W - 20 - sw1, stw = stTxt.length * 6.9 + 40, stx = sx - 10 - stw;
    g += `<rect x="${sx}" y="19" width="${sw1}" height="34" rx="17" fill="${sideCol}22" stroke="${sideCol}66"/><text x="${sx + sw1 / 2}" y="41" text-anchor="middle" fill="${sideCol}" font-size="13" font-weight="800" letter-spacing=".4">${side}</text>
<rect x="${stx}" y="19" width="${stw}" height="34" rx="17" fill="#ffffff08" stroke="#ffffff14"/><circle${still ? "" : ' class="dot"'} cx="${stx + 18}" cy="36" r="4" fill="${stCol}"/><text x="${stx + 30}" y="40.5" fill="#e6ebf2" font-size="12.5" font-weight="600">${esc(stTxt)}</text>
<line x1="0" x2="${W}" y1="${OY - 2}" y2="${OY - 2}" stroke="#1c2530"/>`;
    // tren TF besar (struktur HH/HL atau LH/LL di TF besar yang sudah terkonfirmasi)
    const F = R.filters;
    if (F && F.htf) {
      const tn = F.htf_now, tc = tn === "naik" ? "#16c784" : tn === "turun" ? "#ea3943" : "#f5a524";
      const used = (F.mode || "").includes("tren");
      const tt = `Tren ${F.htf.toUpperCase()} ${tn === "naik" ? "▲ NAIK" : tn === "turun" ? "▼ TURUN" : tn === "campur" ? "↔ CAMPUR" : "?"}`;
      const sub = used ? "✓ dipakai penyaring" : "info saja";
      const hw = Math.max(tt.length * 7.2, sub.length * 5.6) + 20, hx = Math.max(400 + fmt(lastC).length * 13 + 66, stx - 8 - hw);
      g += `<rect x="${hx}" y="17" width="${hw}" height="38" rx="10" fill="${tc}18" stroke="${tc}66"/>
<text x="${hx + 10}" y="33" fill="${tc}" font-size="12" font-weight="800">${tt}</text>
<text x="${hx + 10}" y="48" fill="#8b96a5" font-size="10">${sub}</text>`;
    }
    // ---- grid
    for (let i = 0; i <= 7; i++) { const p = lo + (hi - lo) * i / 7, y = Y(p); g += `<line x1="${left}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#18212b"/><text x="${W - padR + 10}" y="${y + 4}" fill="#566170" font-size="11">${fmt(p)}</text>`; }
    for (let i = 0; i < C.length; i += 12) { const x = X(C[i][0]); g += `<line x1="${x}" x2="${x}" y1="${OY + padT}" y2="${OY + H - padB}" stroke="#141c25"/><text x="${x - 16}" y="${OY + H - 8}" fill="#566170" font-size="10.5">${new Date(C[i][0]).toISOString().slice(11, 16)}</text>`; }
    g += `<text x="${(W - padR) / 2}" y="${OY + H / 2 + 22}" text-anchor="middle" fill="#ffffff06" font-size="86" font-weight="800">${esc(R.symbol)}</text>`;
    const zx = X(tLast) + 2, zw = W - padR - zx;
    for (const w of R.walls || []) {                                  // garis tambahan (mis. tembok order whale)
      const out = !(w.price > lo && w.price < hi);
      if (out && !w.keep) continue;                                       // keep = tetap tampil di tepi (mis. garis saran)
      const y = Yc(w.price), col = w.color || "#a78bfa";
      g += `<line x1="${left}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="${col}" stroke-opacity=".55" stroke-width="${w.width || 1.2}" stroke-dasharray="8 3 2 3"/>
<text x="${left + 6}" y="${y > yTop + 14 ? y - 4 : y + 13}" fill="${col}" font-size="10.5" font-weight="700">${esc(w.label || "")}${out ? ` ${off(w.price)} di luar layar` : ""}</text>`;
    }
    let yE = 0, yS = 0;
    if (B) {
      yE = Yc(B.price_entry); yS = Yc(B.price_sl); const yT = Yc(B.price_tp);
      g += `<rect${an("zone", 0.1)} x="${zx}" y="${Math.min(yE, yT)}" width="${zw}" height="${Math.abs(yT - yE)}" fill="url(#mscT)"/>`;
      g += `<rect${an("zone", 0.1)} x="${zx}" y="${Math.min(yE, yS)}" width="${zw}" height="${Math.abs(yS - yE)}" fill="url(#mscS)"/>`;
      const rGap = Math.abs(yS - yE) >= 13;
      for (let r = 1; r < B.rr; r++) { const pr = isL ? B.price_entry + r * (B.price_entry - B.price_sl) : B.price_entry - r * (B.price_sl - B.price_entry);
        if (off(pr)) continue;
        g += `<g${an("zone", 0.1)}><line x1="${zx}" x2="${zx + zw}" y1="${Y(pr)}" y2="${Y(pr)}" stroke="#16c78433" stroke-dasharray="2 4"/>${rGap ? `<text x="${W - padR - 22}" y="${Y(pr) - 3}" fill="#16c78488" font-size="10">${r}R</text>` : ""}</g>`; }
    }
    for (const c of C) { const [t, o, h, l, cl] = c, x = X(t), col = cl >= o ? "#16c784" : "#ea3943";
      g += `<line x1="${x}" x2="${x}" y1="${Y(h)}" y2="${Y(l)}" stroke="${col}"/><rect x="${x - cw / 2}" y="${Math.min(Y(o), Y(cl))}" width="${cw}" height="${Math.max(1, Math.abs(Y(o) - Y(cl)))}" rx="1" fill="${col}"/>`; }
    const sw = (R.swings_vis || []).filter((s) => s.time >= t0);
    if (sw.length) g += `<polyline points="${sw.map((s) => `${X(s.time)},${Y(s.price)}`).join(" ")}" fill="none" stroke="#f0b90b" stroke-opacity=".55" stroke-width="1.4"/>`;
    for (const s of sw) { const top = ["HH", "LH", "H"].includes(s.label), x = X(s.time), y = Y(s.price) + (top ? -14 : 14);
      g += `<circle cx="${x}" cy="${Y(s.price)}" r="2.6" fill="#f0b90b"/><rect x="${x - 15}" y="${y - 9}" width="30" height="17" rx="8.5" fill="${top ? "#ea394333" : "#16c78433"}" stroke="${top ? "#ea3943" : "#16c784"}" stroke-width=".8"/>
<text x="${x}" y="${y + 3.5}" text-anchor="middle" fill="${top ? "#ff7880" : "#3ff0ac"}" font-size="10.5" font-weight="800">${esc(s.label || "")}</text>`; }
    let legend = "";
    // ---- prediksi dari riwayat
    if (PT) {
      const n = PT.close.length, xs = PT.close.map((_, i) => X(tLast + (i + 1) * dt)), step = 4.2 / n;
      const band = xs.map((x, i) => `${x},${Y(pp(PT.p75[i]))}`).concat(xs.map((x, i) => `${x},${Y(pp(PT.p25[i]))}`).reverse());
      g += `<polygon${an("cone", 0.2)} points="${X(tLast)},${Y(lastC)} ${band.join(" ")}" fill="#f0b90b" fill-opacity=".09" stroke="#f0b90b" stroke-opacity=".25" stroke-dasharray="3 3"/>`;
      g += `<polyline${an("cone", 0.2)} points="${X(tLast)},${Y(lastC)} ${PT.close.map((cr, i) => `${xs[i]},${Y(pp(cr))}`).join(" ")}" fill="none" stroke="#f0b90b" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="5 4"/>`;
      let prev = 0, hit = null;
      const tgtR = (PT.dir > 0 ? 1 : -1) * (P.move_atr || 2);
      RL.close.forEach((cr, i) => {
        const o = pp(prev), cl = pp(cr), hh = Math.max(o, cl, pp(RL.high[i])), ll = Math.min(o, cl, pp(RL.low[i])), x = xs[i], col = cl >= o ? "#16c784" : "#ea3943";
        g += `<g${an("ghost", (0.3 + i * step).toFixed(2))}${still ? ' opacity=".9"' : ""}><line x1="${x}" x2="${x}" y1="${Y(hh)}" y2="${Y(ll)}" stroke="${col}" stroke-opacity=".6"/>
<rect x="${x - cw / 2}" y="${Math.min(Y(o), Y(cl))}" width="${cw}" height="${Math.max(1, Math.abs(Y(o) - Y(cl)))}" rx="1" fill="${col}" fill-opacity=".25" stroke="${col}" stroke-opacity=".9"/></g>`;
        if (hit == null && (tgtR < 0 ? PT.close[i] <= tgtR : PT.close[i] >= tgtR)) hit = i;
        prev = cr;
      });
      const pc = PT.dir > 0 ? "#16c784" : "#ea3943";
      g += `<polyline${an("path")} points="${X(tLast)},${Y(lastC)} ${RL.close.map((cr, i) => `${xs[i]},${Y(pp(cr))}`).join(" ")}" fill="none" stroke="${pc}" stroke-width="2" stroke-opacity=".9" filter="url(#mscGlow)"/>`;
      const k = hit == null ? n - 1 : hit, tx = xs[k], ty = Y(pp(RL.close[k])), dk = 0.3 + k * step;
      const pct = PT.dir > 0 ? P.pct_up : P.pct_down;
      const ltxt = `${PT.dir > 0 ? "▲" : "▼"} ${pct.toFixed(0)}% ${PT.dir > 0 ? "naik" : "turun"} ${P.move_atr || 2} ATR duluan${(PT.dir > 0 ? P.bars_up : P.bars_down) ? ` · median ${PT.dir > 0 ? P.bars_up : P.bars_down} candle` : ""}`, lw = ltxt.length * 6.6 + 18;
      // label di sisi yang kosong (berlawanan dengan arah prediksi)
      const top = OY + padT + 6, bot = OY + H - padB - 30;
      const busy = [];                                           // daerah yang sudah terisi di sisi kanan
      if (B) for (const p of [B.price_entry, B.price_sl, B.price_tp]) busy.push([Yc(p) - 24, Yc(p) + 4]);
      const ys = [Y(lastC)].concat(PT.p25.map((v) => Y(pp(v))), PT.p75.map((v) => Y(pp(v))), RL.high.map((v) => Y(pp(v))), RL.low.map((v) => Y(pp(v))));
      busy.push([Math.min(...ys) - 4, Math.max(...ys) + 4]);
      const cost = (y) => busy.reduce((a, [u, v]) => a + Math.max(0, Math.min(v, y + 28) - Math.max(u, y)), 0);
      let ly = top, best = Infinity;
      for (let y = top; y <= bot; y += 4) {                       // utamakan sisi berlawanan dengan arah prediksi
        const c = cost(y) * 100 + (PT.dir > 0 ? (bot - y) : (y - top)) * 0.01;
        if (c < best) { best = c; ly = y; }
      }
      const lx = zx + 10;
      g += `<circle${an("ring", dk.toFixed(2))} cx="${tx}" cy="${ty}" r="7" fill="none" stroke="${pc}" stroke-width="2"/>
<circle${an("tgt", dk.toFixed(2))} cx="${tx}" cy="${ty}" r="4.5" fill="${pc}"/>
<g${an("tgt", (dk + 0.1).toFixed(2))}><rect x="${lx}" y="${ly}" width="${lw}" height="26" rx="7" fill="#0b0f14ee" stroke="${pc}"/><text x="${lx + 9}" y="${ly + 17}" fill="${pc}" font-size="12" font-weight="800">${ltxt}</text></g>`;
      legend = `candle bayangan = kejadian nyata ${PT.real ? esc(PT.real.symbol) + " " + new Date(PT.real.time).toISOString().slice(0, 10) : ""} (paling mirip rata-rata) · <tspan fill="#f0b90b">- - -</tspan> median ${PT.n} kejadian · pita kuning = 50% dari ${PT.n_all} kejadian`;
    }
    // ---- garis entry / sl / tp + tag sumbu
    const yC = Y(lastC);
    // tag harga di sumbu kanan: geser supaya tidak bertumpuk (min 21 px)
    const tags = (B ? [[B.price_tp, "TP"], [B.price_entry, "ENTRY"], [B.price_sl, "SL"]] : []).map(([p, n]) => ({ n, y: Yc(p) })).concat([{ n: "NOW", y: yC }]).sort((a, b) => a.y - b.y);
    for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 21) tags[i].y = tags[i - 1].y + 21;
    const over = tags.length ? tags[tags.length - 1].y - (OY + H - padB) : 0;
    if (over > 0) tags.forEach((t) => { t.y -= over; });
    const tagY = Object.fromEntries(tags.map((t) => [t.n, t.y]));
    // label nama (TP / ENTRY / SL) di kiri zona: juga jangan bertumpuk
    const nms = (B ? [[B.price_tp, "TP"], [B.price_entry, "ENTRY"], [B.price_sl, "SL"]] : []).map(([p, n]) => ({ n, y: Math.max(yTop + 22, Yc(p)) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < nms.length; i++) if (nms[i].y - nms[i - 1].y < 19) nms[i].y = nms[i - 1].y + 19;
    const nmY = Object.fromEntries(nms.map((t) => [t.n, t.y]));
    if (B) for (const [p, col, name, dash, delay] of [[B.price_tp, "#16c784", "TP", "6 4", 0.5], [B.price_entry, "#3b82f6", "ENTRY", "", 0.3], [B.price_sl, "#ea3943", "SL", "6 4", 0.4]]) {
      const y = Yc(p), ty = tagY[name], ny = nmY[name], ar = off(p);
      let nl = ar ? `${name} ${ar} di luar layar` : name;
      if (name === "ENTRY" && B.entry !== "market" && B.fill_pct != null)   // peluang terisi & batas waktu limit langsung di chart
        nl += ` · terisi ${B.fill_pct.toFixed(0)}%${B.expires ? ` · s/d ${new Date(B.expires).toISOString().slice(11, 16)} UTC` : ""}`;
      g += `<g${an("lbl", delay)}><line x1="${zx}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="${name === "ENTRY" ? 1.8 : 1.3}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>
<rect x="${W - padR + 2}" y="${ty - 10}" width="${padR - 6}" height="20" rx="4" fill="${col}"/><text x="${W - padR + 8}" y="${ty + 4}" fill="#fff" font-size="11" font-weight="800">${ar}${fmt(p)}</text>
<rect x="${zx + 8}" y="${ny - 22}" width="${nl.length * 7 + 16}" height="17" rx="4" fill="#0b0f14" stroke="${col}88"/><rect x="${zx + 8}" y="${ny - 22}" width="${nl.length * 7 + 16}" height="17" rx="4" fill="${col}22"/><text x="${zx + 16}" y="${ny - 9.5}" fill="${col}" font-size="11" font-weight="800">${nl}</text></g>`; }
    g += `<line x1="${left}" x2="${W - padR}" y1="${yC}" y2="${yC}" stroke="#9aa4b2" stroke-opacity=".35" stroke-dasharray="1 3"/><rect x="${W - padR + 2}" y="${tagY.NOW - 10}" width="${padR - 6}" height="20" rx="4" fill="#2a3442"/><text x="${W - padR + 8}" y="${tagY.NOW + 4}" fill="#e6ebf2" font-size="11" font-weight="700">${fmt(lastC)}</text>`;
    g += `<line x1="${X(tLast)}" x2="${X(tLast)}" y1="${OY + padT}" y2="${OY + H - padB}" stroke="#3b82f6" stroke-opacity=".25" stroke-dasharray="3 3"/><text x="${X(tLast) - 4}" y="${OY + H - padB - 6}" text-anchor="end" fill="#3b82f699" font-size="10.5" font-weight="700">SEKARANG</text>`;
    // ---- kotak angka
    const prob = (isL ? P.pct_up : P.pct_down) || 0, SY = OY + H + 10, bw = (W - 40 - 40) / 5;
    const box = (i, title, val, valCol, sub, extra) => {
      const x = 20 + i * (bw + 10);
      return `<rect x="${x}" y="${SY}" width="${bw}" height="72" rx="12" fill="#0d131a" stroke="#1c2530"/><text x="${x + 12}" y="${SY + 20}" fill="#6b7686" font-size="11" letter-spacing=".6">${title}</text>
<text x="${x + 12}" y="${SY + 44}" fill="${valCol}" font-size="18" font-weight="700">${val}</text>${sub ? `<text x="${x + 12}" y="${SY + 62}" fill="#6b7686" font-size="11.5">${sub}</text>` : ""}${extra || ""}`;
    };
    if (R.boxes) R.boxes.forEach((bx, i) => { g += box(i, bx[0], bx[1], bx[2], bx[3] || "", bx[4] || ""); });
    else {
    if (B) {
      const ft = B.entry === "market" ? "" : B.fill_pct != null ? `terisi ${B.fill_pct.toFixed(0)}% · ` : "";
      g += box(0, "ENTRY", fmt(B.price_entry), "#60a5fa", (ft + esc(B.entry_txt.replace("limit di ", "").replace(" saat pola terkonfirmasi", ""))).slice(0, 36));
      g += box(1, "STOP LOSS", fmt(B.price_sl), "#ff6b73", `risiko ${B.risk_pct.toFixed(2)}%`);
      g += box(2, "TAKE PROFIT", fmt(B.price_tp), "#36e3a1", `RR 1:${B.rr}`);
    } else {
      g += box(0, "ENTRY", "—", "#8b96a5", R.last_plan ? "tunggu swing / pola baru terbentuk" : "tidak ada aturan RR ≥ 1:3 yang untung");
      g += box(1, "STOP LOSS", "—", "#8b96a5", "");
      g += box(2, "TAKE PROFIT", "—", "#8b96a5", "");
    }
    const x3 = 20 + 3 * (bw + 10);
    const nb = P.base_up != null ? (isL ? P.base_up : P.base_down) : null;
    if (nb != null) {                                                    // pembanding: arah normal setelah swing apa pun
      const ed = prob - nb;
      g += box(3, "ARAH SELANJUTNYA", `${isL ? "▲ Naik" : "▼ Turun"} ${prob.toFixed(0)}%`, prob >= 50 ? "#36e3a1" : "#ffb020",
        `normal ${nb.toFixed(0)}% · ${ed >= 0 ? "+" : ""}${ed.toFixed(0)}% ${ed > 0 ? P.edge_txt || "" : "tidak unggul"}`);
    } else
    g += box(3, "ARAH SELANJUTNYA", `${isL ? "▲ Naik" : "▼ Turun"} ${prob.toFixed(0)}%`, prob >= 50 ? "#36e3a1" : "#ffb020", "",
      `<rect x="${x3 + 12}" y="${SY + 54}" width="${bw - 24}" height="6" rx="3" fill="#ffffff14"/><rect x="${x3 + 12}" y="${SY + 54}" width="${(bw - 24) * prob / 100}" height="6" rx="3" fill="${isL ? "#16c784" : "#ea3943"}"/>`);
    const sgn = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
    g += B ? (B.exp_sig != null
      ? box(4, "BACKTEST · PER SINYAL", `${sgn(B.exp_sig)}R`, B.exp_sig > 0 ? "#36e3a1" : "#ff6b73", `WR ${B.wr.toFixed(0)}% · ${B.n} trade · ${B.proven ? "✓ terbukti" : "⚠ belum"}`)
      : box(4, "BACKTEST POLA", `${B.wr.toFixed(0)}% WR · ${sgn(B.exp_r)}R`, "#e6ebf2", `${B.n} trade · ${B.proven ? "✓ terbukti" : "⚠ belum"}`))
      : box(4, "BACKTEST POLA", `${R.n_occ} kejadian`, "#e6ebf2", `${R.n_coins} koin`);
    }
    // ---- kaki: pola
    const FY = SY + 98;
    let cx = 20;
    if (R.pattern) { g += `<text x="${cx}" y="${FY}" fill="#6b7686" font-size="12">Pola:</text>`; cx += 40; }
    (R.pattern || []).forEach((x, i) => {
      const h = x.endsWith("H");
      if (i) { g += `<text x="${cx}" y="${FY}" fill="#4a5565" font-size="12">›</text>`; cx += 12; }
      g += `<rect x="${cx}" y="${FY - 14}" width="30" height="19" rx="5" fill="${h ? "#ea394322" : "#16c78422"}"/><text x="${cx + 15}" y="${FY}" text-anchor="middle" fill="${h ? "#ff6b73" : "#36e3a1"}" font-size="11.5" font-weight="700">${esc(x)}</text>`; cx += 36;
    });
    g += `<text x="${R.pattern ? cx + 8 : cx}" y="${FY}" fill="#6b7686" font-size="12">${esc(R.footer != null ? R.footer : `${R.n_occ} kejadian di riwayat · ${R.n_coins} koin`)}</text>`;
    g += `<text x="${W - 20}" y="${FY}" text-anchor="end" fill="#6b7686" font-size="12">${new Date(R.now_time).toISOString().slice(0, 16).replace("T", " ")} UTC · bukan saran keuangan</text>`;
    if (legend) g += `<text x="20" y="${FY + 20}" fill="#6b7686" font-size="11">${legend}</text>`;
    if (INS.length) {
      const IY = FY + 34;
      g += `<rect x="20" y="${IY}" width="${W - 40}" height="${insH - 8}" rx="12" fill="#0d131a" stroke="#1c2530"/>`;
      INS.forEach((x, i) => {
        const tx = String(x.t), cut = tx.length > 158 ? tx.slice(0, 157) + "…" : tx;
        g += `<text x="34" y="${IY + 22 + i * 24}" fill="${x.c || "#c9d1db"}" font-size="13" font-weight="${x.b ? 700 : 500}">${esc(cut)}</text>`;
      });
    }
    return g + "</svg>";
  }

  // teks sinyal untuk disalin (grup trading / catatan)
  function signal(R, B) {
    const P = R.pred, dec = R.now_price >= 1000 ? 1 : R.now_price >= 100 ? 2 : R.now_price >= 1 ? 4 : R.now_price >= 0.01 ? 6 : 8, f = (p) => p.toFixed(dec);
    const L = [`${R.icon || "📐"} ${R.symbol} · ${R.tf.toUpperCase()} · ${R.sub || "Screener Market Structure"}`];
    if (B) {
      const isL = B.dir === 0;
      L.push(`${isL ? "🟢 BUY" : "🔴 SELL"} ${B.entry === "market" ? "MARKET" : "LIMIT"}`,
        `Entry : ${f(B.price_entry)} (${B.entry_txt}${B.entry !== "market" && B.fill_pct != null ? ` · terisi ${B.fill_pct.toFixed(0)}% kejadian` : ""})`, `SL    : ${f(B.price_sl)} (risiko ${B.risk_pct.toFixed(2)}%)`, `TP    : ${f(B.price_tp)} (RR 1:${B.rr})`,
        `Status: ${B.status}${B.live === false ? " ⚠️ setup ini sudah tidak berlaku, jangan dipasang" : ""}`);
    } else if (R.last_plan) L.push(`⏳ Belum ada setup yang bisa dipasang sekarang (setup terakhir: ${R.last_plan.status}). Tunggu swing / pola baru terbentuk.`);
    else L.push("Tidak ada setup: belum ada aturan entry RR ≥ 1:3 yang untung untuk pola ini.");
    if (P && R.pattern) {
      const dirTxt = (P.pct_down > P.pct_up ? `turun ${P.pct_down.toFixed(0)}%` : `naik ${P.pct_up.toFixed(0)}%`) +
        (P.base_up != null ? ` (normal ${(P.pct_down > P.pct_up ? P.base_down : P.base_up).toFixed(0)}% · keunggulan ${P.edge >= 0 ? "+" : ""}${P.edge.toFixed(0)}% ${P.edge > 0 ? P.edge_txt : "tidak unggul"})` : "") +
        (R.filters && R.filters.mode && R.filters.mode !== "pola" ? ` · ${R.filters.mode}` : "");
      L.push(`Arah  : ${dirTxt} (${P.move_atr || 2} ATR duluan) dari ${R.n_occ} kejadian`, `Pola  : ${R.pattern.join(" › ")}`);
      if (B) L.push(`Backtest: ${B.n} trade · WR ${B.wr.toFixed(0)}% · ${B.exp_r >= 0 ? "+" : ""}${B.exp_r.toFixed(2)}R/trade${B.exp_sig != null ? ` · ${B.exp_sig >= 0 ? "+" : ""}${B.exp_sig.toFixed(2)}R/sinyal` : ""} · data uji ${B.exp_test == null ? "—" : (B.exp_test >= 0 ? "+" : "") + B.exp_test.toFixed(2) + "R"} ${B.proven ? "✅" : "⚠️ belum terbukti"}`);
    }
    for (const x of R.lines || []) L.push(x);
    L.push(`${new Date(R.now_time).toISOString().slice(0, 16).replace("T", " ")} UTC · bukan saran keuangan`);
    return L.join("\n");
  }

  // unduh kartu jadi PNG (versi diam, tanpa animasi)
  async function download(R, B) {
    const svg = card(R, B, true), url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      const hh = +((svg.match(/viewBox="0 0 \d+ (\d+)"/) || [])[1] || 690);
      const cv = document.createElement("canvas"); cv.width = 1180 * 2; cv.height = hh * 2;
      const ctx = cv.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
      const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `${R.symbol}_${R.tf}_${new Date(R.now_time).toISOString().slice(0, 16).replace(/[-:T]/g, "")}.png`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally { URL.revokeObjectURL(url); }
  }

  window.MSC = { card, signal, download };
})();

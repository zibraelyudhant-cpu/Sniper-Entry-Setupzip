"""🧪 Cek entry posisi: entry / SL / TP KAMU diuji di semua kejadian pola market structure yang sama di riwayat.

Cara kerja (tanpa intip masa depan):
1. Struktur swing sekarang dibaca seperti 🔎 Screener Market Structure (msscreen._prep) -> pola (mis. LH-LL-LH-LL).
2. Entry / SL / TP kamu diubah ke jarak ATR dari harga sekarang, lalu dipasang di tiap kejadian pola itu di riwayat
   (harga & ATR saat kejadian) -> adil antar koin & antar harga.
3. Belum kesentuh: berapa % limit terisi (dan berapa lama), lalu TP / SL mana yang kena duluan.
   Sudah masuk: langsung dicek TP / SL mana yang kena duluan dari sekarang.
4. Saran: entry / SL / TP digeser (dalam ATR) satu per satu, dicari di 70% kejadian awal, dicek di 30% terakhir.
   Ukuran: R kamu per sinyal (= hasil dibagi risiko ASLI kamu; limit tidak terisi = 0) -> geser SL tidak "menipu" R.
"""
import time

import numpy as np

from . import msscreen as MS

WAIT = 96            # candle maksimal menunggu limit terisi
HOLD = 150           # candle maksimal posisi terbuka (lewat = ditutup di close)
MIN_FILL = 15        # trade terisi minimal supaya angka dipakai
GAIN_MIN = 0.05      # saran hanya kalau R per sinyal naik minimal segini
E_GRID = [x / 4 for x in range(-6, 7) if x]            # geser entry ±1.5 ATR (0.25)
SL_GRID = [x / 4 for x in range(-3, 7) if x]           # SL lebih dekat 0.75 ... lebih jauh 1.5 ATR
TP_GRID = [x / 4 for x in range(-8, 13) if x]          # TP lebih dekat 2 ... lebih jauh 3 ATR


def _sim(h, l, c, s, e, sl, tp, d, filled, risk0):
    """Satu kejadian. Hasil None (limit tidak terisi) atau (candle sampai terisi, hasil dalam R kamu, kode, candle sampai
    selesai, kena SL lalu tetap sampai TP?, gerak maksimal searah (harga), gerak maksimal melawan (harga))."""
    n = len(c)
    if filled:
        f, first = s, s + 1
    else:
        a, b = s + 1, min(n, s + 1 + WAIT)
        if a >= b:
            return None
        below = e <= c[s]
        touch = (l[a:b] <= e) if below else (h[a:b] >= e)
        if not touch.any():
            return None
        f = a + int(np.argmax(touch))
        first = f                                          # candle terisi ikut dicek SL-nya (sama seperti backtest lain)
    end = min(n - 1, f + HOLD)
    if first > end:
        return None
    lo, hi = l[first:end + 1], h[first:end + 1]
    if d == 0:
        slh, tph = lo <= sl, hi >= tp
    else:
        slh, tph = hi >= sl, lo <= tp
    if not filled:
        tph = tph.copy()
        tph[0] = False                                     # TP di candle terisi: urutan tidak diketahui -> tidak dihitung
    isl = int(np.argmax(slh)) if slh.any() else None
    itp = int(np.argmax(tph)) if tph.any() else None
    sg = 1 if d == 0 else -1
    wick = False
    if isl is not None and (itp is None or isl <= itp):
        res, code, k = (sl - e) * sg / risk0, -1, isl
        wick = bool(tph[isl + 1:].any()) if isl + 1 < len(tph) else False
        stop = isl
    elif itp is not None:
        res, code, k = (tp - e) * sg / risk0, 1, itp
        stop = itp
    else:
        res, code, k = (c[end] - e) * sg / risk0, 0, end - first
        stop = len(lo) - 1
    seg_hi, seg_lo = hi[:stop + 1], lo[:stop + 1]
    mfe = (seg_hi.max() - e) if d == 0 else (e - seg_lo.min())
    mae = (e - seg_lo.min()) if d == 0 else (seg_hi.max() - e)
    return f - s, float(res), code, int(k), wick, float(mfe), float(mae)


def _stats(rows, n_sig):
    """rows = hasil _sim yang terisi. Angka ringkas (R dalam satuan risiko ASLI kamu)."""
    if not rows:
        return {"n_sig": n_sig, "n_fill": 0, "fill_pct": 0.0, "wr": None, "exp_r": None, "exp_sig": 0.0}
    res = np.array([r[1] for r in rows])
    code = np.array([r[2] for r in rows])
    fb = np.array([r[0] for r in rows], float)
    kb = np.array([r[3] for r in rows], float)
    return {"n_sig": n_sig, "n_fill": len(rows), "fill_pct": 100 * len(rows) / max(1, n_sig),
            "fill_bars": float(np.median(fb)), "fill_p25": float(np.percentile(fb, 25)), "fill_p75": float(np.percentile(fb, 75)),
            "wr": float(100 * (code == 1).mean()), "sl_pct": float(100 * (code == -1).mean()), "to_pct": float(100 * (code == 0).mean()),
            "exp_r": float(res.mean()), "exp_sig": float(res.sum() / max(1, n_sig)), "exit_bars": float(np.median(kb)),
            "wick_pct": float(100 * np.mean([r[4] for r in rows]))}


def check(store, symbol, tf, entry, sl, tp, filled=False, swing="kecil", scope="all", live=None, progress=None, htf="auto", live_htf=None):
    t0 = time.time()
    entry, sl, tp = float(entry), float(sl), float(tp)
    if tp > entry > sl:
        d = 0
    elif tp < entry < sl:
        d = 1
    else:
        raise ValueError("Susunan harga salah: LONG = SL < entry < TP, SHORT = TP < entry < SL")
    P_ = MS._prep(store, symbol, tf, swing, scope, live, progress, htf, live_htf)
    lc, la = P_["lc"], P_["la"]
    now, A = float(lc[-1]), float(la[-1])
    if not (A == A and A > 0):
        raise ValueError("ATR belum bisa dihitung (data terlalu sedikit)")
    # level kamu dalam ATR dari harga sekarang
    re_, rs_, rt_ = (entry - now) / A, (sl - now) / A, (tp - now) / A
    risk_atr = abs(re_ - rs_)
    occ, D_of = P_["occ"], dict(P_["hist"])
    base = MS.screen(store, symbol, tf, swing, scope, live=live, htf=htf, live_htf=live_htf)   # kartu: candle, swing, prediksi
    out = {"symbol": symbol, "tf": tf, "swing": swing, "scope": scope, "source": P_["src"], "dir": d, "filled": bool(filled),
           "entry": entry, "sl": sl, "tp": tp, "rr": abs(tp - entry) / abs(entry - sl), "now_price": now, "atr": A,
           "entry_atr": re_, "sl_atr": rs_, "tp_atr": rt_, "risk_atr": risk_atr,
           "pattern": base.get("pattern"), "len": base.get("len"), "n_occ": len(occ), "n_coins": len({o[0] for o in occ}),
           "candles": base.get("candles"), "swings_vis": base.get("swings_vis"), "now_time": base.get("now_time"),
           "pred": base.get("pred"), "proj": base.get("proj"), "filters": P_["filters"]}
    if not occ:
        out.update(elapsed=round(time.time() - t0, 1), stats=None, suggestions=[], examples=[])
        return out
    times = np.array([D_of[sym]["t"][s] for sym, s, _ in occ])
    t_split = float(np.quantile(times, 0.7))
    tr = times < t_split

    def run(de=0.0, ds=0.0, dt=0.0):
        """Semua kejadian dengan entry / SL / TP digeser (ATR; ds/dt positif = lebih jauh dari entry)."""
        sg = 1 if d == 0 else -1
        rows = []
        for sym, s, _ in occ:
            D = D_of[sym]
            h, l, c, a = D["h"], D["l"], D["c"], D["a"]
            As = a[s]
            if not (As == As and As > 0):
                rows.append(None)
                continue
            e = c[s] + (re_ + de) * As
            slp = c[s] + (rs_ - sg * ds) * As
            tpp = c[s] + (rt_ + sg * dt) * As
            if not ((d == 0 and slp < e < tpp) or (d == 1 and tpp < e < slp)):
                rows.append(None)
                continue
            rows.append(_sim(h, l, c, s, e, slp, tpp, d, filled, risk_atr * As))
        return rows

    def split(rows):
        fit = [r for r, t in zip(rows, tr) if t and r is not None]
        test = [r for r, t in zip(rows, tr) if not t and r is not None]
        return _stats(fit, int(tr.sum())), _stats(test, int((~tr).sum()))

    user = run()
    st_all = _stats([r for r in user if r is not None], len(occ))
    u_fit, u_test = split(user)
    # cerita dari data (dengan level kamu)
    fills = [r for r in user if r is not None]
    mfe = np.array([r[5] for r in fills]) if fills else np.array([])
    occA = np.array([D_of[sym]["a"][s] for sym, s, _ in occ])
    medA = float(np.median(occA[occA == occA])) if len(occA) else A
    story = {}
    if len(mfe):
        story["mfe_atr"] = float(np.median(mfe) / medA)                   # gerak maksimal searah (median), ATR
    # gerak melawan dulu: dari candle pola, seberapa jauh harga bergerak melawan arah kamu sebelum 2 ATR searah
    cm = []
    for sym, s, _ in occ:
        D = D_of[sym]
        h, l, c, a = D["h"], D["l"], D["c"], D["a"]
        As = a[s]
        if not (As == As and As > 0):
            continue
        e2 = min(len(c), s + 1 + 200)
        if d == 0:
            hit = np.flatnonzero(h[s + 1:e2] >= c[s] + 2 * As)
            j = s + 1 + (int(hit[0]) if len(hit) else e2 - s - 1)
            cm.append((c[s] - l[s + 1:j + 1].min()) / As if j >= s + 1 else 0.0)
        else:
            hit = np.flatnonzero(l[s + 1:e2] <= c[s] - 2 * As)
            j = s + 1 + (int(hit[0]) if len(hit) else e2 - s - 1)
            cm.append((h[s + 1:j + 1].max() - c[s]) / As if j >= s + 1 else 0.0)
    if cm:
        story["counter_atr"] = float(np.median(cm))
        story["counter_p75"] = float(np.percentile(cm, 75))
    # saran: tiap komponen digeser sendiri, dipilih di data cari (70%), dicek di data uji (30%)
    comps = [("tp", TP_GRID)] if filled else [("entry", E_GRID), ("sl", SL_GRID), ("tp", TP_GRID)]
    sugg, best_shift = [], {}
    for kind, grid in comps:
        best = None
        for x in grid:
            rows = run(de=x if kind == "entry" else 0.0, ds=x if kind == "sl" else 0.0, dt=x if kind == "tp" else 0.0)
            f_, t_ = split(rows)
            if f_["n_fill"] < MIN_FILL:
                continue
            # saran wajib: sering terisi (entry) dan TIDAK rugi (untung di data cari & data uji)
            if kind == "entry" and f_["fill_pct"] < MS.MIN_FILL_PCT:
                continue
            if f_["exp_sig"] <= 0 or t_["n_fill"] < 5 or t_["exp_sig"] <= 0:
                continue
            if best is None or f_["exp_sig"] > best[1]["exp_sig"]:
                best = (x, f_, t_, rows)
        if best is None or best[1]["exp_sig"] < u_fit["exp_sig"] + GAIN_MIN:
            continue
        x, f_, t_, rows = best
        sg = 1 if d == 0 else -1
        if kind == "entry":
            price = entry + x * A
        elif kind == "sl":
            price = sl - sg * x * A
        else:
            price = tp + sg * x * A
        st = _stats([r for r in rows if r is not None], len(occ))
        proven = bool(t_["n_fill"] >= 5 and t_["exp_sig"] > u_test["exp_sig"])
        sugg.append({"kind": kind, "shift_atr": x, "price": price, "stats": st, "fit": f_, "test": t_, "proven": proven})
        best_shift[kind] = x
    combined = None
    if len(best_shift) > 1:
        rows = run(de=best_shift.get("entry", 0.0), ds=best_shift.get("sl", 0.0), dt=best_shift.get("tp", 0.0))
        f_, t_ = split(rows)
        sg = 1 if d == 0 else -1
        ok_c = (f_["exp_sig"] > 0 and t_["n_fill"] >= 5 and t_["exp_sig"] > 0
                and ("entry" not in best_shift or f_["fill_pct"] >= MS.MIN_FILL_PCT))
        combined = None if not ok_c else {"entry": entry + best_shift.get("entry", 0.0) * A, "sl": sl - sg * best_shift.get("sl", 0.0) * A,
                    "tp": tp + sg * best_shift.get("tp", 0.0) * A, "stats": _stats([r for r in rows if r is not None], len(occ)),
                    "fit": f_, "test": t_, "proven": bool(t_["n_fill"] >= 5 and t_["exp_sig"] > u_test["exp_sig"])}
    for sgt in sugg:
        sgt["why"] = _why(sgt, st_all, story, d, filled, A, entry, sl, tp, now)
    # contoh kejadian (level kamu dipasang di tiap kejadian) -> Manual Replay
    ex = []
    sg = 1 if d == 0 else -1
    for (sym, s, seq), r in zip(occ, user):
        D = D_of[sym]
        As = D["a"][s]
        if not (As == As and As > 0):
            continue
        cs = D["c"][s]
        ex.append({"symbol": sym, "time": int(D["t"][s]), "entry": cs + re_ * As, "sl": cs + rs_ * As, "tp": cs + rt_ * As,
                   "filled": r is not None, "fill_bars": None if r is None else r[0], "result": None if r is None else r[1],
                   "code": None if r is None else r[2],
                   "swings": [{"time": int(D["t"][x[0]]), "price": x[1], "label": x[3]} for x in seq[-(P_["pick"] or 3):]]})
    out.update(stats=st_all, fit=u_fit, test=u_test, story=story, suggestions=sugg, combined=combined,
               examples=ex[-150:], elapsed=round(time.time() - t0, 1))
    return out


def _f(p):
    return f"{p:.6g}"


def _why(sg_, st, story, d, filled, A, entry, sl, tp, now):
    """Penjelasan saran dari angka backtest (bahasa sederhana)."""
    k, x, S2 = sg_["kind"], sg_["shift_atr"], sg_["stats"]
    up = "naik" if d == 0 else "turun"
    lawan = "turun" if d == 0 else "naik"
    pc = lambda v: "—" if v is None else f"{v:.0f}%"           # noqa: E731
    r = lambda v: "—" if v is None else f"{v:+.2f}R"          # noqa: E731
    if k == "entry":
        arah = "dinaikkan" if x > 0 else "diturunkan"
        t = f"Entry {arah} {abs(x):.2f} ATR ke {_f(sg_['price'])}"
        if abs(sg_["price"] - now) <= 0.15 * A:
            t += f" (≈ harga sekarang = {'buy' if d == 0 else 'sell'} market saja, tidak perlu menunggu limit)"
        t += ". "
        ca = story.get("counter_atr")
        if ca is not None:
            lv = now - ca * A if d == 0 else now + ca * A
            t += f"Rata-rata pola ini {lawan} dulu ±{ca:.2f} ATR (≈ {_f(lv)}) sebelum {up}. "
        jauh = (d == 0 and x < 0) or (d == 1 and x > 0)              # entry digeser searah gerakan melawan
        if jauh:
            t += "Entry lebih dekat ke ujung gerakan melawan itu = sekali sentuh lebih sering langsung berbalik ke arah kamu (lebih presisi), "
            t += "dan jarak ke SL lebih kecil. "
        elif S2["fill_pct"] > st["fill_pct"] + 5:
            t += "Entry lebih dekat ke harga sekarang = lebih sering terisi; dengan entry kamu, sebagian kejadian harga pergi tanpa menyentuh limit. "
        else:
            t += "Entry kamu terlalu dekat ke SL: harga sering menyentuh entry lalu lanjut ke SL. Entry di sini memberi ruang lebih ke SL. "
        t += f"Terisi {pc(st['fill_pct'])} → {pc(S2['fill_pct'])}, WR {pc(st['wr'])} → {pc(S2['wr'])}, hasil per sinyal {r(st['exp_sig'])} → {r(S2['exp_sig'])}."
        return t
    if k == "sl":
        jauh = x > 0
        t = f"SL {'dijauhkan' if jauh else 'didekatkan'} {abs(x):.2f} ATR ke {_f(sg_['price'])}. "
        if jauh:
            t += (f"{pc(st.get('wick_pct'))} trade kamu kena SL dulu lalu harga tetap sampai TP (kena wick / gocekan). "
                  f"SL lebih jauh melewati daerah wick itu: kena wick {pc(st.get('wick_pct'))} → {pc(S2.get('wick_pct'))}. ")
        else:
            t += "Harga jarang balik sejauh SL kamu; SL lebih dekat = rugi lebih kecil saat salah tanpa banyak menambah kena SL. "
        t += f"WR {pc(st['wr'])} → {pc(S2['wr'])}, hasil per sinyal {r(st['exp_sig'])} → {r(S2['exp_sig'])} (dalam R risiko kamu sekarang)."
        return t
    jauh = x > 0
    t = f"TP {'dijauhkan' if jauh else 'didekatkan'} {abs(x):.2f} ATR ke {_f(sg_['price'])}. "
    m = story.get("mfe_atr")
    if m is not None:
        lv = entry + m * A if d == 0 else entry - m * A
        t += f"Median gerak maksimal searah setelah entry ±{m:.2f} ATR (≈ {_f(lv)}). "
    t += ("Data menunjukkan harga sering " + up + " tajam melewati TP kamu → TP lebih jauh = untung maksimal. " if jauh
          else "TP kamu sering tidak tercapai lalu harga balik → TP lebih dekat = lebih sering kena. ")
    t += f"Kena TP {pc(st['wr'])} → {pc(S2['wr'])}, hasil per sinyal {r(st['exp_sig'])} → {r(S2['exp_sig'])}."
    return t

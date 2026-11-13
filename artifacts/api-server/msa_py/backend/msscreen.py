"""🔎 Screener Market Structure: struktur SEKARANG 1 koin (live Binance, cadangan data lokal) -> cari pola swing yang
sama di riwayat (data lokal, semua koin / koin ini) -> biasanya lanjut ke mana + entry / SL / TP terbaik (RR >= 1:3)
diterapkan ke harga sekarang.

- Swing fractal k (kecil 3 / sedang 5 / besar 10), diketahui k candle sesudahnya; urutan selang-seling high/low.
- Label dasar: HH / LH (high sama tinggi dihitung LH), HL / LL (low sama dihitung HL).
- Pola = L swing terakhir saat swing terbaru terkonfirmasi. L otomatis: 6 -> 5 -> 4 -> 3 sampai kejadian di riwayat >= MIN_OCC.
- Entry / SL / hasil memakai aturan yang SAMA dengan Penemu Strategi (stratlab): entry market / fib 0.382-0.786 / retest BOS,
  SL di balik swing terakhir / ujung pola, limit berlaku FILL_WAIT candle, lama trade maks HOLD candle.
"""
import time

import numpy as np

from . import stratlab as SL
from .data import TF_MS
from .indicators import atr as _atr, pivots

SWINGS = {"kecil": 3, "sedang": 5, "besar": 10}
EQ_TOL = 0.1
LENS = (6, 5, 4, 3)
MIN_OCC = 30
MIN_FILL = 15
MIN_FILL_PCT = 70.0              # sinyal hanya dari entry yang di riwayat TERISI >= 70% (market = 100%)
RRS = [3.0, 4.0, 5.0]            # RR minimal 1:3
MOVE_ATR = 2.0                   # "arah selanjutnya" = mana duluan: +2 ATR atau -2 ATR dari close
N_PATH = 40                      # jalur harga sesudah pola (candle) untuk animasi prediksi
_CACHE = {}                      # (sym, tf, k, n, last_t) -> kejadian per koin


def events(h, l, c, a, k):
    """[(s, seq)] — seq = 8 swing terakhir [(idx, harga, 'H'/'L', label)] yang DIKETAHUI saat candle s close."""
    hi_i, lo_i = pivots(h, l, k)
    ev = sorted([(int(i) + k, int(i), "H") for i in hi_i] + [(int(i) + k, int(i), "L") for i in lo_i])
    seq, out = [], []
    for s, p, typ in ev:
        if s >= len(c):
            continue
        price = float(h[p] if typ == "H" else l[p])
        if seq and seq[-1][2] == typ:
            if (typ == "H" and price <= seq[-1][1]) or (typ == "L" and price >= seq[-1][1]):
                continue
            seq.pop()
        prev = next((x for x in reversed(seq) if x[2] == typ), None)
        lab = None
        if prev is not None:
            if typ == "H":
                lab = "HH" if price > prev[1] + EQ_TOL * (a[p] if a[p] == a[p] else 0) else "LH"
            else:
                lab = "LL" if price < prev[1] - EQ_TOL * (a[p] if a[p] == a[p] else 0) else "HL"
        seq.append((p, price, typ, lab))
        seq = seq[-8:]
        out.append((s, list(seq)))
    return out


def _labels(seq, L):
    labs = [x[3] for x in seq[-L:]]
    return None if len(labs) < L or any(x is None for x in labs) else tuple(labs)


def _first_move(h, l, c, a, s, horizon=200):
    """+1 kalau harga naik MOVE_ATR x ATR duluan dari close s, -1 kalau turun duluan, 0 belum / tidak jelas."""
    A = a[s]
    if not (A == A) or A <= 0:
        return 0, None
    up, dn = c[s] + MOVE_ATR * A, c[s] - MOVE_ATR * A
    e = min(len(c), s + 1 + horizon)
    hu = np.flatnonzero(h[s + 1:e] >= up)
    hd = np.flatnonzero(l[s + 1:e] <= dn)
    iu = int(hu[0]) if len(hu) else None
    idn = int(hd[0]) if len(hd) else None
    if iu is None and idn is None:
        return 0, None
    if idn is None or (iu is not None and iu < idn):
        return 1, iu + 1
    if iu is None or idn < iu:
        return -1, idn + 1
    return 0, None                                            # di candle yang sama: tidak jelas


def coin_events(store, sym, tf, k, n_max=200_000):
    b = store.get(sym, tf)
    t = np.asarray(b.t)
    key = (sym, tf, k, len(t), int(t[-1]) if len(t) else 0)
    if key in _CACHE:
        return _CACHE[key]
    h, l, c = (np.asarray(x, float)[-n_max:] for x in (b.h, b.l, b.c))
    t = t[-n_max:]
    a = _atr(h, l, c, 14)
    ev = events(h, l, c, a, k)
    out = {"t": t, "h": h, "l": l, "c": c, "a": a, "ev": ev}
    if len(_CACHE) > 150:          # v26: batas diturunkan dari 600 (persetujuan user, hanya cache kecepatan)
        _CACHE.clear()
    _CACHE[key] = out
    return out


DIPS = (0.5, 1.0, 1.5)           # entry limit X ATR di bawah (LONG) / di atas (SHORT) close saat pola terkonfirmasi


def _entry_txt(en, d):
    if en.startswith("atr"):
        return f"limit {en[3:]} ATR {'di bawah' if d == 0 else 'di atas'} harga saat pola terkonfirmasi"
    return SL.ENTRY_TXT[en]


def _entries(d, seq, s, h, l, c, a):
    """Entry Penemu Strategi (market / fib / retest) + limit X ATR dari close."""
    r = SL._entries(d, seq, s, h, l, c, a)
    if r is None:
        return None
    E, base, ext = r
    A = a[s]
    for x in DIPS:
        lv = c[s] - x * A if d == 0 else c[s] + x * A
        if (d == 0 and lv > base) or (d == 1 and lv < base):
            E[f"atr{x:g}"] = float(lv)
    return E, base, ext


def _stops(d, seq_pat, base, A):
    far = (min([x[1] for x in seq_pat if x[2] == "L"] or [base]) if d == 0 else max([x[1] for x in seq_pat if x[2] == "H"] or [base]))
    return {"swing": base - SL.SL_BUF * A if d == 0 else base + SL.SL_BUF * A,
            "pola": min(base, far) - SL.SL_BUF * A if d == 0 else max(base, far) + SL.SL_BUF * A}


HTF_AUTO = {"1m": "15m", "3m": "15m", "5m": "1h", "15m": "4h", "30m": "4h", "1h": "1d", "2h": "1d", "4h": "1d",
            "6h": "1d", "8h": "1d", "12h": "1d", "1d": None}
BASE_PER_COIN = 400        # kejadian swing per koin untuk pembanding (diambil merata, di-cache)
SIM_KEEP = 0.5             # "leg mirip" = separuh kejadian yang ukuran leg-nya paling mirip (minimal MIN_OCC)
MIN_TEST = 10              # kejadian data uji minimal supaya filter bisa dinilai


def resolve_htf(tf, htf):
    """TF besar yang dipakai: "auto" -> HTF_AUTO, "off" -> None, atau TF pilihan (harus lebih besar dari tf)."""
    H = HTF_AUTO.get(tf) if htf in (None, "", "auto") else (None if htf == "off" else htf)
    return H if H and H in TF_MS and tf in TF_MS and TF_MS[H] > TF_MS[tf] else None


def _trend(seq):
    """Tren dari struktur: naik = high terakhir HH & low terakhir HL; turun = LH & LL; lainnya campur."""
    hh = next((x[3] for x in reversed(seq) if x[2] == "H" and x[3]), None)
    lw = next((x[3] for x in reversed(seq) if x[2] == "L" and x[3]), None)
    if hh == "HH" and lw == "HL":
        return "naik"
    if hh == "LH" and lw == "LL":
        return "turun"
    return "campur" if hh and lw else None


def _htf_trend_at(D, close_ms):
    """Tren TF besar yang sudah DIKETAHUI pada waktu close_ms (event HTF dipakai setelah candle konfirmasinya close)."""
    ev, t = D["ev"], D["t"]
    if not ev:
        return None
    if "_evt" not in D:
        step = int(t[1] - t[0]) if len(t) > 1 else 0
        D["_evt"] = np.array([t[s] + step for s, _ in ev])          # waktu close candle konfirmasi
    i = int(np.searchsorted(D["_evt"], close_ms, side="right")) - 1
    return _trend(ev[i][1]) if i >= 0 else None


def _legs(seq, L, a_ref):
    """Ukuran leg antar swing pola (dalam ATR), bertanda: + naik, - turun."""
    pts = seq[-L:]
    return np.array([(pts[i + 1][1] - pts[i][1]) / a_ref for i in range(len(pts) - 1)]) if a_ref and a_ref == a_ref else None


def _baseline(store, sym, tf, k):
    """Pembanding: arah gerak 2 ATR duluan setelah swing APA PUN (bukan hanya pola ini) di koin & TF yang sama."""
    D = coin_events(store, sym, tf, k)
    if "_base" in D:
        return D["_base"]
    n = len(D["c"])
    idx = [s for s, _ in D["ev"] if s + 200 < n]
    if len(idx) > BASE_PER_COIN:
        idx = [idx[int(i)] for i in np.linspace(0, len(idx) - 1, BASE_PER_COIN)]
    up = dn = 0
    for s in idx:
        d_, _ = _first_move(D["h"], D["l"], D["c"], D["a"], s)
        up += d_ == 1
        dn += d_ == -1
    D["_base"] = (up, dn)
    return D["_base"]


def _prep(store, symbol, tf, swing, scope, live, progress, htf="auto", live_htf=None):
    """Struktur sekarang + kejadian pola yang sama di riwayat (dipakai Screener & Cek entry posisi).
    Lalu: pembanding (arah normal), tren TF besar & kemiripan ukuran leg -> kombinasi yang paling tepat di 30% data
    terakhir dipakai untuk semua angka sesudahnya."""
    if tf not in TF_MS:
        raise ValueError("TF tidak dikenal")
    k = SWINGS.get(swing, 3)
    src = "binance"
    if live is None:
        src = "lokal"
        b = store.get(symbol, tf)
        lt, lh, ll, lc = (np.asarray(x, float)[-1500:] for x in (b.t, b.h, b.l, b.c))
        lo_ = np.asarray(b.o, float)[-1500:]
    else:
        lt, lo_, lh, ll, lc = (np.asarray(x, float) for x in live)
    la = _atr(lh, ll, lc, 14)
    lev = events(lh, ll, lc, la, k)
    if not lev:
        raise ValueError("struktur belum terbentuk (data terlalu sedikit)")
    s_now, seq_now = lev[-1]
    # riwayat
    syms = [symbol] if scope == "coin" else [x for x in store.symbols() if tf in store.timeframes(x)]
    hist = []
    for i, sym in enumerate(syms):
        if progress:
            progress(i, len(syms), sym, None)
        try:
            hist.append((sym, coin_events(store, sym, tf, k)))
        except (ValueError, KeyError, OSError):
            continue
    # panjang pola otomatis
    pick, occ = None, []
    for L in LENS:
        want = _labels(seq_now, L)
        if want is None:
            continue
        found = []
        for sym, D in hist:
            n = len(D["c"])
            for s, seq in D["ev"]:
                if s + SL.HOLD + SL.FILL_WAIT >= n:
                    continue
                if _labels(seq, L) == want:
                    found.append((sym, s, seq))
        if len(found) >= MIN_OCC or L == LENS[-1]:
            pick, occ = L, found
            break
        if pick is None:
            pick, occ = L, found
    want = _labels(seq_now, pick)
    flt = _filters(store, symbol, tf, k, hist, occ, pick, lt, lh, ll, lc, la, s_now, seq_now, htf, live_htf)
    occ = flt.pop("_occ")
    return {"k": k, "src": src, "lt": lt, "lo": lo_, "lh": lh, "ll": ll, "lc": lc, "la": la, "s_now": s_now, "seq_now": seq_now,
            "hist": hist, "pick": pick, "occ": occ, "want": want, "filters": flt}


def _filters(store, symbol, tf, k, hist, occ, pick, lt, lh, ll, lc, la, s_now, seq_now, htf, live_htf):
    """1) pembanding, 2) tren TF besar, 3) leg mirip. Tiap kombinasi dinilai di 30% kejadian terakhir:
    arah mayoritas dari 70% awal dipakai menebak 30% terakhir -> % tebakan benar. Yang terbaik dipakai."""
    D_of = dict(hist)
    step = TF_MS[tf]
    # pembanding (koin-koin riwayat yang sama)
    bu = bd = 0
    for sym in {o[0] for o in occ} or {symbol}:
        try:
            u, d_ = _baseline(store, sym, tf, k)
        except (ValueError, KeyError, OSError):
            continue
        bu, bd = bu + u, bd + d_
    base = {"up": bu, "down": bd, "pct_up": 100 * bu / max(1, bu + bd), "pct_down": 100 * bd / max(1, bu + bd)}
    out = {"base": base, "htf": None, "htf_now": None, "legs_now": None, "mode": "pola", "modes": []}
    if not occ:
        out["_occ"] = occ
        return out
    # arah duluan tiap kejadian + waktu
    info = []
    for sym, s, seq in occ:
        D = D_of[sym]
        d_, _ = _first_move(D["h"], D["l"], D["c"], D["a"], s)
        info.append((d_, D["t"][s]))
    times = np.array([x[1] for x in info], float)
    t_split = float(np.quantile(times, 0.7))
    # 2) tren TF besar
    H = resolve_htf(tf, htf)
    htf_now, tr_of = None, None
    if H:
        try:
            if live_htf is not None:
                ht, hh_, hl_, hc_ = (np.asarray(x, float) for x in (live_htf[0], live_htf[2], live_htf[3], live_htf[4]))
                ha = _atr(hh_, hl_, hc_, 14)
                ev = events(hh_, hl_, hc_, ha, 3)
                htf_now = _trend(ev[-1][1]) if ev else None
            else:
                Dn = coin_events(store, symbol, H, 3)
                htf_now = _htf_trend_at(Dn, float(lt[-1]) + step)
        except (ValueError, KeyError, OSError, IndexError):
            htf_now = None
        tr_of = []
        cache = {}
        for sym, s, _ in occ:
            if sym not in cache:
                try:
                    cache[sym] = coin_events(store, sym, H, 3)
                except (ValueError, KeyError, OSError):
                    cache[sym] = None
            Dh = cache[sym]
            tr_of.append(_htf_trend_at(Dh, float(D_of[sym]["t"][s]) + step) if Dh is not None else None)
    out["htf"], out["htf_now"] = H, htf_now
    # 3) ukuran leg (ATR) -> jarak ke sekarang
    legs_now = _legs(seq_now, pick, la[s_now])
    dist = None
    if legs_now is not None and len(legs_now):
        dist = []
        for sym, s, seq in occ:
            lg = _legs(seq, pick, D_of[sym]["a"][s])
            dist.append(float(np.abs(lg - legs_now).mean()) if lg is not None and len(lg) == len(legs_now) else np.inf)
        dist = np.array(dist)
        out["legs_now"] = [round(float(x), 2) for x in legs_now]

    def score(mask):
        idx = np.flatnonzero(mask)
        fit = [info[i][0] for i in idx if times[i] < t_split and info[i][0]]
        tst = [info[i][0] for i in idx if times[i] >= t_split and info[i][0]]
        allm = [info[i][0] for i in idx if info[i][0]]
        up = sum(1 for x in allm if x == 1)
        res = {"n": int(len(idx)), "pct_up": 100 * up / max(1, len(allm)), "pct_down": 100 * (len(allm) - up) / max(1, len(allm)),
               "n_test": len(tst), "test_hit": None}
        if fit and tst:
            maj = 1 if sum(1 for x in fit if x == 1) >= len(fit) / 2 else -1
            res["test_hit"] = 100 * sum(1 for x in tst if x == maj) / len(tst)
        return res
    allmask = np.ones(len(occ), bool)
    cands = [("pola", allmask)]
    if tr_of is not None and htf_now:
        hm = np.array([t == htf_now for t in tr_of])
        cands.append(("pola + tren " + H.upper(), hm))
    if dist is not None and np.isfinite(dist).any():
        kkeep = max(MIN_OCC, int(np.ceil(SIM_KEEP * np.isfinite(dist).sum())))
        thr = np.sort(dist[np.isfinite(dist)])[min(kkeep, int(np.isfinite(dist).sum())) - 1]
        sm = dist <= thr
        cands.append(("pola + leg mirip", sm))
        if tr_of is not None and htf_now:
            cands.append(("pola + tren " + H.upper() + " + leg mirip", sm & np.array([t == htf_now for t in tr_of])))
    best_name, best_sc = "pola", None
    for name, m in cands:
        sc = score(m)
        sc["name"] = name
        ok = sc["n"] >= MIN_OCC and sc["n_test"] >= MIN_TEST and sc["test_hit"] is not None
        sc["eligible"] = bool(ok)
        out["modes"].append(sc)
        if name == "pola":
            best_sc = sc
            continue
        # filter dipakai hanya kalau tebakan di data uji LEBIH tepat (minimal +2%) dan sampel cukup
        if ok and best_sc and best_sc.get("test_hit") is not None and sc["test_hit"] >= best_sc["test_hit"] + 2:
            best_name, best_sc = name, sc
    out["mode"] = best_name
    mask = dict(cands)[best_name]
    out["_occ"] = [o for o, m in zip(occ, mask) if m]
    out["n_all"] = len(occ)
    return out


def screen(store, symbol, tf, swing="kecil", scope="all", live=None, progress=None, htf="auto", live_htf=None):
    """live = (t, o, h, l, c) candle TERTUTUP terbaru dari Binance (atau None -> data lokal koin itu).
    htf = TF besar untuk filter tren ("auto", "off", atau TF mis. "4h"); live_htf = candle TF besar dari Binance."""
    t0 = time.time()
    P_ = _prep(store, symbol, tf, swing, scope, live, progress, htf, live_htf)
    src, lt, lo_, lh, ll, lc, la = P_["src"], P_["lt"], P_["lo"], P_["lh"], P_["ll"], P_["lc"], P_["la"]
    s_now, seq_now, hist, pick, occ, want = P_["s_now"], P_["seq_now"], P_["hist"], P_["pick"], P_["occ"], P_["want"]
    if not occ:
        return {"symbol": symbol, "tf": tf, "swing": swing, "source": src, "pattern": list(want or []), "len": pick, "n_occ": 0,
                "filters": P_["filters"],
                "elapsed": round(time.time() - t0, 1), **_visual(lt, lo_, lh, ll, lc, la, seq_now, s_now, None, None)}
    times = np.array([dict(hist)[sym]["t"][s] for sym, s, _ in occ])
    t_split = float(np.quantile(times, 0.7))
    nxt, fm, fm_bars = {}, [], {1: [], -1: []}
    paths = []                                                   # (arah duluan, close/high/low relatif dalam ATR, N_PATH candle)
    acc = {}
    D_of = dict(hist)
    examples = []
    for sym, s, seq in occ:
        D = D_of[sym]
        h, l, c, a, t = D["h"], D["l"], D["c"], D["a"], D["t"]
        A = a[s]
        # swing berikutnya
        evs = D["ev"]
        j = next((ii for ii, (ss, _) in enumerate(evs) if ss == s), None)
        if j is not None and j + 1 < len(evs):
            ns, nseq = evs[j + 1]
            last = nseq[-1]
            lab = last[3] or "?"
            nxt[lab] = nxt.get(lab, 0) + 1
        d_, b_ = _first_move(h, l, c, a, s)
        fm.append(d_)
        if d_:
            fm_bars[d_].append(b_)
        if A == A and A > 0 and s + N_PATH < len(c):
            seg = slice(s + 1, s + 1 + N_PATH)
            paths.append((d_, (c[seg] - c[s]) / A, (h[seg] - c[s]) / A, (l[seg] - c[s]) / A, sym, int(t[s])))
        te = t[s] >= t_split
        for d in (0, 1):
            r = _entries(d, seq, s, h, l, c, a)
            if r is None:
                continue
            E, base, ext = r
            stops = _stops(d, seq[-pick:], base, A)
            for en, e in E.items():
                f = SL._fill(d, s, e, ext, h, l, en)
                for sk, slp in stops.items():
                    risk = (e - slp) if d == 0 else (slp - e)
                    if not (SL.MIN_RISK * A <= risk <= SL.MAX_RISK * A):
                        continue
                    res = None if f is None else SL._outcome(d, f, e, slp, RRS, h, l, c, en == "market")
                    for ri, rr in enumerate(RRS):
                        X = acc.setdefault((d, en, sk, rr), {"sig": 0, "fill": 0, "w": 0, "r": 0.0, "fillt": 0, "wt": 0, "rt": 0.0})
                        X["sig"] += 1
                        if res is not None:
                            R_, code, _ = res[ri]
                            X["fillt" if te else "fill"] += 1
                            X["wt" if te else "w"] += code == 1
                            X["rt" if te else "r"] += R_
        if len(examples) < 400:
            examples.append({"symbol": sym, "time": int(t[s]), "first_move": d_,
                             "swings": [{"time": int(t[x[0]]), "price": x[1], "label": x[3]} for x in seq[-pick:]]})
    rules = []
    for (d, en, sk, rr), X in acc.items():
        nf = X["fill"] + X["fillt"]
        if X["fill"] < MIN_FILL:
            continue
        ex, wr = X["r"] / X["fill"], 100 * X["w"] / X["fill"]
        ext = X["rt"] / X["fillt"] if X["fillt"] else None
        wrt = 100 * X["wt"] / X["fillt"] if X["fillt"] else None
        fp = 100 * nf / X["sig"] if X["sig"] else 0.0
        rules.append({"dir": d, "entry": en, "sl": sk, "rr": rr, "n": X["fill"], "wr": wr, "exp_r": ex, "n_test": X["fillt"], "wr_test": wrt,
                      "exp_test": ext, "fill_pct": fp,
                      # R per SINYAL = R per trade x peluang terisi: limit yang jarang tersentuh tidak boleh menang hanya karena
                      # hasilnya bagus di sedikit kejadian yang terisi (sisanya harga pergi tanpa kita)
                      "exp_sig": ex * fp / 100,
                      "entry_txt": _entry_txt(en, d), "sl_txt": SL.SL_TXT[sk],
                      "proven": bool(ex > 0 and ext is not None and ext > 0 and X["fillt"] >= 5)})
    rules.sort(key=lambda r: (not r["proven"], -r["exp_sig"]))
    fm = np.array(fm)
    up, dn = int((fm == 1).sum()), int((fm == -1).sum())
    pred = {"up": up, "down": dn, "unclear": int((fm == 0).sum()), "pct_up": 100 * up / max(1, up + dn), "pct_down": 100 * dn / max(1, up + dn),
            "next": sorted([{"label": k_, "n": v, "pct": 100 * v / sum(nxt.values())} for k_, v in nxt.items()], key=lambda x: -x["n"]) if nxt else [],
            "move_atr": MOVE_ATR,
            "bars_up": float(np.median(fm_bars[1])) if fm_bars[1] else None,
            "bars_down": float(np.median(fm_bars[-1])) if fm_bars[-1] else None}
    # 1) pembanding: arah normal setelah swing apa pun -> keunggulan pola & apakah meyakinkan (uji binomial kasar)
    B0 = P_["filters"]["base"]
    if B0["up"] + B0["down"] and up + dn:
        p0 = B0["pct_up"] / 100
        maj_up = pred["pct_up"] >= 50
        edge = (pred["pct_up"] - B0["pct_up"]) if maj_up else (pred["pct_down"] - B0["pct_down"])
        z = abs(pred["pct_up"] / 100 - p0) / max(1e-9, (p0 * (1 - p0) / (up + dn)) ** 0.5)
        pred.update(base_up=B0["pct_up"], base_down=B0["pct_down"], edge=edge, z=float(z),
                    edge_txt="meyakinkan" if z >= 2 and edge > 0 else "lemah" if z >= 1 and edge > 0 else "bisa kebetulan")
    # jalur prediksi dari riwayat: median kejadian yang arahnya sama dengan mayoritas + pita 25-75% semua kejadian
    if paths:
        maj = 1 if pred["pct_up"] >= 50 else -1
        grp = [x for x in paths if x[0] == maj] or paths
        Cm, Hm, Lm = (np.array([x[i] for x in grp]) for i in (1, 2, 3))
        Ca = np.array([x[1] for x in paths])
        pred["path"] = {"dir": maj, "n": len(grp), "n_all": len(paths),
                        "close": np.median(Cm, 0).round(3).tolist(), "high": np.median(Hm, 0).round(3).tolist(),
                        "low": np.median(Lm, 0).round(3).tolist(),
                        "p25": np.percentile(Ca, 25, 0).round(3).tolist(), "p75": np.percentile(Ca, 75, 0).round(3).tolist()}
        # contoh nyata paling mirip median (dipakai untuk candle bayangan: naik-turunnya asli dari riwayat)
        med = np.median(Cm, 0)
        k = int(np.argmin([np.abs(x[1] - med).mean() for x in grp]))
        ex = grp[k]
        pred["path"]["real"] = {"symbol": ex[4], "time": ex[5], "close": np.round(ex[1], 3).tolist(),
                                "high": np.round(ex[2], 3).tolist(), "low": np.round(ex[3], 3).tolist()}
    # terapkan ke sekarang: aturan terbaik yang bisa dipakai di struktur sekarang (per arah)
    plans = []
    for d in (0, 1):
        r = _entries(d, seq_now, s_now, lh, ll, lc, la)
        if r is None:
            continue
        E, base, ext = r
        A = la[s_now]
        stops = _stops(d, seq_now[-pick:], base, A)
        cand = []
        for rule in [x for x in rules if x["dir"] == d]:
            if rule["entry"] not in E:
                continue
            e, slp = E[rule["entry"]], stops[rule["sl"]]
            risk = (e - slp) if d == 0 else (slp - e)
            if not (SL.MIN_RISK * A <= risk <= SL.MAX_RISK * A):
                continue
            tp = e + rule["rr"] * risk if d == 0 else e - rule["rr"] * risk
            age = len(lc) - 1 - s_now
            status, live = _status(d, rule["entry"], e, slp, tp, ext, s_now, lh, ll, age)
            fill_ok = rule["entry"] == "market" or (rule["fill_pct"] or 0) >= MIN_FILL_PCT
            profit_ok = bool(rule["exp_sig"] > 0 and rule["proven"])          # untung DAN tetap untung di data uji
            why = None if live and fill_ok and profit_ok else (
                status if not live else f"jarang terisi ({rule['fill_pct']:.0f}% < {MIN_FILL_PCT:.0f}%)" if not fill_ok
                else "rata-rata rugi" if rule["exp_sig"] <= 0 else "rugi di data uji (belum terbukti)")
            exp_t = int(lt[s_now] + (SL.FILL_WAIT + 1) * TF_MS[tf]) if rule["entry"] != "market" else None
            cand.append({**rule, "price_entry": float(e), "price_sl": float(slp), "price_tp": float(tp), "risk_pct": float(risk / e * 100),
                         "age": int(age), "status": status, "live": live, "fill_ok": bool(fill_ok), "profit_ok": profit_ok,
                         "usable": why is None, "why_not": why, "expires": exp_t})
        if cand:                                                     # utamakan yang bisa dipasang (berlaku, sering terisi, untung)
            plans.append(next((x for x in cand if x["usable"]), next((x for x in cand if x["live"] and x["profit_ok"]), cand[0])))
    plans.sort(key=lambda p: (not p["usable"], not p["live"], not p["proven"], -p["exp_sig"]))
    # sinyal utama hanya setup yang masih berlaku, SERING TERISI (>= 70%) dan TIDAK RUGI (untung + terbukti di data uji)
    best = next((p for p in plans if p["usable"]), None)
    last = None if best else (plans[0] if plans else None)
    vis = _visual(lt, lo_, lh, ll, lc, la, seq_now, s_now, best, pred)
    return {"symbol": symbol, "tf": tf, "swing": swing, "scope": scope, "source": src, "pattern": list(want), "len": pick,
            "n_occ": len(occ), "n_coins": len({o[0] for o in occ}), "pred": pred, "rules": rules[:20], "plans": plans, "best": best,
            "filters": P_["filters"],
            "last_plan": last,
            "examples": examples[-150:], "now_time": int(lt[-1]), "now_price": float(lc[-1]), "confirm_time": int(lt[s_now]),
            "elapsed": round(time.time() - t0, 1), **vis}


def _status(d, en, e, sl, tp, ext, s, h, l, age):
    """Status rencana di harga sekarang -> (teks, masih_bisa_dipakai)."""
    seg_h, seg_l = h[s + 1:], l[s + 1:]
    if en == "market":
        f = s
    else:
        touch = (seg_l <= e) if d == 0 else (seg_h >= e)
        run = (seg_h > ext) if d == 0 else (seg_l < ext)
        it = int(np.argmax(touch)) if touch.any() else None
        ir = int(np.argmax(run)) if run.any() else None
        if it is None:
            if ir is not None:
                return ("batal (harga sudah membuat high baru)" if d == 0 else "batal (harga sudah membuat low baru)"), False
            if age > SL.FILL_WAIT:
                return "kedaluwarsa (limit tidak tersentuh)", False
            return "aktif · limit belum tersentuh", True
        if ir is not None and ir <= it:
            return ("batal (high baru sebelum limit tersentuh)" if d == 0 else "batal (low baru sebelum limit tersentuh)"), False
        f = s + 1 + it
    # sudah masuk: cek SL / TP sesudahnya (candle terisi ikut dicek SL-nya, sama seperti backtest)
    hh, ll_ = h[f:], l[f:]
    hit_sl = (ll_ <= sl) if d == 0 else (hh >= sl)
    hit_tp = (hh[1:] >= tp) if d == 0 else (ll_[1:] <= tp)
    isl = int(np.argmax(hit_sl)) if hit_sl.any() else None
    itp = int(np.argmax(hit_tp)) + 1 if hit_tp.any() else None
    if isl is not None and (itp is None or isl <= itp):
        return "selesai: kena SL", False
    if itp is not None:
        return "selesai: sudah kena TP", False
    if en == "market":
        return ("aktif · entry market sekarang" if age <= 3 else f"berjalan · market {age} candle lalu"), age <= 3
    return "berjalan · limit sudah terisi", False


def _visual(t, o, h, l, c, a, seq, s, best, pred, nbar=150):
    n = len(c)
    a0 = max(0, n - nbar)
    cand = [[int(t[i]), float(o[i]), float(h[i]), float(l[i]), float(c[i])] for i in range(a0, n)]
    sw = [{"time": int(t[x[0]]), "price": x[1], "label": x[3] or ("H" if x[2] == "H" else "L")} for x in seq if x[0] >= a0]
    proj = None
    if pred and (pred["up"] + pred["down"]):
        up = pred["pct_up"] >= 50
        A = a[-1] if a[-1] == a[-1] else 0
        bars = pred["bars_up"] if up else pred["bars_down"]
        if A and bars:
            dt = int(t[-1] - t[-2]) if n > 1 else 0
            proj = {"from_time": int(t[-1]), "from_price": float(c[-1]), "to_time": int(t[-1] + max(2, int(bars)) * dt),
                    "to_price": float(c[-1] + (1 if up else -1) * MOVE_ATR * A), "pct": pred["pct_up"] if up else pred["pct_down"],
                    "dir": 1 if up else -1, "bars": float(bars)}
    if proj is not None and pred.get("path"):
        proj["path"] = pred["path"]
        proj["atr"] = float(A)
    return {"candles": cand, "swings_vis": sw, "proj": proj}

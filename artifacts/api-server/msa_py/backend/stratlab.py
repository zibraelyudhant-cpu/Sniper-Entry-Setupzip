"""🧠 Penemu Strategi (v4, price action murni): pola MARKET STRUCTURE -> entry, SL & TP terbaik.

Cara kerja (semua dari candle yang SUDAH close, tanpa intip masa depan):
1. Swing high / low (fractal 3) di TF yang dipilih (single TF). Swing baru diketahui 3 candle setelahnya.
   Urutan swing dibuat selang-seling high / low. Tiap swing diberi label dibanding swing sejenis sebelumnya:
   high: HH (lebih tinggi), LH (lebih rendah), EH (sama tinggi = double top), XH (sweep high: ekor menembus high
   sebelumnya tapi close di bawahnya); low: HL, LL, EL (double bottom), XL (sweep low).
2. POLA = 3 atau 4 swing terakhir saat swing terbaru terkonfirmasi (mis. LH > XL > HL > HH).
3. Untuk tiap kejadian pola, dicoba LONG & SHORT dengan:
   ENTRY : market (close saat pola terkonfirmasi), limit di fib 0.382 / 0.5 / 0.618 / 0.786 dari leg terakhir,
           atau limit retest level yang baru ditembus (BOS).
           Leg LONG = swing low terakhir -> high tertinggi sesudahnya; SHORT kebalikannya.
   SL    : di balik swing terakhir (ujung leg) atau di balik titik terjauh pola, + 0.1 ATR.
   TP    : RR dari user (mis. 2 dan 3).
   Limit berlaku maksimal FILL_WAIT candle, batal kalau harga lebih dulu membuat high (LONG) / low (SHORT) baru.
   Setelah terisi: SL / TP mana duluan (candle terisi ikut dicek SL-nya; TP & SL di candle sama = kalah).
   Belum kena sampai HOLD candle = ditutup di harga close (nilai R apa adanya).
4. 70% data awal untuk mencari, 30% terakhir untuk menguji. Pola lolos kalau untung di keduanya, lebih baik dari
   aturan entry/SL yang sama di SEMUA pola (dasar), dan (>= 3 koin) untung di >= 60% koin.
"""
import math
import time

import numpy as np

from .data import TF_MS
from .indicators import atr as _atr, pivots

FRACTAL = 3
EQ_TOL = 0.15          # ATR: dua swing dianggap sama tinggi (double top / bottom)
SL_BUF = 0.1           # ATR di balik swing
MIN_LEG = 1.0          # ATR: leg minimal supaya fib bermakna
MIN_RISK = 0.2         # ATR: jarak SL minimal
MAX_RISK = 8.0         # ATR: jarak SL maksimal
FILL_WAIT = 48         # candle: umur limit
HOLD = 200             # candle: lama trade maksimal
MIN_N = 30             # trade terisi minimal supaya ditampilkan
LENS = (3, 4)          # panjang pola (jumlah swing)
FIBS = (0.382, 0.5, 0.618, 0.786)
ENTRIES = ("market",) + tuple(f"fib{f}" for f in FIBS) + ("retest",)
SLS = ("swing", "pola")
LBL = {"HH": "HH", "LH": "LH", "EH": "double top", "XH": "sweep high", "HL": "HL", "LL": "LL", "EL": "double bottom",
       "XL": "sweep low"}
ENTRY_TXT = {"market": "market saat pola terkonfirmasi (close candle)", "retest": "limit di retest level yang baru ditembus (BOS)",
             **{f"fib{f}": f"limit di fib {f} leg terakhir" for f in FIBS}}
SL_TXT = {"swing": "di balik swing terakhir (ujung leg) + 0.1 ATR", "pola": "di balik titik terjauh pola + 0.1 ATR"}
DEFAULTS = {"tf": "15m", "rrs": "2, 3", "min_wr": 0, "start": None, "end": None, "top": 40}
VERSION = 4


def _params(p):
    q = dict(DEFAULTS, **{k: v for k, v in (p or {}).items() if k in DEFAULTS})
    if q["tf"] not in TF_MS:
        raise ValueError("TF tidak dikenal")
    q["min_wr"] = float(min(max(float(q.get("min_wr") or 0), 0), 100))
    rr = q.get("rrs")
    if isinstance(rr, (int, float)):
        rr = [rr]
    if isinstance(rr, str):
        rr = [x for x in rr.replace(";", ",").split(",") if x.strip()]
    try:
        q["rrs"] = sorted({round(min(max(float(x), 0.5), 10.0), 2) for x in (rr or [2, 3])})[:4]
    except (TypeError, ValueError):
        raise ValueError("RR tidak valid, contoh: 2 atau 2, 3")
    q["top"] = int(min(max(int(q.get("top") or 40), 5), 200))
    return q


def _slice(b, start, end):
    t = np.asarray(b.t)
    lo = np.searchsorted(t, int(start)) if start else 0
    hi = np.searchsorted(t, int(end), side="right") if end else len(t)
    return [np.asarray(x, float)[lo:hi] for x in (b.t, b.o, b.h, b.l, b.c, b.v)]


# ---------------------------------------------------------------------------- struktur (swing berlabel)
def swing_events(h, l, c, a):
    """Urutan swing selang-seling yang diketahui SAAT itu. Hasil: list (s, seq) dengan s = candle konfirmasi dan
    seq = salinan urutan swing terakhir [(idx, harga, tipe 'H'/'L', label)] setelah swing di s ditambahkan / diganti."""
    hi_i, lo_i = pivots(h, l, FRACTAL)
    ev = sorted([(int(i) + FRACTAL, int(i), "H") for i in hi_i] + [(int(i) + FRACTAL, int(i), "L") for i in lo_i])
    seq, out = [], []
    for s, p, typ in ev:
        if s >= len(c):
            continue
        price = h[p] if typ == "H" else l[p]
        if seq and seq[-1][2] == typ:                       # dua swing sejenis berurutan: pakai yang lebih ekstrem
            if (typ == "H" and price <= seq[-1][1]) or (typ == "L" and price >= seq[-1][1]):
                continue
            seq.pop()
        prev = next((x for x in reversed(seq) if x[2] == typ), None)
        if prev is None:
            lab = None
        else:
            tol = EQ_TOL * (a[p] if a[p] == a[p] else 0.0)
            pp = prev[1]
            if abs(price - pp) <= tol:
                lab = "EH" if typ == "H" else "EL"
            elif typ == "H":
                lab = "XH" if (price > pp and c[p] < pp) else "HH" if price > pp else "LH"
            else:
                lab = "XL" if (price < pp and c[p] > pp) else "LL" if price < pp else "HL"
        seq.append((p, float(price), typ, lab))
        if len(seq) > 8:
            seq = seq[-8:]
        out.append((s, list(seq)))
    return out


def _entries(d, seq, s, h, l, c, a):
    """Level entry & dasar leg untuk arah d (0 LONG, 1 SHORT) saat candle s. Hasil (dict entry -> harga, leg) atau None."""
    A = a[s]
    if not (A == A) or A <= 0:
        return None
    if d == 0:
        lows = [x for x in seq if x[2] == "L"]
        if not lows:
            return None
        base = lows[-1]
        top = float(h[base[0]:s + 1].max())
        if top - base[1] < MIN_LEG * A:
            return None
        E = {"market": float(c[s])}
        for f in FIBS:
            lv = top - f * (top - base[1])
            if lv < c[s]:
                E[f"fib{f}"] = lv
        prevh = [x for x in seq if x[2] == "H" and x[0] < base[0]]
        if prevh and base[1] < prevh[-1][1] < top and prevh[-1][1] < c[s]:
            E["retest"] = prevh[-1][1]
        return E, base[1], top
    highs = [x for x in seq if x[2] == "H"]
    if not highs:
        return None
    base = highs[-1]
    bot = float(l[base[0]:s + 1].min())
    if base[1] - bot < MIN_LEG * A:
        return None
    E = {"market": float(c[s])}
    for f in FIBS:
        lv = bot + f * (base[1] - bot)
        if lv > c[s]:
            E[f"fib{f}"] = lv
    prevl = [x for x in seq if x[2] == "L" and x[0] < base[0]]
    if prevl and bot < prevl[-1][1] < base[1] and prevl[-1][1] > c[s]:
        E["retest"] = prevl[-1][1]
    return E, base[1], bot


def _fill(d, s, e, ext, h, l, kind):
    """Candle terisi (indeks) atau None. Market = s. Limit: candle s+1.. s+FILL_WAIT yang menyentuh e, batal kalau
    lebih dulu (atau di candle yang sama) membuat high (LONG) / low (SHORT) baru di luar ujung leg."""
    if kind == "market":
        return s
    n = len(h)
    a, b = s + 1, min(n, s + 1 + FILL_WAIT)
    if a >= b:
        return None
    if d == 0:
        touch = l[a:b] <= e
        run = h[a:b] > ext
    else:
        touch = h[a:b] >= e
        run = l[a:b] < ext
    it = int(np.argmax(touch)) if touch.any() else None
    ir = int(np.argmax(run)) if run.any() else None
    if it is None or (ir is not None and ir <= it):
        return None
    return a + it


def _outcome(d, f, e, sl, rrs, h, l, c, market):
    """Hasil per RR: list (R, kode) kode 1 menang, -1 kalah, 0 waktu habis; None = data belum cukup."""
    n = len(c)
    end = f + HOLD
    if end >= n:
        return None
    risk = abs(e - sl)
    first = f + 1 if market else f                       # limit: candle terisi ikut dicek SL-nya
    lo, hi_ = l[first:end + 1], h[f + 1:end + 1]
    if d == 0:
        slh = lo <= sl
        isl = (first + int(np.argmax(slh))) if slh.any() else None
        cm = np.maximum.accumulate(hi_)
    else:
        slh = hi_ >= sl if market else h[first:end + 1] >= sl
        isl = (first + int(np.argmax(slh))) if slh.any() else None
        cm = -np.minimum.accumulate(lo if market else l[f + 1:end + 1])
    out = []
    for rr in rrs:
        tp = e + rr * risk if d == 0 else e - rr * risk
        k = int(np.searchsorted(cm, tp if d == 0 else -tp, side="left"))
        itp = f + 1 + k if k < len(cm) else None
        if isl is not None and (itp is None or isl <= itp):
            out.append((-1.0, -1, isl))
        elif itp is not None:
            out.append((float(rr), 1, itp))
        else:
            r_ = (c[end] - e) / risk if d == 0 else (e - c[end]) / risk
            out.append((float(max(-1.0, min(rr, r_))), 0, end))
    return out


def occurrences(t, o, h, l, c, v, q, keep=None):
    """Semua kejadian pola + hasil tiap (arah, entry, SL, RR). keep = (len, key, d) untuk contoh trade saja.
    Hasil: list dict."""
    a = _atr(h, l, c, 14)
    rrs = q["rrs"]
    split = int(len(c) * 0.7)
    out = []
    for s, seq in swing_events(h, l, c, a):
        labs = [x[3] for x in seq]
        for L in LENS:
            if len(seq) < L or any(x is None for x in labs[-L:]):
                continue
            key = ">".join(labs[-L:])
            for d in (0, 1):
                if keep is not None and (L, key, d) != keep:
                    continue
                r = _entries(d, seq, s, h, l, c, a)
                if r is None:
                    continue
                E, base, ext = r
                A = a[s]
                pat = seq[-L:]
                far = min(x[1] for x in pat if x[2] == "L") if d == 0 else max(x[1] for x in pat if x[2] == "H")
                if (d == 0 and not any(x[2] == "L" for x in pat)) or (d == 1 and not any(x[2] == "H" for x in pat)):
                    far = base
                stops = {"swing": base - SL_BUF * A if d == 0 else base + SL_BUF * A,
                         "pola": min(base, far) - SL_BUF * A if d == 0 else max(base, far) + SL_BUF * A}
                for en, e in E.items():
                    f = _fill(d, s, e, ext, h, l, en)
                    for sk, sl in stops.items():
                        risk = (e - sl) if d == 0 else (sl - e)
                        if not (MIN_RISK * A <= risk <= MAX_RISK * A):
                            continue
                        res = None if f is None else _outcome(d, f, e, sl, rrs, h, l, c, en == "market")
                        if f is not None and res is None:
                            continue                      # terisi tapi masa depan belum cukup: belum diketahui
                        if f is None and s + 1 + FILL_WAIT >= len(c):
                            continue                      # belum tentu tidak terisi
                        out.append({"s": s, "len": L, "key": key, "d": d, "entry": en, "sl": sk, "e": e, "slp": sl,
                                    "fill": f, "res": res, "test": s >= split, "seq": pat})
    return out


# ---------------------------------------------------------------------------- per koin & gabungan
_WS = {}


def _init_worker(data_dir):
    from .data import DataStore
    _WS["store"] = DataStore(data_dir, cache_size=4)


def _load(store, sym, q):
    t, o, h, l, c, v = _slice(store.get(sym, q["tf"]), q.get("start"), q.get("end"))
    if len(c) < 600:
        return f"data terlalu sedikit di periode ini ({len(c)} candle)"
    return t, o, h, l, c, v


_Z = ("sig", "fill", "w", "lo", "to", "r", "sigt", "fillt", "wt", "rt")


def coin_acc(sym, q, store=None):
    """Satu koin -> tabungan {(len, key, d, entry, sl, rr): hitungan} + dasar {(len, d, entry, sl, rr): hitungan}."""
    try:
        r = _load(store or _WS["store"], sym, q)
        if isinstance(r, str):
            return r
        occ = occurrences(*r, q)
    except Exception as ex:                                  # noqa: BLE001 - satu koin bermasalah dilewati
        return f"{type(ex).__name__}: {ex}"
    acc = {}
    for x in occ:
        for k_rr, rr in enumerate(q["rrs"]):
            for key in ((x["len"], x["key"], x["d"], x["entry"], x["sl"], rr), ("*", x["len"], x["d"], x["entry"], x["sl"], rr)):
                A = acc.setdefault(key, dict.fromkeys(_Z, 0.0))
                te = x["test"]
                A["sigt" if te else "sig"] += 1
                if x["res"] is not None:
                    R, code, _ = x["res"][k_rr]
                    A["fillt" if te else "fill"] += 1
                    A["rt" if te else "r"] += R
                    if code == 1:
                        A["wt" if te else "w"] += 1
                    elif code == -1 and not te:
                        A["lo"] += 1
                    elif code == 0 and not te:
                        A["to"] += 1
    for A in acc.values():                                    # koin ini untung? (untuk syarat "untung di banyak koin")
        n_ = A["fill"] + A["fillt"]
        A["coins"] = 1.0 if n_ else 0.0
        A["coins_pos"] = 1.0 if n_ and (A["r"] + A["rt"]) > 0 else 0.0
    return acc, len(r[4])


def job_total(q, symbols):
    return len(symbols)


def job_state(q, symbols):
    return {"acc": {}, "used": [], "skipped": [], "candles": 0, "merged": 0, "t0": time.time()}


def job_call(state, q, symbols, i):
    return coin_acc, (symbols[i], q)


def job_merge(state, q, symbols, i, res):
    state["merged"] += 1
    if isinstance(res, str):
        state["skipped"].append(f"{symbols[i]}: {res}")
        return
    coin, cnd = res
    state["used"].append(symbols[i])
    state["candles"] += cnd
    acc = state["acc"]
    for key, B in coin.items():
        A = acc.get(key)
        if A is None:
            acc[key] = dict(B)
            continue
        for k in B:
            A[k] += B[k]


def describe_key(L, key, d):
    side = "LONG" if d == 0 else "SHORT"
    steps = " → ".join(LBL[x] for x in key.split(">"))
    return f"{side}: {steps}"


def _rate(A, test=False):
    n = A["fillt"] if test else A["fill"]
    if not n:
        return None, None, 0
    return 100 * (A["wt"] if test else A["w"]) / n, (A["rt"] if test else A["r"]) / n, int(n)


def job_finalize(state, q, symbols, partial=False):
    acc, min_wr = state["acc"], q["min_wr"]
    rows = []
    for key, A in acc.items():
        if key[0] == "*":
            continue
        L, pk, d, en, sk, rr = key
        wr, ex, n = _rate(A)
        if n < MIN_N:
            continue
        wrt, ext, nt = _rate(A, True)
        B = acc.get(("*", L, d, en, sk, rr))
        bwr, bex, _ = _rate(B) if B else (None, None, 0)
        bwrt, bext, _ = _rate(B, True) if B else (None, None, 0)
        sig = A["sig"] + A["sigt"]
        coin_ok = A["coins_pos"] / A["coins"] if A["coins"] else None
        passed = bool(ex > 0 and ext is not None and ext > 0 and nt >= max(10, MIN_N // 3)
                      and bex is not None and ex >= bex + 0.05 and bext is not None and ext > bext
                      and (wrt or 0) >= min_wr and (coin_ok is None or A["coins"] < 3 or coin_ok >= 0.6))
        rows.append({"len": L, "key": pk, "dir": d, "entry": en, "sl": sk, "rr": rr, "name": describe_key(L, pk, d),
                     "entry_txt": ENTRY_TXT[en], "sl_txt": SL_TXT[sk], "signals": int(sig),
                     "fill_pct": 100 * (A["fill"] + A["fillt"]) / sig if sig else None,
                     "n": n, "wr": wr, "exp_r": ex, "base_r": bex, "base_wr": bwr, "base_r_test": bext, "base_wr_test": bwrt,
                     "n_test": nt, "wr_test": wrt, "exp_test": ext, "timeout_pct": 100 * A["to"] / n,
                     "coins": int(A["coins"]), "coins_pos": int(A["coins_pos"]), "passed": passed,
                     "score": ex * math.sqrt(n)})
    below = sum(1 for r in rows if (r["wr_test"] or 0) < min_wr) if min_wr else 0
    rows.sort(key=lambda r: (not r["passed"], -r["score"]))
    # satu baris per pola (panjang, urutan swing, arah) + variasi entry / SL / RR lain yang juga diuji
    groups, uniq = {}, []
    for r in rows:
        g = (r["len"], r["key"], r["dir"])
        if g not in groups:
            groups[g] = r
            r["variants"] = []
            uniq.append(r)
        else:
            groups[g]["variants"].append({k: r[k] for k in ("entry", "sl", "rr", "entry_txt", "sl_txt", "n", "fill_pct", "wr",
                                                            "exp_r", "wr_test", "exp_test", "passed")})
    for r in uniq:
        r["variants"] = sorted(r["variants"], key=lambda x: -x["exp_r"])[:8]
    best_wr = {}
    for r in rows:
        if r["wr"] > best_wr.get(r["rr"], {"wr": -1})["wr"]:
            best_wr[r["rr"]] = {"rr": r["rr"], "wr": round(r["wr"], 1), "name": r["name"]}
    return {"v": VERSION, "rows": uniq[:q["top"]], "n_patterns": len(uniq), "n_variants": len(rows),
            "n_passed": sum(r["passed"] for r in uniq), "n_below_wr": below, "best_wr": sorted(best_wr.values(), key=lambda x: x["rr"]),
            "symbols": state["used"], "skipped": state["skipped"][:20], "n_skipped": len(state["skipped"]), "candles": state["candles"],
            "rules": {"fractal": FRACTAL, "eq": EQ_TOL, "fill_wait": FILL_WAIT, "hold": HOLD, "min_n": MIN_N, "lens": list(LENS),
                      "sl_buf": SL_BUF, "min_leg": MIN_LEG, "min_risk": MIN_RISK, "max_risk": MAX_RISK, "atr": 14, "split": 70},
            "params": {k: q[k] for k in ("tf", "rrs", "min_wr")}, "elapsed": round(time.time() - state["t0"], 1),
            "partial": partial, "scanned": state["merged"], "total": len(symbols)}


def run(store, symbols, p, progress=None):
    """Versi langsung (tanpa jeda) — dipakai tes. Menu memakai StudyJobs (paralel, bisa dijeda, hasil disimpan)."""
    q = _params(p)
    state = job_state(q, symbols)
    for i, sym in enumerate(symbols):
        if progress:
            progress(i, len(symbols), f"{sym}|membaca market structure", None)
        job_merge(state, q, symbols, i, coin_acc(sym, q, store))
    return job_finalize(state, q, symbols)


def pattern_trades(store, sym, p, pat, limit=200):
    """Contoh kejadian satu pola + entry / SL / RR di satu koin, untuk dibuka di Manual Replay (swing ikut digambar)."""
    q = _params(p)
    rr = float(pat["rr"])
    q["rrs"] = [rr]
    r = _load(store, sym, q)
    if isinstance(r, str):
        raise ValueError(r)
    t = r[0]
    occ = occurrences(*r, q, keep=(int(pat["len"]), str(pat["key"]), int(pat["dir"])))
    out = []
    for x in occ:
        if x["entry"] != pat["entry"] or x["sl"] != pat["sl"]:
            continue
        d, e, sl = x["d"], x["e"], x["slp"]
        risk = abs(e - sl)
        res = x["res"][0] if x["res"] else None
        out.append({"time": int(t[x["s"]]), "side": "long" if d == 0 else "short", "entry": float(e), "sl": float(sl),
                    "tp": float(e + rr * risk if d == 0 else e - rr * risk), "filled": res is not None,
                    "fill_time": int(t[x["fill"]]) if x["fill"] is not None else None,
                    "result": None if res is None else ("TP" if res[1] == 1 else "SL" if res[1] == -1 else "waktu habis"),
                    "r": None if res is None else float(res[0]), "exit_time": None if res is None else int(t[res[2]]),
                    "test": bool(x["test"]),
                    "swings": [{"time": int(t[sw[0]]), "price": sw[1], "label": LBL[sw[3]]} for sw in x["seq"]]})
    return {"symbol": sym, "tf": q["tf"], "trades": out[-limit:], "n": len(out)}

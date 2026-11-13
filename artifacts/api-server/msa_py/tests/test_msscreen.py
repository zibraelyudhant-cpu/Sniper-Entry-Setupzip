"""🔎 Screener Market Structure: struktur sekarang -> pola sama di riwayat -> arah + entry / SL / TP (RR >= 1:3)."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import msscreen as MS  # noqa: E402
from backend.data import DataStore  # noqa: E402
from tools.make_sample_data import make  # noqa: E402


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    d = tmp_path_factory.mktemp("msscr")
    make(str(d), days=200)
    return DataStore(str(d))


def test_events_causal(store):
    """Swing yang diketahui di candle s tidak berubah kalau data sesudah s dibuang (tanpa intip masa depan)."""
    b = store.get("SAMPLEUSDT", "1h")
    h, l, c = (np.asarray(x, float) for x in (b.h, b.l, b.c))
    a = MS._atr(h, l, c, 14)
    full = MS.events(h, l, c, a, 3)
    cut = 2000
    part = MS.events(h[:cut], l[:cut], c[:cut], a[:cut], 3)
    assert part and [x for x in full if x[0] < cut] == part


def test_screen(store):
    r = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "all")
    assert r["source"] == "lokal" and 3 <= r["len"] <= 6 and len(r["pattern"]) == r["len"]
    assert r["n_occ"] > 0 and r["n_coins"] == 1
    P = r["pred"]
    assert abs(P["pct_up"] + P["pct_down"] + 100 * P["unclear"] / r["n_occ"] - 100) < 1e-6
    # semua contoh = pola yang sama, bisa dibuka di replay
    assert r["examples"] and all([x["label"] for x in e["swings"]][-r["len"]:] == r["pattern"] for e in r["examples"])
    # aturan & rencana: RR minimal 1:3, harga konsisten dengan arah
    assert all(x["rr"] >= 3 for x in r["rules"])
    for x in r["rules"]:                                               # R per sinyal = R per trade x peluang terisi
        assert abs(x["exp_sig"] - x["exp_r"] * x["fill_pct"] / 100) < 1e-9
    pv = [x for x in r["rules"] if x["proven"]]
    assert [x["exp_sig"] for x in pv] == sorted([x["exp_sig"] for x in pv], reverse=True)
    for p in r["plans"]:
        e, sl, tp = p["price_entry"], p["price_sl"], p["price_tp"]
        if p["dir"] == 0:
            assert sl < e < tp
        else:
            assert tp < e < sl
        assert abs(abs(tp - e) - p["rr"] * abs(e - sl)) < 1e-6 * e
    if r["best"]:
        assert r["best"]["exp_r"] > 0 and r["best"] is not None
    # jalur prediksi (animasi) dari riwayat
    pt = r["proj"]["path"]
    assert len(pt["close"]) == len(pt["p25"]) == len(pt["p75"]) == MS.N_PATH
    assert all(a <= b + 1e-9 for a, b in zip(pt["p25"], pt["p75"]))
    assert pt["n"] <= pt["n_all"] <= r["n_occ"] and pt["dir"] in (1, -1)
    real = pt["real"]
    assert len(real["close"]) == MS.N_PATH and all(lo <= cl <= hi for lo, cl, hi in zip(real["low"], real["close"], real["high"]))
    assert r["proj"]["atr"] > 0 and len(r["candles"]) > 60


def test_screen_live_and_scope(store):
    """Struktur dari candle 'live' (tuple) sama dengan membaca data lokal yang sama."""
    b = store.get("SAMPLEUSDT", "1h")
    live = tuple(np.asarray(x, float)[-1500:] for x in (b.t, b.o, b.h, b.l, b.c))
    a = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "coin")
    r = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "coin", live=live)
    assert r["source"] == "binance" and r["pattern"] == a["pattern"] and r["n_occ"] == a["n_occ"]
    with pytest.raises(ValueError):
        MS.screen(store, "SAMPLEUSDT", "7m")


def test_status():
    """Status jujur: limit tersentuh lalu kena SL = selesai, bukan 'sudah tersentuh'."""
    h = np.array([10, 10.2, 10.1, 9.9, 9.6, 9.5])
    l = np.array([9.8, 9.9, 9.7, 9.5, 9.3, 9.2])
    # LONG limit 9.75, SL 9.4, TP 10.8 (candle s = 0)
    st, live = MS._status(0, "fib0.5", 9.75, 9.4, 10.8, 11.0, 0, h, l, 5)
    assert st == "selesai: kena SL" and not live
    st, live = MS._status(0, "fib0.5", 9.0, 8.5, 11.0, 11.0, 0, h, l, 5)
    assert st.startswith("aktif") and live
    st, live = MS._status(0, "fib0.5", 9.0, 8.5, 11.0, 10.1, 0, h, l, 5)
    assert st.startswith("batal") and not live                         # high baru sebelum limit tersentuh
    st, live = MS._status(0, "fib0.5", 9.75, 9.0, 12.0, 11.0, 0, h, l, 5)
    assert st.startswith("berjalan") and not live
    h2 = np.array([10, 10.2, 10.1, 11.5]); l2 = np.array([9.8, 9.9, 9.7, 10.0])
    assert MS._status(0, "fib0.5", 9.75, 9.4, 10.8, 12.0, 0, h2, l2, 3)[0] == "selesai: sudah kena TP"


def test_dip_entries(store):
    r = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "all")
    assert any(x["entry"].startswith("atr") for x in r["rules"]) or r["n_occ"] < 30
    assert all(("ATR" in x["entry_txt"]) == x["entry"].startswith("atr") for x in r["rules"])
    if r["best"]:
        assert r["best"]["live"] and r["best"]["exp_r"] > 0 and r["last_plan"] is None
        b = r["best"]                                                  # sinyal: sering terisi DAN tidak rugi
        assert b["usable"] and b["exp_sig"] > 0 and b["proven"]
        assert b["entry"] == "market" or b["fill_pct"] >= MS.MIN_FILL_PCT
    else:
        assert not any(p["usable"] for p in r["plans"])
    for p in r["plans"]:
        assert p["usable"] == (p["live"] and p["fill_ok"] and p["profit_ok"]) and (p["usable"] or p["why_not"])


def test_baseline_htf_legs(store):
    """1) pembanding + keunggulan, 2) tren TF besar, 3) leg mirip: filter hanya dipakai kalau lebih tepat di data uji."""
    assert MS.resolve_htf("15m", "auto") == "4h" and MS.resolve_htf("15m", "off") is None
    assert MS.resolve_htf("4h", "1h") is None and MS.resolve_htf("15m", "1d") == "1d"
    r = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "all", htf="1d")
    F, P = r["filters"], r["pred"]
    assert F["htf"] == "1d" and F["base"]["pct_up"] + F["base"]["pct_down"] == pytest.approx(100)
    names = [m["name"] for m in F["modes"]]
    assert names[0] == "pola" and F["mode"] in names and r["n_occ"] <= F["n_all"]
    pola = F["modes"][0]
    chosen = next(m for m in F["modes"] if m["name"] == F["mode"])
    if F["mode"] != "pola":                                            # dipakai hanya kalau lebih tepat di data uji
        assert chosen["eligible"] and chosen["test_hit"] >= pola["test_hit"] + 2
    assert chosen["n"] == r["n_occ"]
    if P.get("base_up") is not None:
        side = "down" if P["pct_down"] > P["pct_up"] else "up"
        assert P["edge"] == pytest.approx(P[f"pct_{side}"] - P[f"base_{side}"])
    off = MS.screen(store, "SAMPLEUSDT", "1h", "kecil", "all", htf="off")
    assert off["filters"]["htf"] is None and all("tren" not in m["name"] for m in off["filters"]["modes"])

"""🧪 Cek entry posisi: entry / SL / TP kamu di kejadian pola market structure yang sama di riwayat."""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from backend import poscheck as PC  # noqa: E402
from backend import msscreen as MS  # noqa: E402
from backend.data import DataStore  # noqa: E402
from tools.make_sample_data import make  # noqa: E402


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    d = tmp_path_factory.mktemp("pc")
    make(str(d), days=200)
    return DataStore(str(d))


def test_sim():
    #             s     1     2     3     4     5
    h = np.array([10.0, 10.1, 10.6, 10.2, 9.6, 9.0])
    l = np.array([9.9, 9.8, 10.1, 9.7, 9.0, 8.5])
    c = np.array([10.0, 10.0, 10.3, 9.8, 9.2, 8.8])
    # SHORT limit 10.5 (di atas harga): terisi candle 2, SL 11 tidak kena, TP 9.0 kena candle 4 -> +1.5 / 0.5 = 3R
    r = PC._sim(h, l, c, 0, 10.5, 11.0, 9.0, 1, False, 0.5)
    assert r[0] == 2 and r[2] == 1 and r[1] == pytest.approx(3.0)
    # limit tidak pernah tersentuh
    assert PC._sim(h, l, c, 0, 11.5, 12.0, 9.0, 1, False, 0.5) is None
    # LONG sudah masuk di 10, SL 9.75 kena candle 3 (low 9.7) -> -1R; sesudahnya harga tidak ke TP 10.8 -> bukan wick
    r = PC._sim(h, l, c, 0, 10.0, 9.75, 10.8, 0, True, 0.25)
    assert r[2] == -1 and r[1] == pytest.approx(-1.0) and r[4] is False
    # SL kena lalu harga tetap sampai TP = kena wick
    r = PC._sim(h, l, c, 0, 10.0, 9.85, 10.5, 0, True, 0.15)
    assert r[2] == -1 and r[4] is True


def test_check_pending(store):
    base = MS.screen(store, "SAMPLEUSDT", "1h")
    now, A = base["now_price"], base["proj"]["atr"]
    r = PC.check(store, "SAMPLEUSDT", "1h", now + 0.5 * A, now + 1.5 * A, now - 3 * A)
    assert r["dir"] == 1 and r["n_occ"] == base["n_occ"] and r["pattern"] == base["pattern"]
    S = r["stats"]
    assert S["n_fill"] <= S["n_sig"] == r["n_occ"]
    if S["n_fill"]:
        assert S["wr"] + S["sl_pct"] + S["to_pct"] == pytest.approx(100)
        assert S["exp_sig"] == pytest.approx(S["exp_r"] * S["n_fill"] / S["n_sig"])
    for sg in r["suggestions"]:                                       # saran = lebih baik di data cari
        assert sg["fit"]["exp_sig"] >= r["fit"]["exp_sig"] + PC.GAIN_MIN - 1e-9 and sg["why"]
        assert sg["kind"] in ("entry", "sl", "tp")
        assert sg["fit"]["exp_sig"] > 0 and sg["test"]["exp_sig"] > 0          # saran tidak boleh rugi
        if sg["kind"] == "entry":
            assert sg["fit"]["fill_pct"] >= MS.MIN_FILL_PCT                   # saran entry harus sering terisi
    ex = r["examples"]
    assert ex and sum(e["filled"] for e in ex) <= len(ex)
    for e in ex:                                                      # level kamu dipasang dengan jarak ATR yang sama
        assert e["tp"] < e["entry"] < e["sl"]
    with pytest.raises(ValueError):
        PC.check(store, "SAMPLEUSDT", "1h", now, now - A, now - 2 * A)


def test_check_filled_only_tp(store):
    base = MS.screen(store, "SAMPLEUSDT", "1h")
    now, A = base["now_price"], base["proj"]["atr"]
    r = PC.check(store, "SAMPLEUSDT", "1h", now, now - 1.5 * A, now + 3 * A, filled=True)
    assert r["dir"] == 0 and r["filled"] and r["stats"]["fill_pct"] == pytest.approx(100)
    assert all(s["kind"] == "tp" for s in r["suggestions"]) and r["proj"] is not None    # prediksi arah tetap ada

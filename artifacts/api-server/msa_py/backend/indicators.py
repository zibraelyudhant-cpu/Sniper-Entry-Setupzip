"""Indikator dasar (numpy) untuk strategi. Semua menerima array dan mengembalikan array sepanjang input."""
import numpy as np


def sma(x, n):
    x = np.asarray(x, float)
    out = np.full(len(x), np.nan)
    ok = np.where(~np.isnan(x))[0]
    s = ok[0] if len(ok) else len(x)          # lewati NaN di awal (mis. input dari indikator lain)
    if len(x) - s >= n:
        c = np.cumsum(np.insert(x[s:], 0, 0.0))
        out[s + n - 1:] = (c[n:] - c[:-n]) / n
    return out


def ema(x, n):
    a = 2 / (n + 1)
    out = np.empty(len(x))
    if not len(x):
        return out
    out[0] = x[0]
    for i in range(1, len(x)):
        out[i] = a * x[i] + (1 - a) * out[i - 1]
    return out


def _wilder(x, n):
    out = np.full(len(x), np.nan)
    if len(x) < n:
        return out
    out[n - 1] = np.mean(x[:n])
    for i in range(n, len(x)):
        out[i] = (out[i - 1] * (n - 1) + x[i]) / n
    return out


def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    return _wilder(tr, n)


def adx(h, l, c, n=14):
    """ADX Wilder. Butuh minimal ~2n bar supaya nilainya stabil."""
    up, dn = np.diff(h, prepend=h[0]), -np.diff(l, prepend=l[0])
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = atr(h, l, c, 1)  # true range
    str_, spdm, sndm = _wilder(tr, n), _wilder(pdm, n), _wilder(ndm, n)
    with np.errstate(invalid="ignore", divide="ignore"):
        pdi, ndi = 100 * spdm / str_, 100 * sndm / str_
        dx = 100 * np.abs(pdi - ndi) / (pdi + ndi)
    out = np.full(len(c), np.nan)
    valid = np.where(~np.isnan(dx))[0]
    if len(valid) >= n:
        out[valid[0]:] = _wilder(dx[valid[0]:], n)
    return out


def rsi(c, n=14):
    d = np.diff(c, prepend=c[0])
    g, lo = _wilder(np.maximum(d, 0), n), _wilder(np.maximum(-d, 0), n)
    with np.errstate(invalid="ignore", divide="ignore"):
        return 100 - 100 / (1 + g / lo)


class EMAStream:
    """EMA yang diperbarui hanya untuk candle baru, jadi cepat dipanggil di setiap bar.
    Panggil update(bars) dengan candle closed; .value = EMA terakhir, .prev = EMA satu candle sebelumnya."""

    def __init__(self, n):
        self.a = 2 / (n + 1)
        self.value = self.prev = None
        self.t = None

    def update(self, bars):
        start = 0 if self.t is None else int(np.searchsorted(bars.t, self.t, side="right"))
        for c in bars.c[start:]:
            self.prev = self.value
            self.value = c if self.value is None else self.a * c + (1 - self.a) * self.value
        if len(bars):
            self.t = int(bars.t[-1])
        return self.value


def pivots(h, l, n):
    """Indeks swing high & swing low (fractal n kiri / n kanan). Hanya swing yang SUDAH terkonfirmasi:
    swing di indeks i baru muncul kalau sudah ada n candle sesudahnya, jadi tidak ada look-ahead."""
    from numpy.lib.stride_tricks import sliding_window_view
    if len(h) < 2 * n + 1:
        e = np.zeros(0, int)
        return e, e
    w = 2 * n + 1
    hi = np.where(h[n:len(h) - n] == sliding_window_view(h, w).max(1))[0] + n
    lo = np.where(l[n:len(l) - n] == sliding_window_view(l, w).min(1))[0] + n
    return hi, lo


def fvg(h, l, bullish=True):
    """Indeks candle ke-3 dari Fair Value Gap. Bullish: low[i] > high[i-2] (gap = high[i-2]..low[i]).
    Bearish: high[i] < low[i-2] (gap = high[i]..low[i-2])."""
    if len(h) < 3:
        return np.zeros(0, int)
    return np.where(l[2:] > h[:-2])[0] + 2 if bullish else np.where(h[2:] < l[:-2])[0] + 2


def bos_bias(h, l, c, n):
    """Arah struktur dari Break of Structure terakhir: +1 kalau close terakhir yang menembus swing adalah
    ke atas (tembus swing high), -1 kalau ke bawah, 0 kalau belum ada."""
    hi, lo = pivots(h, l, n)
    bias, ih, il, lh, ll = 0, 0, 0, None, None
    for i in range(len(c)):
        while ih < len(hi) and hi[ih] + n <= i:   # swing baru diketahui n candle setelahnya
            lh = h[hi[ih]]
            ih += 1
        while il < len(lo) and lo[il] + n <= i:
            ll = l[lo[il]]
            il += 1
        if lh is not None and c[i] > lh:
            bias, lh = 1, None
        elif ll is not None and c[i] < ll:
            bias, ll = -1, None
    return bias


# ---- indikator tambahan (dipakai screener; semua mengembalikan array sepanjang input) ----
def _win(x, n):
    from numpy.lib.stride_tricks import sliding_window_view
    return sliding_window_view(x, n)


def rolling(x, n, fn):
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        out[n - 1:] = fn(_win(x, n), axis=1)
    return out


def dmi(h, l, c, n=14):
    """(+DI, -DI, ADX) versi Wilder."""
    up, dn = np.diff(h, prepend=h[0]), -np.diff(l, prepend=l[0])
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    str_ = _wilder(atr(h, l, c, 1), n)
    with np.errstate(invalid="ignore", divide="ignore"):
        pdi, ndi = 100 * _wilder(pdm, n) / str_, 100 * _wilder(ndm, n) / str_
        dx = 100 * np.abs(pdi - ndi) / (pdi + ndi)
    out = np.full(len(c), np.nan)
    valid = np.where(~np.isnan(dx))[0]
    if len(valid) >= n:
        out[valid[0]:] = _wilder(dx[valid[0]:], n)
    return pdi, ndi, out


def macd(c, fast=12, slow=26, signal=9):
    line = ema(c, fast) - ema(c, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def stoch(h, l, c, n=14, k_smooth=1, d_smooth=3):
    hh, ll = rolling(h, n, np.max), rolling(l, n, np.min)
    with np.errstate(invalid="ignore", divide="ignore"):
        k = 100 * (c - ll) / (hh - ll)
    if k_smooth > 1:
        k = sma(k, k_smooth)
    return k, sma(k, d_smooth)


def cci(h, l, c, n=20):
    tp = (h + l + c) / 3
    m = sma(tp, n)
    md = np.full(len(c), np.nan)
    if len(c) >= n:
        w = _win(tp, n)
        md[n - 1:] = np.abs(w - w.mean(axis=1, keepdims=True)).mean(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        return (tp - m) / (0.015 * md)


def willr(h, l, c, n=14):
    hh, ll = rolling(h, n, np.max), rolling(l, n, np.min)
    with np.errstate(invalid="ignore", divide="ignore"):
        return -100 * (hh - c) / (hh - ll)


def roc(c, n=10):
    out = np.full(len(c), np.nan)
    if len(c) > n:
        out[n:] = 100 * (c[n:] / c[:-n] - 1)
    return out


def mfi(h, l, c, v, n=14):
    tp = (h + l + c) / 3
    mf = tp * v
    d = np.diff(tp, prepend=tp[0])
    pos, neg = rolling(np.where(d > 0, mf, 0.0), n, np.sum), rolling(np.where(d < 0, mf, 0.0), n, np.sum)
    with np.errstate(invalid="ignore", divide="ignore"):
        return 100 - 100 / (1 + pos / neg)


def bollinger(c, n=20, k=2.0):
    mid = sma(c, n)
    sd = rolling(c, n, np.std)
    return mid - k * sd, mid, mid + k * sd


def supertrend(h, l, c, n=10, mult=3.0):
    """Arah Supertrend: +1 (naik) / -1 (turun)."""
    a = atr(h, l, c, n)
    hl2 = (h + l) / 2
    up, dn = hl2 - mult * a, hl2 + mult * a
    d = np.full(len(c), np.nan)
    fu, fd, cur = np.nan, np.nan, 1
    for i in range(len(c)):
        if np.isnan(a[i]):
            continue
        fu = up[i] if np.isnan(fu) or c[i - 1] < fu else max(up[i], fu)
        fd = dn[i] if np.isnan(fd) or c[i - 1] > fd else min(dn[i], fd)
        if cur == -1 and c[i] > fd:
            cur = 1
        elif cur == 1 and c[i] < fu:
            cur = -1
        d[i] = cur
    return d


def force_index(c, v, n=2):
    """Force Index (Elder) = EMA n dari (close - close sebelumnya) x volume. Positif = tekanan beli."""
    raw = np.r_[0.0, np.diff(c) * v[1:]]
    return ema(raw, n)

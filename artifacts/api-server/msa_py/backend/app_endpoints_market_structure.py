# Potongan app.py (FastAPI): endpoint Market Structure. _bg_scan = jalankan di thread + polling GET /api/screener/job/{id}.

@app.post("/api/msa/screen")
def msa_screen(req: dict):
    """🔎 Screener Market Structure 1 koin: struktur sekarang (live Binance, cadangan data lokal) -> pola sama di riwayat
    lokal -> arah selanjutnya + entry / SL / TP (RR >= 1:3). Proses di latar belakang (GET /api/screener/job/{id})."""
    from . import msscreen as MS
    sym = str(req.get("symbol") or "").upper().strip()
    if sym and not sym.endswith("USDT"):
        sym += "USDT"
    tf = str(req.get("tf") or "15m")
    if tf not in TF_MS:
        raise HTTPException(400, "TF tidak dikenal")
    if not sym:
        raise HTTPException(400, "isi koin dulu")
    swing = req.get("swing") if req.get("swing") in MS.SWINGS else "kecil"
    scope = "coin" if req.get("scope") == "coin" else "all"
    if scope == "coin" and (sym not in store.catalog or tf not in store.timeframes(sym)):
        raise HTTPException(400, f"data lokal {sym} {tf} tidak ada — pakai riwayat semua koin, atau unduh datanya dulu")
    htf = str(req.get("htf") or "auto")
    if htf not in ("auto", "off") and htf not in TF_MS:
        raise HTTPException(400, "TF besar tidak dikenal")

    def work(prog):
        live, note, live_htf = None, None, None
        try:
            k = whales.c.get("/fapi/v1/klines", symbol=sym, interval=tf, limit=1000)
            now = time.time() * 1000
            k = [r for r in k if float(r[6]) < now]                    # hanya candle yang sudah close
            if len(k) >= 100:
                live = tuple(np.array([float(r[i]) for r in k]) for i in (0, 1, 2, 3, 4))
            H = MS.resolve_htf(tf, htf)
            if live is not None and H:
                kh = [r for r in whales.c.get("/fapi/v1/klines", symbol=sym, interval=H, limit=500) if float(r[6]) < now]
                if len(kh) >= 30:
                    live_htf = tuple(np.array([float(r[i]) for r in kh]) for i in (0, 1, 2, 3, 4))
        except Exception as ex:                                        # noqa: BLE001 - tanpa internet: pakai data lokal
            note = f"Binance tidak bisa diakses ({type(ex).__name__}), struktur dibaca dari data lokal terakhir."
        if live is None and (sym not in store.catalog or tf not in store.timeframes(sym)):
            raise ValueError(f"tidak bisa ambil data {sym} dari Binance dan data lokalnya tidak ada")
        r = MS.screen(store, sym, tf, swing, scope, live=live, progress=prog, htf=htf, live_htf=live_htf)
        r["note"] = note
        return r
    return _bg_scan(work)


@app.post("/api/msa/check")
def msa_check(req: dict):
    """🧪 Cek entry posisi: entry / SL / TP kamu diuji di kejadian pola market structure yang sama di riwayat
    -> peluang & lama limit terisi, WR, saran entry / SL / TP (belum terisi) atau saran TP (sudah masuk)."""
    from . import poscheck as PC
    from . import msscreen as MS
    sym = str(req.get("symbol") or "").upper().strip()
    if sym and not sym.endswith("USDT"):
        sym += "USDT"
    tf = str(req.get("tf") or "15m")
    if tf not in TF_MS:
        raise HTTPException(400, "TF tidak dikenal")
    if not sym:
        raise HTTPException(400, "isi koin dulu")
    try:
        e, s_, t_ = float(req.get("entry")), float(req.get("sl")), float(req.get("tp"))
    except (TypeError, ValueError):
        raise HTTPException(400, "isi entry, SL dan TP dengan angka")
    if not ((t_ > e > s_) or (t_ < e < s_)):
        raise HTTPException(400, "susunan harga salah: LONG = SL < entry < TP, SHORT = TP < entry < SL")
    swing = req.get("swing") if req.get("swing") in MS.SWINGS else "kecil"
    scope = "coin" if req.get("scope") == "coin" else "all"
    if scope == "coin" and (sym not in store.catalog or tf not in store.timeframes(sym)):
        raise HTTPException(400, f"data lokal {sym} {tf} tidak ada — pakai riwayat semua koin, atau unduh datanya dulu")
    htf = str(req.get("htf") or "auto")
    if htf not in ("auto", "off") and htf not in TF_MS:
        raise HTTPException(400, "TF besar tidak dikenal")
    filled = bool(req.get("filled"))

    def work(prog):
        live, note, live_htf = None, None, None
        try:
            k = whales.c.get("/fapi/v1/klines", symbol=sym, interval=tf, limit=1000)
            now = time.time() * 1000
            k = [r for r in k if float(r[6]) < now]
            if len(k) >= 100:
                live = tuple(np.array([float(r[i]) for r in k]) for i in (0, 1, 2, 3, 4))
            H = MS.resolve_htf(tf, htf)
            if live is not None and H:
                kh = [r for r in whales.c.get("/fapi/v1/klines", symbol=sym, interval=H, limit=500) if float(r[6]) < now]
                if len(kh) >= 30:
                    live_htf = tuple(np.array([float(r[i]) for r in kh]) for i in (0, 1, 2, 3, 4))
        except Exception as ex:                                        # noqa: BLE001
            note = f"Binance tidak bisa diakses ({type(ex).__name__}), struktur dibaca dari data lokal terakhir."
        if live is None and (sym not in store.catalog or tf not in store.timeframes(sym)):
            raise ValueError(f"tidak bisa ambil data {sym} dari Binance dan data lokalnya tidak ada")
        r = PC.check(store, sym, tf, e, s_, t_, filled=filled, swing=swing, scope=scope, live=live, progress=prog, htf=htf, live_htf=live_htf)
        r["note"] = note
        return r
    return _bg_scan(work)



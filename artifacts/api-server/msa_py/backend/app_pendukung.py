# Potongan backend/app.py: _clean (JSON aman), _bg_scan (job latar belakang) dan endpoint polling job.
# Di program asli: import time, uuid, math, numpy as np; from fastapi import HTTPException; from fastapi.responses import JSONResponse;
# BinanceError dari binance_client.py; "whales.c" = Client() dari binance_client.py; "store" = DataStore(DATA_DIR) dari data.py.

def _clean(x):
    """numpy scalar -> python, inf/nan -> null supaya JSON valid."""
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x



_scan_jobs = {}


def _bg_scan(work):
    """Jalankan work(progress) di latar belakang; status & progres lewat GET /api/screener/job/{id}."""
    import threading as _th
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "status": "running", "done": 0, "total": 0, "recent": [], "started": time.time(), "result": None,
           "error": None, "times": [], "partial": None}
    for old in [k for k, v in _scan_jobs.items() if v["status"] != "running"][:-3]:
        del _scan_jobs[old]
    _scan_jobs[jid] = job

    def prog(k, n, sym, err):
        job["done"], job["total"] = k, n
        job["times"].append(time.time())
        job["recent"] = ([{"symbol": sym, "error": bool(err)}] + job["recent"])[:8]
    prog.partial = lambda data: job.__setitem__("partial", data)   # hasil sementara (opsional, mis. scan setup)

    def run():
        try:
            job["result"] = _clean(work(prog))
            job["status"] = "done"
        except BinanceError as ex:
            job["status"], job["error"] = "error", str(ex)
        except (ValueError, KeyError, TypeError) as ex:
            job["status"], job["error"] = "error", f"Input tidak valid: {ex}"
        except Exception as ex:   # noqa: BLE001
            job["status"], job["error"] = "error", f"{type(ex).__name__}: {ex}"
    _th.Thread(target=run, daemon=True).start()
    return {"id": jid}



@app.get("/api/screener/job/{jid}")
def screener_job(jid: str):
    job = _scan_jobs.get(jid)
    if not job:
        raise HTTPException(404, "scan tidak ditemukan")
    t, left = job["times"], job["total"] - job["done"]
    eta = None
    if len(t) >= 5 and left > 0:
        k = min(len(t) - 1, 30)
        eta = left * (t[-1] - t[-1 - k]) / k
    return JSONResponse({"id": jid, "status": job["status"], "done": job["done"], "total": job["total"],
                         "recent": job["recent"], "elapsed": round(time.time() - job["started"], 1), "eta": eta,
                         "error": job["error"], "result": job["result"] if job["status"] == "done" else None,
                         "partial": _clean(job.get("partial")) if job["status"] == "running" else None})

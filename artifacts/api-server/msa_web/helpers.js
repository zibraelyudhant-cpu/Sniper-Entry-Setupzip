// Helper JS dari frontend/app.js program asli yang dipakai menu Market Structure.
// openMoment (buka di chart Manual Replay) TIDAK disertakan.

const $ = (id) => document.getElementById(id);

const fmtTime = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
};

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._h);
  toast._h = setTimeout(() => (t.style.display = "none"), 4000);
}

function fmtDur(s) {
  s = Math.round(s);
  return s >= 3600 ? `${Math.floor(s / 3600)} jam ${Math.round((s % 3600) / 60)} mnt` : s >= 60 ? `${Math.floor(s / 60)} mnt ${s % 60} dtk` : `${s} dtk`;
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);   // butuh https / localhost
  } catch {
    const ta = document.createElement("textarea");   // cadangan untuk HP lewat http://IP
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

const pxTxt = (v) => (+v).toPrecision(6).replace(/\.?0+$/, "");

const IT_TF_MIN = { "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "2h": 120, "4h": 240, "6h": 360, "8h": 480, "12h": 720, "1d": 1440 };

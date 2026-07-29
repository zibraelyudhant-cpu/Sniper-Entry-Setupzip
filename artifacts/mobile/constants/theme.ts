/**
 * Design system tambahan — warna per-menu, arah, status badge, dan durasi animasi.
 * Dipakai bareng constants/colors.ts (base theme) buat semua komponen animasi baru.
 */

// ─── Warna identitas tiap menu ──────────────────────────────────────────────
export const MENU_COLORS = {
  breakout: '#22D3EE',   // Menu 1 — cyan
  sniper: '#A78BFA',     // Menu 2 — ungu
  calculator: '#FBBF24', // Menu 3 — amber
  scalping: '#FB923C',   // Menu 4 — oranye
  extremeScalping: '#F43F5E', // Menu 5 — rose/merah (kesan "extreme")
  insight: '#60A5FA',    // Menu 5 (lama, sekarang sub-tab Tools) — biru
  backtest: '#2DD4BF',   // Menu 6 (lama, sekarang sub-tab Tools) — teal
  tools: '#818CF8',      // Menu gabungan (Kalkulator+Insight+Backtest) — indigo
} as const;

export type MenuKey = keyof typeof MENU_COLORS;

// ─── Warna arah (bullish/bearish) — dipakai buat tint kartu sinyal ─────────
export const DIRECTION_COLORS = {
  bullish: {
    accent: '#4ADE80',
    glow: 'rgba(74, 222, 128, 0.15)',
    border: 'rgba(74, 222, 128, 0.25)',
    bg: '#05100D',
    text: '#86EFAC',
  },
  bearish: {
    accent: '#F87171',
    glow: 'rgba(248, 113, 113, 0.15)',
    border: 'rgba(248, 113, 113, 0.25)',
    bg: '#100505',
    text: '#FCA5A5',
  },
} as const;

// ─── Warna badge status — sengaja netral, gak dipakai buat bias arah ───────
// (biar gak ketuker sama warna bullish/bearish)
export const STATUS_COLORS = {
  in_zone: { bg: 'rgba(255,255,255,.12)', border: 'rgba(255,255,255,.3)', text: '#FFFFFF', label: 'BAGUS', icon: 'check-circle' as const, pulse: false },
  approaching: { bg: 'rgba(251,191,36,.12)', border: 'rgba(251,191,36,.35)', text: '#FBBF24', label: 'MENDEKATI', icon: 'zap' as const, pulse: true },
  waiting: { bg: 'rgba(148,163,184,.1)', border: 'rgba(148,163,184,.25)', text: '#94A3B8', label: 'WAITING', icon: 'clock' as const, pulse: false },
  ready: { bg: 'rgba(249,115,22,.12)', border: 'rgba(249,115,22,.35)', text: '#FB923C', label: 'SIAP BREAKOUT', icon: 'radio' as const, pulse: true },
  expired: { bg: 'rgba(75,85,99,.1)', border: 'rgba(75,85,99,.2)', text: '#6B7280', label: 'EXPIRED', icon: 'x-circle' as const, pulse: false },
  no_setup: { bg: 'rgba(248,113,113,.1)', border: 'rgba(248,113,113,.25)', text: '#F87171', label: 'NO SETUP', icon: 'slash' as const, pulse: false },
  skip: { bg: 'rgba(107,114,128,.1)', border: 'rgba(107,114,128,.2)', text: '#6B7280', label: 'SKIP', icon: 'skip-forward' as const, pulse: false },
} as const;

export type StatusKey = keyof typeof STATUS_COLORS;

// ─── Warna monitoring health (Menu 5 — Insight) ────────────────────────────
export const HEALTH_COLORS = {
  aman: { bg: '#0D1A15', border: 'rgba(74,222,128,.3)', badgeBg: 'rgba(74,222,128,.15)', badgeText: '#4ADE80', bar: '#4ADE80' },
  warning: { bg: '#1A170D', border: 'rgba(251,191,36,.35)', badgeBg: 'rgba(251,191,36,.15)', badgeText: '#FBBF24', bar: '#FBBF24' },
  close: { bg: '#1A0D0D', border: 'rgba(248,113,113,.4)', badgeBg: 'rgba(248,113,113,.18)', badgeText: '#F87171', bar: '#F87171' },
} as const;

// ─── Durasi & easing animasi standar ───────────────────────────────────────
export const ANIM = {
  fast: 150,
  base: 250,
  slow: 400,
  entrance: 500,
  staggerGap: 80, // jeda antar elemen buat efek staggered entrance
} as const;
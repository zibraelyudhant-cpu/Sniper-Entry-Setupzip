import React, { useEffect, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';

// ═══════════════════════════════════════════════════════════════════════════
// Pengaturan Fibonacci Retest rp11 (2026-11-10): posisi limit di dalam cluster + trade saat SIDEWAYS.
// Tersimpan di HP, dikirim ke server sebagai query limitPct / sideways (scan dan Analisa).
// ═══════════════════════════════════════════════════════════════════════════

export type FiboSettings = { limitPct: number; sideways: boolean };
export const FIBO_LIMIT_OPTIONS = [0, 25, 50, 60, 75, 100];
const DEFAULTS: FiboSettings = { limitPct: 60, sideways: false };
const KEY = 'fibo_retest_settings_v1';

let state: FiboSettings = { ...DEFAULTS };
let loaded = false;
const subs = new Set<(s: FiboSettings) => void>();
function emit() { for (const f of subs) f(state); }
async function load() {
  if (loaded) return; loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<FiboSettings>;
      state = {
        limitPct: typeof p.limitPct === 'number' && FIBO_LIMIT_OPTIONS.includes(p.limitPct) ? p.limitPct : DEFAULTS.limitPct,
        sideways: p.sideways === true,
      };
      emit();
    }
  } catch { /* pakai default */ }
}
export function setFiboSettings(patch: Partial<FiboSettings>) {
  state = { ...state, ...patch }; emit();
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}
export function useFiboSettings(): FiboSettings {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); load(); setS(state); return () => { subs.delete(setS); }; }, []);
  return s;
}
/** Query string untuk API (/api/breakout dan /api/breakout/scan). */
export const fiboQuery = (s: FiboSettings) => `limitPct=${s.limitPct}&sideways=${s.sideways ? 'true' : 'false'}`;

export function FiboSettingsPanel({ accent }: { accent: string }) {
  const colors = useColors();
  const s = useFiboSettings();
  return (
    <View style={{ marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 8 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>Posisi limit di dalam cluster</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {FIBO_LIMIT_OPTIONS.map(p => {
          const on = s.limitPct === p;
          return (
            <Pressable key={p} onPress={() => setFiboSettings({ limitPct: p })} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: on ? accent : colors.border, backgroundColor: on ? `${accent}22` : colors.card }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: on ? accent : colors.mutedForeground }}>{p}%</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>0% = tepi luar (BUY tepi atas, SELL tepi bawah) · 100% = tepi dalam · default 60%</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground, flex: 1 }}>Trade saat SIDEWAYS (di antara EMA800 & EMA1120)</Text>
        <Switch value={s.sideways} onValueChange={v => setFiboSettings({ sideways: v })} trackColor={{ true: accent, false: colors.border }} />
      </View>
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Pengaturan dipakai saat Scan dimulai dan saat Analisa koin. Ubah lalu scan ulang supaya hasil ikut berubah.</Text>
    </View>
  );
}

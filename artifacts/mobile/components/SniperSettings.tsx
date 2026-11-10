import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColors } from '@/hooks/useColors';

// ═══════════════════════════════════════════════════════════════════════════
// Pengaturan Sniper Breakout bk6 (2026-11-10): level fib entry + batas Fib H1.
// Tersimpan di HP, dikirim ke server sebagai query fibEntry / h1Fib (scan dan Analisa).
// ═══════════════════════════════════════════════════════════════════════════

export type SniperSettings = { fibEntry: number; h1Fib: number };
export const SNIPER_FIB_ENTRY_OPTIONS = [0.5, 0.559, 0.618];
export const SNIPER_H1_FIB_OPTIONS = [0.618, 0.705, 0.786];
const DEFAULTS: SniperSettings = { fibEntry: 0.559, h1Fib: 0.705 };
const KEY = 'sniper_bk6_settings_v1';

let state: SniperSettings = { ...DEFAULTS };
let loaded = false;
const subs = new Set<(s: SniperSettings) => void>();
function emit() { for (const f of subs) f(state); }
async function load() {
  if (loaded) return; loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SniperSettings>;
      state = {
        fibEntry: typeof p.fibEntry === 'number' && SNIPER_FIB_ENTRY_OPTIONS.includes(p.fibEntry) ? p.fibEntry : DEFAULTS.fibEntry,
        h1Fib: typeof p.h1Fib === 'number' && SNIPER_H1_FIB_OPTIONS.includes(p.h1Fib) ? p.h1Fib : DEFAULTS.h1Fib,
      };
      emit();
    }
  } catch { /* pakai default */ }
}
export function setSniperSettings(patch: Partial<SniperSettings>) {
  state = { ...state, ...patch }; emit();
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}
export function useSniperSettings(): SniperSettings {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); load(); setS(state); return () => { subs.delete(setS); }; }, []);
  return s;
}
export const sniperQuery = (s: SniperSettings) => `fibEntry=${s.fibEntry}&h1Fib=${s.h1Fib}`;
const lbl = (x: number) => String(x).replace('.', ',');

function Row({ title, options, value, onPick, accent }: { title: string; options: number[]; value: number; onPick: (v: number) => void; accent: string }) {
  const colors = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.map(p => {
          const on = value === p;
          return (
            <Pressable key={p} onPress={() => onPick(p)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: on ? accent : colors.border, backgroundColor: on ? `${accent}22` : colors.card }}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: on ? accent : colors.mutedForeground }}>{lbl(p)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SniperSettingsPanel({ accent }: { accent: string }) {
  const colors = useColors();
  const s = useSniperSettings();
  return (
    <View style={{ marginHorizontal: 12, marginTop: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 8 }}>
      <Row title="Level fib entry (tanpa FVG/SNR di zona; default 0,559)" options={SNIPER_FIB_ENTRY_OPTIONS} value={s.fibEntry} onPick={v => setSniperSettings({ fibEntry: v })} accent={accent} />
      <Row title="Batas Fib H1 (struktur patah; default 0,705)" options={SNIPER_H1_FIB_OPTIONS} value={s.h1Fib} onPick={v => setSniperSettings({ h1Fib: v })} accent={accent} />
      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>Pengaturan dipakai saat Scan dimulai dan saat Analisa koin. Ubah lalu scan ulang supaya hasil ikut berubah.</Text>
    </View>
  );
}

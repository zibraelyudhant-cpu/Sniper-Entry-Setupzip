import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, Rect, G, Line, Path, Text as SvgText } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * Komponen chart buat Menu Journal (request user: "UI-nya terlalu simple,
 * cuma teks, gak ada grafik"). Dibikin pakai react-native-svg yang UDAH ADA
 * di project (dipake ScanLoading/FuturisticBackground) — GAK nambah
 * dependency baru.
 */

// ─── Donut Chart — buat win rate ────────────────────────────────────────────
export function DonutChart({
  percentage, size = 120, strokeWidth = 12, color, label, sublabel,
}: {
  percentage: number; size?: number; strokeWidth?: number;
  color: string; label: string; sublabel?: string;
}) {
  const colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Track */}
        <Circle
          cx={size / 2} cy={size / 2} r={radius}
          stroke={colors.border} strokeWidth={strokeWidth} fill="none"
        />
        {/* Progress — rotate -90 biar mulai dari atas */}
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={color} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <Text style={{ fontSize: size * 0.22, fontFamily: 'Inter_700Bold', color }}>{label}</Text>
      {sublabel && (
        <Text style={{ fontSize: size * 0.09, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 }}>{sublabel}</Text>
      )}
    </View>
  );
}

// ─── Stacked Bar — proporsi WIN/LOSE/PENDING dalam 1 baris ──────────────────
export function StackedBar({
  segments, height = 10,
}: {
  segments: { value: number; color: string }[]; height?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total === 0) return null;
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden' }}>
      {segments.map((s, i) => (
        s.value > 0 ? (
          <View key={i} style={{ flex: s.value / total, backgroundColor: s.color }} />
        ) : null
      ))}
    </View>
  );
}

// ─── Horizontal Bar Chart — buat breakdown per menu/skill ───────────────────
export function HorizontalBarChart({
  data, maxValue,
}: {
  data: { label: string; value: number; color: string; caption?: string }[];
  maxValue?: number;
}) {
  const colors = useColors();
  const max = maxValue ?? Math.max(...data.map(d => d.value), 1);
  return (
    <View style={{ gap: 10 }}>
      {data.map((d, i) => (
        <View key={i}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.foreground, flex: 1 }} numberOfLines={1}>{d.label}</Text>
            <Text style={{ fontSize: 11, fontFamily: 'Inter_700Bold', color: d.color, marginLeft: 8 }}>{d.value}%</Text>
          </View>
          <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, (d.value / max) * 100)}%`, height: '100%', backgroundColor: d.color, borderRadius: 4 }} />
          </View>
          {d.caption && (
            <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 3 }}>{d.caption}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Diverging Bar — buat perbandingan WIN vs LOSE per indikator ────────────
// Dua batang berlawanan arah dari tengah, biar langsung kelihatan mana yang
// lebih tinggi TANPA harus baca angkanya satu-satu.
export function DivergingBar({
  winValue, loseValue, unit = '',
}: {
  winValue: number; loseValue: number; unit?: string;
}) {
  const colors = useColors();
  const max = Math.max(Math.abs(winValue), Math.abs(loseValue), 0.0001);
  const winPct = (Math.abs(winValue) / max) * 100;
  const losePct = (Math.abs(loseValue) / max) * 100;

  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.bullish, width: 26 }}>WIN</Text>
        <View style={{ flex: 1, height: 7, backgroundColor: colors.border, borderRadius: 3.5, overflow: 'hidden' }}>
          <View style={{ width: `${winPct}%`, height: '100%', backgroundColor: colors.bullish, borderRadius: 3.5 }} />
        </View>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.bullish, width: 52, textAlign: 'right' }}>{winValue}{unit}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.bearish, width: 26 }}>LOSE</Text>
        <View style={{ flex: 1, height: 7, backgroundColor: colors.border, borderRadius: 3.5, overflow: 'hidden' }}>
          <View style={{ width: `${losePct}%`, height: '100%', backgroundColor: colors.bearish, borderRadius: 3.5 }} />
        </View>
        <Text style={{ fontSize: 10, fontFamily: 'Inter_700Bold', color: colors.bearish, width: 52, textAlign: 'right' }}>{loseValue}{unit}</Text>
      </View>
    </View>
  );
}

// ─── Timing Comparison — visual SL vs TP speed ──────────────────────────────
export function TimingBar({
  hoursToSl, hoursToTp,
}: {
  hoursToSl: number | null; hoursToTp: number | null;
}) {
  const colors = useColors();
  if (hoursToSl === null && hoursToTp === null) return null;
  const max = Math.max(hoursToSl ?? 0, hoursToTp ?? 0, 0.1);

  const fmt = (h: number) => h < 1 ? `${Math.round(h * 60)} mnt` : `${h.toFixed(1)} jam`;

  return (
    <View style={{ gap: 6 }}>
      {hoursToSl !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.bearish, width: 22 }}>SL</Text>
          <View style={{ flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${(hoursToSl / max) * 100}%`, height: '100%', backgroundColor: colors.bearish, borderRadius: 4 }} />
          </View>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, width: 56, textAlign: 'right' }}>{fmt(hoursToSl)}</Text>
        </View>
      )}
      {hoursToTp !== null && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.bullish, width: 22 }}>TP</Text>
          <View style={{ flex: 1, height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
            <View style={{ width: `${(hoursToTp / max) * 100}%`, height: '100%', backgroundColor: colors.bullish, borderRadius: 4 }} />
          </View>
          <Text style={{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, width: 56, textAlign: 'right' }}>{fmt(hoursToTp)}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Stat Tile — angka besar + label, buat grid metrik ──────────────────────
export function StatTile({
  value, label, color, sublabel,
}: {
  value: string | number; label: string; color: string; sublabel?: string;
}) {
  const colors = useColors();
  return (
    <View style={{
      flex: 1, minWidth: 78, backgroundColor: `${color}12`, borderRadius: 10,
      padding: 10, borderWidth: 1, borderColor: `${color}30`,
    }}>
      <Text style={{ fontSize: 20, fontFamily: 'Inter_700Bold', color }}>{value}</Text>
      <Text style={{ fontSize: 9, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, letterSpacing: 0.3, marginTop: 2 }}>{label}</Text>
      {sublabel && (
        <Text style={{ fontSize: 8, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 1 }}>{sublabel}</Text>
      )}
    </View>
  );
}

// ─── Sparkline — tren win rate dari waktu ke waktu ──────────────────────────
export function Sparkline({
  values, width = 280, height = 48, color,
}: {
  values: number[]; width?: number; height?: number; color: string;
}) {
  const colors = useColors();
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  // Area fill di bawah garis
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  return (
    <Svg width={width} height={height}>
      {/* Garis referensi breakeven 33% (RR 1:2) */}
      {min <= 33 && max >= 33 && (
        <Line
          x1={0} y1={height - ((33 - min) / range) * height}
          x2={width} y2={height - ((33 - min) / range) * height}
          stroke={colors.mutedForeground} strokeWidth={1} strokeDasharray="3,3" opacity={0.5}
        />
      )}
      <Path d={areaD} fill={color} opacity={0.12} />
      <Path d={pathD} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
      ))}
    </Svg>
  );
}

// ─── Heatmap kondisi lose per skill (request user) ──────────────────────────
export function LoseConditionHeatmap({
  rows, columns,
}: {
  rows: { label: string; cells: { pct: number; caption?: string }[] }[];
  columns: string[];
}) {
  const colors = useColors();
  if (rows.length === 0) return null;

  // Opacity proporsional ke persentase — makin sering muncul, makin pekat
  const cellBg = (pct: number) => `rgba(255,78,78,${Math.max(0.08, Math.min(0.62, pct / 100)).toFixed(2)})`;
  const cellText = (pct: number) => pct >= 40 ? '#FFFFFF' : pct >= 25 ? colors.foreground : colors.mutedForeground;

  return (
    <View>
      {/* Legenda gradasi */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, marginBottom: 12 }}>
        <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>jarang</Text>
        <View style={{ flexDirection: 'row', width: 44, height: 6, borderRadius: 3, overflow: 'hidden' }}>
          {[0.12, 0.25, 0.4, 0.55, 0.62].map((o, i) => (
            <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,78,78,${o})` }} />
          ))}
        </View>
        <Text style={{ fontSize: 9, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }}>sering</Text>
      </View>

      {/* Header kolom */}
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
        <View style={{ width: 78 }} />
        {columns.map((col, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }} numberOfLines={1}>{col}</Text>
        ))}
      </View>

      {/* Baris data */}
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <Text style={{ width: 78, fontSize: 11, fontFamily: 'Inter_500Medium', color: colors.foreground }} numberOfLines={2}>{row.label}</Text>
          {row.cells.map((cell, ci) => (
            <View key={ci} style={{
              flex: 1, height: 44, borderRadius: 8,
              backgroundColor: cellBg(cell.pct),
              borderWidth: 1, borderColor: `rgba(255,78,78,${Math.max(0.1, Math.min(0.5, cell.pct / 130)).toFixed(2)})`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 14, fontFamily: 'Inter_600SemiBold', color: cellText(cell.pct) }}>{cell.pct}%</Text>
              {cell.caption && (
                <Text style={{ fontSize: 8, fontFamily: 'Inter_400Regular', color: cell.pct >= 40 ? 'rgba(255,255,255,0.6)' : colors.mutedForeground }}>{cell.caption}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Trend chart lengkap — grid berlabel, titik bernilai, bar volume ────────
export function TrendChart({
  points, breakevenPct, width = 300, height = 176,
}: {
  points: { label: string; winRate: number; count: number }[];
  breakevenPct: number;
  width?: number; height?: number;
}) {
  const colors = useColors();
  if (points.length < 2) return null;

  const padLeft = 26, padBottom = 34, padTop = 8;
  const chartW = width - padLeft;
  const chartH = height - padBottom - padTop;

  const maxWr = Math.max(...points.map(p => p.winRate), breakevenPct, 50);
  const yFor = (v: number) => padTop + chartH * (1 - v / maxWr);
  const xFor = (i: number) => padLeft + (chartW / (points.length - 1)) * i;

  const maxCount = Math.max(...points.map(p => p.count), 1);
  const barMaxH = 22;

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.winRate).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xFor(points.length - 1).toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${padLeft} ${(padTop + chartH).toFixed(1)} Z`;

  const gridLines = [maxWr, maxWr * 0.75, maxWr * 0.5, maxWr * 0.25];
  const dotColor = (wr: number) => wr >= breakevenPct + 5 ? colors.bullish : wr >= breakevenPct ? colors.gold : colors.bearish;

  return (
    <Svg width={width} height={height}>
      {/* Grid + label sumbu Y */}
      {gridLines.map((v, i) => (
        <G key={i}>
          <Line x1={padLeft} y1={yFor(v)} x2={width} y2={yFor(v)} stroke={colors.border} strokeWidth={0.5} />
          <SvgText x={0} y={yFor(v) + 3} fill={colors.mutedForeground} fontSize={9}>{Math.round(v)}%</SvgText>
        </G>
      ))}

      {/* Bar volume (jumlah sinyal) di belakang */}
      {points.map((p, i) => {
        const bw = Math.min(24, chartW / points.length * 0.55);
        const bh = (p.count / maxCount) * barMaxH;
        return (
          <Rect key={i}
            x={xFor(i) - bw / 2} y={padTop + chartH - bh}
            width={bw} height={bh} rx={2}
            fill={i === points.length - 1 ? `${colors.bearish}25` : colors.border}
          />
        );
      })}

      {/* Garis breakeven */}
      <Line x1={padLeft} y1={yFor(breakevenPct)} x2={width} y2={yFor(breakevenPct)} stroke={colors.gold} strokeWidth={1} strokeDasharray="5,4" opacity={0.6} />
      <SvgText x={padLeft + 4} y={yFor(breakevenPct) - 5} fill={colors.gold} fontSize={9}>breakeven {breakevenPct}%</SvgText>

      {/* Area + garis tren */}
      <Path d={areaPath} fill={colors.bearish} opacity={0.14} />
      <Path d={linePath} stroke={colors.primary} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />

      {/* Titik + nilai */}
      {points.map((p, i) => {
        const isLast = i === points.length - 1;
        return (
          <G key={i}>
            {isLast && <Circle cx={xFor(i)} cy={yFor(p.winRate)} r={10} fill={dotColor(p.winRate)} opacity={0.18} />}
            <Circle cx={xFor(i)} cy={yFor(p.winRate)} r={isLast ? 4.5 : 3.5} fill={colors.card} stroke={dotColor(p.winRate)} strokeWidth={2} />
            {(isLast || i === 0) && (
              <SvgText x={xFor(i)} y={yFor(p.winRate) - 10} fill={dotColor(p.winRate)} fontSize={10} textAnchor="middle">{p.winRate}%</SvgText>
            )}
            <SvgText x={xFor(i)} y={height - 6} fill={isLast ? colors.foreground : colors.mutedForeground} fontSize={9} textAnchor="middle">{p.label}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

// ─── Diagram jarak SL vs TP relatif ATR — jelasin KENAPA timing timpang ─────
export function SlTpDistanceDiagram({
  slAtr, tpAtr, width = 300, height = 108,
}: {
  slAtr: number; tpAtr: number; width?: number; height?: number;
}) {
  const colors = useColors();
  const total = slAtr + tpAtr;
  if (total <= 0) return null;

  const entryX = width * (slAtr / total);
  const midY = 46;

  return (
    <Svg width={width} height={height}>
      {/* Zona rugi (kiri) & zona profit (kanan) */}
      <Rect x={0} y={midY - 17} width={entryX} height={34} rx={5} fill={colors.bearish} opacity={0.14} />
      <Rect x={entryX} y={midY - 17} width={width - entryX} height={34} rx={5} fill={colors.bullish} opacity={0.14} />

      {/* Garis entry */}
      <Line x1={entryX} y1={midY - 27} x2={entryX} y2={midY + 27} stroke={colors.foreground} strokeWidth={1.5} />
      <Circle cx={entryX} cy={midY} r={5} fill={colors.card} stroke={colors.foreground} strokeWidth={2} />
      <SvgText x={entryX} y={midY - 32} fill={colors.foreground} fontSize={10} textAnchor="middle">entry</SvgText>

      {/* Titik SL & TP */}
      <Circle cx={5} cy={midY} r={4} fill={colors.bearish} />
      <SvgText x={4} y={midY + 38} fill={colors.bearish} fontSize={10}>SL</SvgText>
      <SvgText x={4} y={midY + 51} fill={colors.mutedForeground} fontSize={9}>{slAtr.toFixed(2)}x ATR</SvgText>

      <Circle cx={width - 5} cy={midY} r={4} fill={colors.bullish} />
      <SvgText x={width - 4} y={midY + 38} fill={colors.bullish} fontSize={10} textAnchor="end">TP</SvgText>
      <SvgText x={width - 4} y={midY + 51} fill={colors.mutedForeground} fontSize={9} textAnchor="end">{tpAtr.toFixed(2)}x ATR</SvgText>

      {/* Garis jarak */}
      <Line x1={entryX - 8} y1={midY} x2={14} y2={midY} stroke={colors.bearish} strokeWidth={1.5} strokeDasharray="3,3" />
      <Line x1={entryX + 8} y1={midY} x2={width - 14} y2={midY} stroke={colors.bullish} strokeWidth={1.5} strokeDasharray="3,3" />

      <SvgText x={entryX / 2} y={midY - 4} fill={colors.bearish} fontSize={9} textAnchor="middle">dekat</SvgText>
      <SvgText x={entryX + (width - entryX) / 2} y={midY - 4} fill={colors.bullish} fontSize={9} textAnchor="middle">
        jauh — {(tpAtr / slAtr).toFixed(1)}x lipat
      </SvgText>
    </Svg>
  );
}
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useGetPatterns } from '@workspace/api-client-react';
import type { TFPatterns, PatternResult } from '@workspace/api-client-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_PATTERNS = [
  'Bull Flag',
  'Bear Flag',
  'Ascending Triangle',
  'Descending Triangle',
  'Symmetrical Triangle',
  'Pennant',
  'Double Top',
  'Double Bottom',
  'Head & Shoulders',
  'Inverse H&S',
  'Rising Wedge',
  'Falling Wedge',
  'Cup and Handle',
] as const;

const TIMEFRAMES = ['H4', 'H1', 'M30', 'M15', 'M5'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPatternMeta(name: string): { category: string; direction: string } {
  const continuation = ['Bull Flag', 'Bear Flag', 'Ascending Triangle', 'Descending Triangle', 'Symmetrical Triangle', 'Pennant', 'Cup and Handle'];
  const bullish = ['Bull Flag', 'Ascending Triangle', 'Double Bottom', 'Inverse H&S', 'Falling Wedge', 'Cup and Handle'];
  return {
    category: continuation.includes(name) ? 'continuation' : 'reversal',
    direction: bullish.includes(name) ? 'bullish' : 'bearish',
  };
}

function findPattern(tf: TFPatterns, name: string): PatternResult | undefined {
  return tf.patterns.find(p => p.name === name);
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

function PatternCell({
  pattern,
  colors,
  onPress,
}: {
  pattern: PatternResult | undefined;
  colors: ReturnType<typeof useColors>;
  onPress?: () => void;
}) {
  if (!pattern) {
    return (
      <View style={[styles.cell, styles.cellEmpty]}>
        <Text style={[styles.cellDash, { color: colors.border }]}>—</Text>
      </View>
    );
  }

  const confColor =
    pattern.confidence === 'high'
      ? colors.bullish
      : pattern.confidence === 'medium'
      ? colors.gold
      : colors.mutedForeground;

  const dirIcon = pattern.direction === 'bullish' ? '▲' : '▼';
  const dirColor = pattern.direction === 'bullish' ? colors.bullish : colors.bearish;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        styles.cellActive,
        {
          backgroundColor: `${confColor}15`,
          borderColor: confColor,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.cellIcon, { color: dirColor }]}>{dirIcon}</Text>
      <View style={[styles.cellDot, { backgroundColor: confColor }]} />
    </Pressable>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────


// ─── Pattern SVG Illustrations ───────────────────────────────────────────────

function PatternIllustration({ name, direction, colors }: {
  name: string;
  direction: 'bullish' | 'bearish';
  colors: ReturnType<typeof useColors>;
}) {
  const bull = colors.bullish;
  const bear = colors.bearish;
  const muted = colors.mutedForeground;
  const line = direction === 'bullish' ? bull : bear;
  // Helper: candlestick mini
  const Candle = ({ x, open, close, high, low, color }: { x: number; open: number; close: number; high: number; low: number; color: string }) => (
    <>
      <line x1={x+4} y1={high} x2={x+4} y2={low} stroke={color} strokeWidth="1"/>
      <rect x={x} y={Math.min(open, close)} width="8" height={Math.max(Math.abs(open - close), 2)} fill={color} rx="1"/>
    </>
  );

  const illustrations: Record<string, React.ReactNode> = {
    'Bull Flag': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* BG grid */}
        <line x1="0" y1="110" x2="300" y2="110" stroke="#222" strokeWidth="1"/>
        {/* Pole — candle hijau naik */}
        <Candle x={20} open={100} close={80} high={78} low={102} color={bull}/>
        <Candle x={35} open={80} close={58} high={56} low={82} color={bull}/>
        <Candle x={50} open={58} close={35} high={33} low={60} color={bull}/>
        <Candle x={65} open={35} close={18} high={16} low={37} color={bull}/>
        {/* Flag — channel datar/turun sedikit */}
        <Candle x={88} open={22} close={28} high={20} low={30} color={bear}/>
        <Candle x={103} open={26} close={24} high={22} low={32} color={bull}/>
        <Candle x={118} open={28} close={32} high={26} low={34} color={bear}/>
        <Candle x={133} open={30} close={26} high={24} low={36} color={bull}/>
        <Candle x={148} open={28} close={34} high={26} low={36} color={bear}/>
        {/* Channel lines */}
        <line x1="85" y1="20" x2="165" y2="25" stroke={muted} strokeWidth="1" strokeDasharray="4,2" opacity="0.7"/>
        <line x1="85" y1="35" x2="165" y2="38" stroke={muted} strokeWidth="1" strokeDasharray="4,2" opacity="0.7"/>
        {/* Breakout */}
        <Candle x={175} open={30} close={8} high={6} low={32} color={bull}/>
        <Candle x={195} open={8} close={3} high={1} low={10} color={bull}/>
        {/* Arrow */}
        <line x1="210" y1="4" x2="240" y2="4" stroke={bull} strokeWidth="1.5" opacity="0.4"/>
        {/* Labels */}
        <text x="38" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pole</text>
        <text x="127" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Flag</text>
        <text x="200" y="118" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Breakout ↑</text>
        {/* Pole bracket */}
        <line x1="80" y1="16" x2="80" y2="105" stroke={muted} strokeWidth="0.5" opacity="0.3"/>
        <line x1="166" y1="16" x2="166" y2="105" stroke={muted} strokeWidth="0.5" opacity="0.3"/>
      </svg>
    ),
    'Bear Flag': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        <line x1="0" y1="110" x2="300" y2="110" stroke="#222" strokeWidth="1"/>
        {/* Pole — candle merah turun */}
        <Candle x={20} open={20} close={35} high={18} low={37} color={bear}/>
        <Candle x={35} open={35} close={52} high={33} low={54} color={bear}/>
        <Candle x={50} open={52} close={70} high={50} low={72} color={bear}/>
        <Candle x={65} open={70} close={88} high={68} low={90} color={bear}/>
        {/* Flag — channel naik sedikit */}
        <Candle x={88} open={84} close={78} high={76} low={86} color={bull}/>
        <Candle x={103} open={78} close={82} high={76} low={84} color={bear}/>
        <Candle x={118} open={80} close={74} high={72} low={82} color={bull}/>
        <Candle x={133} open={76} close={80} high={74} low={82} color={bear}/>
        <Candle x={148} open={78} close={72} high={70} low={80} color={bull}/>
        <line x1="85" y1="75" x2="165" y2="68" stroke={muted} strokeWidth="1" strokeDasharray="4,2" opacity="0.7"/>
        <line x1="85" y1="87" x2="165" y2="82" stroke={muted} strokeWidth="1" strokeDasharray="4,2" opacity="0.7"/>
        {/* Breakdown */}
        <Candle x={175} open={72} close={92} high={70} low={94} color={bear}/>
        <Candle x={195} open={92} close={105} high={90} low={107} color={bear}/>
        <line x1="210" y1="106" x2="240" y2="106" stroke={bear} strokeWidth="1.5" opacity="0.4"/>
        {/* Labels */}
        <text x="38" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pole</text>
        <text x="127" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Flag</text>
        <text x="200" y="118" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Breakdown ↓</text>
      </svg>
    ),
    'Ascending Triangle': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Resistance flat */}
        <line x1="20" y1="25" x2="240" y2="25" stroke={bear} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.8"/>
        {/* Support naik */}
        <line x1="20" y1="100" x2="210" y2="28" stroke={bull} strokeWidth="1.5"/>
        {/* Area shading */}
        <polygon points="20,25 20,100 210,28" fill={bull} fillOpacity="0.06"/>
        {/* Candles bouncing dari support naik */}
        <Candle x={25} open={95} close={35} high={33} low={97} color={bull}/>
        <Candle x={60} open={70} close={30} high={28} low={72} color={bull}/>
        <Candle x={95} open={55} close={28} high={26} low={57} color={bull}/>
        <Candle x={130} open={42} close={27} high={25} low={44} color={bull}/>
        <Candle x={165} open={32} close={26} high={24} low={34} color={bull}/>
        {/* Breakout */}
        <Candle x={215} open={24} close={8} high={6} low={26} color={bull}/>
        <Candle x={240} open={8} close={2} high={0} low={10} color={bull}/>
        {/* Labels */}
        <text x="130" y="18" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Resistance Flat</text>
        <text x="80" y="115" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Support Naik</text>
        <text x="255" y="10" fontSize="9" fill={bull} fontFamily="Inter">↑</text>
      </svg>
    ),
    'Descending Triangle': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Support flat */}
        <line x1="20" y1="100" x2="240" y2="100" stroke={bull} strokeWidth="1.5" strokeDasharray="6,3" opacity="0.8"/>
        {/* Resistance turun */}
        <line x1="20" y1="20" x2="210" y2="97" stroke={bear} strokeWidth="1.5"/>
        {/* Area shading */}
        <polygon points="20,100 20,20 210,97" fill={bear} fillOpacity="0.06"/>
        {/* Candles */}
        <Candle x={25} open={25} close={95} high={23} low={97} color={bear}/>
        <Candle x={60} open={48} close={93} high={46} low={95} color={bear}/>
        <Candle x={95} open={60} close={95} high={58} low={97} color={bear}/>
        <Candle x={130} open={72} close={97} high={70} low={99} color={bear}/>
        <Candle x={165} open={82} close={96} high={80} low={98} color={bear}/>
        {/* Breakdown */}
        <Candle x={215} open={100} close={115} high={98} low={117} color={bear}/>
        <Candle x={240} open={115} close={125} high={113} low={127} color={bear}/>
        {/* Labels */}
        <text x="100" y="14" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Resistance Turun</text>
        <text x="130" y="115" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Support Flat</text>
        <text x="255" y="128" fontSize="9" fill={bear} fontFamily="Inter">↓</text>
      </svg>
    ),
    'Symmetrical Triangle': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Resistance turun */}
        <line x1="15" y1="15" x2="195" y2="58" stroke={bear} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.8"/>
        {/* Support naik */}
        <line x1="15" y1="110" x2="195" y2="63" stroke={bull} strokeWidth="1.5" strokeDasharray="5,3" opacity="0.8"/>
        {/* Area shading */}
        <polygon points="15,15 15,110 195,60" fill={muted} fillOpacity="0.05"/>
        {/* Candles konvergen */}
        <Candle x={20} open={20} close={100} high={15} low={108} color={muted}/>
        <Candle x={50} open={35} close={85} high={30} low={90} color={muted}/>
        <Candle x={80} open={45} close={75} high={40} low={80} color={muted}/>
        <Candle x={110} open={52} close={70} high={48} low={74} color={muted}/>
        <Candle x={140} open={57} close={65} high={54} low={68} color={muted}/>
        <Candle x={170} open={59} close={63} high={57} low={65} color={muted}/>
        {/* Breakout */}
        <Candle x={205} open={60} close={direction === 'bullish' ? 35 : 85} high={direction === 'bullish' ? 33 : 58} low={direction === 'bullish' ? 62 : 87} color={line}/>
        <Candle x={230} open={direction === 'bullish' ? 35 : 85} close={direction === 'bullish' ? 15 : 105} high={direction === 'bullish' ? 13 : 83} low={direction === 'bullish' ? 37 : 107} color={line}/>
        {/* Labels */}
        <text x="80" y="10" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">HH Turun</text>
        <text x="80" y="124" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">HL Naik</text>
        <text x="248" y={direction === 'bullish' ? 20 : 115} fontSize="10" fill={line} fontFamily="Inter">{direction === 'bullish' ? '↑' : '↓'}</text>
      </svg>
    ),
    'Pennant': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Pole */}
        {direction === 'bullish' ? (
          <>
            <Candle x={10} open={105} close={85} high={83} low={107} color={bull}/>
            <Candle x={25} open={85} close={65} high={63} low={87} color={bull}/>
            <Candle x={40} open={65} close={42} high={40} low={67} color={bull}/>
            <Candle x={55} open={42} close={22} high={20} low={44} color={bull}/>
            {/* Pennant top/bottom converging */}
            <line x1="72" y1="20" x2="155" y2="48" stroke={muted} strokeWidth="1.2" strokeDasharray="4,2" opacity="0.8"/>
            <line x1="72" y1="30" x2="155" y2="50" stroke={muted} strokeWidth="1.2" strokeDasharray="4,2" opacity="0.8"/>
            <polygon points="72,20 72,30 155,50 155,48" fill={muted} fillOpacity="0.07"/>
            <Candle x={75} open={28} close={22} high={20} low={32} color={bear}/>
            <Candle x={95} open={25} close={29} high={23} low={31} color={bull}/>
            <Candle x={115} open={30} close={26} high={24} low={35} color={bear}/>
            <Candle x={135} open={28} close={32} high={26} low={34} color={bull}/>
            {/* Breakout */}
            <Candle x={165} open={46} close={18} high={16} low={48} color={bull}/>
            <Candle x={190} open={18} close={5} high={3} low={20} color={bull}/>
            <text x="35" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pole</text>
            <text x="115" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pennant</text>
            <text x="200" y="118" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">BO ↑</text>
          </>
        ) : (
          <>
            <Candle x={10} open={25} close={45} high={23} low={47} color={bear}/>
            <Candle x={25} open={45} close={65} high={43} low={67} color={bear}/>
            <Candle x={40} open={65} close={85} high={63} low={87} color={bear}/>
            <Candle x={55} open={85} close={105} high={83} low={107} color={bear}/>
            <line x1="72" y1="103" x2="155" y2="75" stroke={muted} strokeWidth="1.2" strokeDasharray="4,2" opacity="0.8"/>
            <line x1="72" y1="95" x2="155" y2="73" stroke={muted} strokeWidth="1.2" strokeDasharray="4,2" opacity="0.8"/>
            <polygon points="72,95 72,103 155,75 155,73" fill={muted} fillOpacity="0.07"/>
            <Candle x={75} open={98} close={104} high={96} low={106} color={bull}/>
            <Candle x={95} open={101} close={97} high={95} low={103} color={bear}/>
            <Candle x={115} open={97} close={101} high={95} low={103} color={bull}/>
            <Candle x={135} open={99} close={96} high={94} low={101} color={bear}/>
            <Candle x={165} open={77} close={105} high={75} low={107} color={bear}/>
            <Candle x={190} open={105} close={120} high={103} low={122} color={bear}/>
            <text x="35" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pole</text>
            <text x="115" y="118" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">Pennant</text>
            <text x="200" y="118" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">BO ↓</text>
          </>
        )}
      </svg>
    ),
    'Double Top': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Price path */}
        <polyline points="10,100 40,100 70,30 100,100 130,30 160,100 190,100" stroke={bear} strokeWidth="1.5" fill="none"/>
        {/* Shading top areas */}
        <polygon points="40,100 70,30 100,100" fill={bear} fillOpacity="0.12"/>
        <polygon points="100,100 130,30 160,100" fill={bear} fillOpacity="0.12"/>
        {/* Neckline */}
        <line x1="10" y1="100" x2="240" y2="100" stroke={muted} strokeWidth="1.2" strokeDasharray="6,3" opacity="0.7"/>
        {/* Breakdown candles */}
        <Candle x={198} open={100} close={112} high={98} low={114} color={bear}/>
        <Candle x={218} open={112} close={122} high={110} low={124} color={bear}/>
        <Candle x={238} open={122} close={127} high={120} low={129} color={bear}/>
        {/* Labels */}
        <text x="70" y="22" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Top 1</text>
        <text x="130" y="22" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Top 2</text>
        <text x="120" y="115" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">— Neckline —</text>
        <text x="240" y="127" fontSize="9" fill={bear} fontFamily="Inter">↓</text>
      </svg>
    ),
    'Double Bottom': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Price path */}
        <polyline points="10,30 40,30 70,100 100,30 130,100 160,30 190,30" stroke={bull} strokeWidth="1.5" fill="none"/>
        {/* Shading bottom areas */}
        <polygon points="40,30 70,100 100,30" fill={bull} fillOpacity="0.12"/>
        <polygon points="100,30 130,100 160,30" fill={bull} fillOpacity="0.12"/>
        {/* Neckline */}
        <line x1="10" y1="30" x2="240" y2="30" stroke={muted} strokeWidth="1.2" strokeDasharray="6,3" opacity="0.7"/>
        {/* Breakout candles */}
        <Candle x={198} open={30} close={18} high={16} low={32} color={bull}/>
        <Candle x={218} open={18} close={8} high={6} low={20} color={bull}/>
        <Candle x={238} open={8} close={2} high={0} low={10} color={bull}/>
        {/* Labels */}
        <text x="70" y="118" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Bottom 1</text>
        <text x="130" y="118" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Bottom 2</text>
        <text x="120" y="20" fontSize="9" fill={muted} textAnchor="middle" fontFamily="Inter">— Neckline —</text>
        <text x="240" y="10" fontSize="9" fill={bull} fontFamily="Inter">↑</text>
      </svg>
    ),
    'Head & Shoulders': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Price curve */}
        <polyline points="5,90 30,90 50,55 70,90 120,10 170,90 190,55 210,90 250,90" stroke={bear} strokeWidth="1.8" fill="none"/>
        {/* Shoulder shading */}
        <polygon points="30,90 50,55 70,90" fill={bear} fillOpacity="0.1"/>
        <polygon points="190,90 190,55 210,90" fill={bear} fillOpacity="0.1"/>
        {/* Head shading */}
        <polygon points="70,90 120,10 170,90" fill={bear} fillOpacity="0.15"/>
        {/* Neckline */}
        <line x1="5" y1="90" x2="265" y2="90" stroke={muted} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.7"/>
        {/* Breakdown */}
        <Candle x={255} open={90} close={105} high={88} low={107} color={bear}/>
        <Candle x={275} open={105} close={118} high={103} low={120} color={bear}/>
        {/* Labels */}
        <text x="50" y="50" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">LS</text>
        <text x="120" y="5" fontSize="8" fill={bear} textAnchor="middle" fontFamily="Inter">Head</text>
        <text x="200" y="50" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">RS</text>
        <text x="135" y="105" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">Neckline</text>
        <text x="280" y="125" fontSize="10" fill={bear} fontFamily="Inter">↓</text>
      </svg>
    ),
    'Inverse H&S': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Price curve */}
        <polyline points="5,40 30,40 50,75 70,40 120,118 170,40 190,75 210,40 250,40" stroke={bull} strokeWidth="1.8" fill="none"/>
        {/* Shoulder shading */}
        <polygon points="30,40 50,75 70,40" fill={bull} fillOpacity="0.1"/>
        <polygon points="190,75 190,40 210,40" fill={bull} fillOpacity="0.1"/>
        {/* Head shading */}
        <polygon points="70,40 120,118 170,40" fill={bull} fillOpacity="0.15"/>
        {/* Neckline */}
        <line x1="5" y1="40" x2="265" y2="40" stroke={muted} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.7"/>
        {/* Breakout */}
        <Candle x={255} open={40} close={25} high={23} low={42} color={bull}/>
        <Candle x={275} open={25} close={10} high={8} low={27} color={bull}/>
        {/* Labels */}
        <text x="50" y="90" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">LS</text>
        <text x="120" y="127" fontSize="8" fill={bull} textAnchor="middle" fontFamily="Inter">Head</text>
        <text x="200" y="90" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">RS</text>
        <text x="135" y="33" fontSize="8" fill={muted} textAnchor="middle" fontFamily="Inter">Neckline</text>
        <text x="280" y="12" fontSize="10" fill={bull} fontFamily="Inter">↑</text>
      </svg>
    ),
    'Rising Wedge': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Area wedge */}
        <polygon points="10,100 10,55 200,18 200,30" fill={bear} fillOpacity="0.08"/>
        {/* Resistance naik lambat */}
        <line x1="10" y1="55" x2="200" y2="18" stroke={bear} strokeWidth="1.5" strokeDasharray="5,3"/>
        {/* Support naik cepat */}
        <line x1="10" y1="100" x2="200" y2="30" stroke={bear} strokeWidth="1.5"/>
        {/* Candles di dalam wedge */}
        <Candle x={15} open={95} close={60} high={58} low={97} color={bull}/>
        <Candle x={45} open={80} close={50} high={48} low={82} color={bull}/>
        <Candle x={75} open={68} close={42} high={40} low={70} color={bull}/>
        <Candle x={105} open={56} close={34} high={32} low={58} color={bull}/>
        <Candle x={135} open={46} close={26} high={24} low={48} color={bull}/>
        <Candle x={165} open={38} close={22} high={20} low={40} color={bull}/>
        {/* Breakdown keluar bawah */}
        <Candle x={210} open={28} close={55} high={26} low={57} color={bear}/>
        <Candle x={235} open={55} close={78} high={53} low={80} color={bear}/>
        <Candle x={260} open={78} close={98} high={76} low={100} color={bear}/>
        {/* Arrow */}
        <text x="270" y="108" fontSize="14" fill={bear} fontFamily="Inter">↓</text>
        {/* Labels */}
        <text x="100" y="12" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Resistance (lambat)</text>
        <text x="100" y="118" fontSize="9" fill={bear} textAnchor="middle" fontFamily="Inter">Support (cepat) → Bearish Reversal</text>
      </svg>
    ),
    'Falling Wedge': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        {/* Area wedge */}
        <polygon points="10,18 10,45 200,88 200,100" fill={bull} fillOpacity="0.08"/>
        {/* Resistance turun cepat */}
        <line x1="10" y1="18" x2="200" y2="88" stroke={bull} strokeWidth="1.5"/>
        {/* Support turun lambat */}
        <line x1="10" y1="45" x2="200" y2="100" stroke={bull} strokeWidth="1.5" strokeDasharray="5,3"/>
        {/* Candles di dalam wedge */}
        <Candle x={15} open={22} close={42} high={20} low={44} color={bear}/>
        <Candle x={45} open={38} close={55} high={36} low={57} color={bear}/>
        <Candle x={75} open={52} close={65} high={50} low={67} color={bear}/>
        <Candle x={105} open={62} close={74} high={60} low={76} color={bear}/>
        <Candle x={135} open={70} close={80} high={68} low={82} color={bear}/>
        <Candle x={165} open={78} close={86} high={76} low={88} color={bear}/>
        {/* Breakout keluar atas */}
        <Candle x={210} open={90} close={65} high={63} low={92} color={bull}/>
        <Candle x={235} open={65} close={42} high={40} low={67} color={bull}/>
        <Candle x={260} open={42} close={20} high={18} low={44} color={bull}/>
        {/* Arrow */}
        <text x="270" y="22" fontSize="14" fill={bull} fontFamily="Inter">↑</text>
        {/* Labels */}
        <text x="100" y="12" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Resistance (cepat) → Bullish Reversal</text>
        <text x="100" y="118" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Support (lambat)</text>
      </svg>
    ),
    'Cup and Handle': (
      <svg viewBox="0 0 300 130" width="100%" height="130">
        <line x1="0" y1="110" x2="300" y2="110" stroke="#222" strokeWidth="1"/>
        {/* Rim kiri */}
        <Candle x={15} open={40} close={35} high={33} low={42} color={bull}/>
        {/* Cup — U shape turun */}
        <Candle x={35} open={45} close={55} high={43} low={57} color={bear}/>
        <Candle x={55} open={58} close={68} high={56} low={70} color={bear}/>
        <Candle x={75} open={70} close={78} high={68} low={80} color={bear}/>
        <Candle x={95} open={80} close={82} high={78} low={84} color={bear}/>
        <Candle x={115} open={82} close={80} high={78} low={84} color={bull}/>
        <Candle x={135} open={78} close={70} high={68} low={80} color={bull}/>
        <Candle x={155} open={68} close={58} high={56} low={70} color={bull}/>
        <Candle x={175} open={55} close={42} high={40} low={57} color={bull}/>
        {/* Rim kanan */}
        <Candle x={195} open={40} close={35} high={33} low={42} color={bull}/>
        {/* Handle — konsolidasi kecil turun sedikit */}
        <Candle x={215} open={36} close={42} high={34} low={44} color={bear}/>
        <Candle x={230} open={42} close={45} high={40} low={47} color={bear}/>
        <Candle x={245} open={45} close={40} high={38} low={47} color={bull}/>
        {/* Breakout */}
        <Candle x={265} open={38} close={20} high={18} low={40} color={bull}/>
        <line x1="15" y1="35" x2="205" y2="35" stroke={bull} strokeWidth="1" strokeDasharray="3,3"/>
        <text x="100" y="12" fontSize="9" fill={bull} textAnchor="middle" fontFamily="Inter">Cup (U-shape) → Handle → Breakout</text>
        <text x="150" y="122" fontSize="8" fill={colors.mutedForeground} textAnchor="middle" fontFamily="Inter">Handle di atas 50% cup</text>
      </svg>
    ),
  };

  const illustration = illustrations[name];
  if (!illustration) return null;

  return (
    <View style={{
      backgroundColor: '#0D0D0D',
      borderRadius: 8,
      padding: 8,
      alignItems: 'center',
      marginVertical: 4,
    }}>
      <Text style={{ fontSize: 10, color: colors.mutedForeground, marginBottom: 6, fontFamily: 'Inter_400Regular', letterSpacing: 0.5 }}>
        POLA IDEAL
      </Text>
      {illustration}
    </View>
  );
}

function PatternDetail({
  pattern,
  tf,
  patternName,
  symbol,
  colors,
  onClose,
}: {
  pattern: PatternResult;
  tf: string;
  patternName: string;
  symbol: string;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
}) {
  const confColor =
    pattern.confidence === 'high'
      ? colors.bullish
      : pattern.confidence === 'medium'
      ? colors.gold
      : colors.mutedForeground;
  const dirColor = pattern.direction === 'bullish' ? colors.bullish : colors.bearish;
  const catLabel = pattern.category === 'continuation' ? 'Continuation' : 'Reversal';

  return (
    <View style={[styles.detailOverlay]}>
      <Pressable style={styles.detailBackdrop} onPress={onClose} />
      <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false} contentContainerStyle={{ padding: 20, gap: 12 }}>
        {/* Header */}
        <View style={styles.detailHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.detailName, { color: colors.foreground }]}>{patternName}</Text>
            <Text style={[styles.detailTf, { color: colors.mutedForeground }]}>Timeframe: {tf}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.detailClose}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Badges */}
        <View style={styles.detailBadges}>
          <View style={[styles.badge, { borderColor: dirColor, backgroundColor: `${dirColor}15` }]}>
            <Text style={[styles.badgeText, { color: dirColor }]}>
              {pattern.direction === 'bullish' ? '▲ BULLISH' : '▼ BEARISH'}
            </Text>
          </View>
          <View style={[styles.badge, { borderColor: colors.mutedForeground, backgroundColor: `${colors.mutedForeground}10` }]}>
            <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{catLabel.toUpperCase()}</Text>
          </View>
          <View style={[styles.badge, { borderColor: confColor, backgroundColor: `${confColor}15` }]}>
            <Text style={[styles.badgeText, { color: confColor }]}>
              {pattern.confidence.toUpperCase()} CONF
            </Text>
          </View>
        </View>

        {/* Description */}
        <View style={[styles.detailDesc, { backgroundColor: `${confColor}08`, borderLeftColor: confColor }]}>
          <Text style={[styles.detailDescText, { color: colors.foreground }]}>{pattern.description}</Text>
        </View>

        {/* TradingView Chart */}
        {symbol ? (() => {
          const tfMap: Record<string, string> = {
            H4: '240', H1: '60', M30: '30', M15: '15', M5: '5'
          };
          const interval = tfMap[tf] ?? '60';
          const coin = symbol.replace('USDT', '');
          const tvUrl = `https://www.tradingview.com/widgetembed/?symbol=BINANCE%3A${coin}USDT.P&interval=${interval}&theme=dark&style=1&locale=id&hide_top_toolbar=1&hide_legend=1&allow_symbol_change=0`;
          if (Platform.OS === 'web') {
            return (
              <View style={{ height: 220, borderRadius: 10, overflow: 'hidden', marginVertical: 4 }}>
                <iframe
                  src={tvUrl}
                  style={{ width: '100%', height: '100%', border: 'none', borderRadius: 10 }}
                  allowTransparency
                />
              </View>
            );
          }
          // Native: lazy load WebView
          const { default: WebView } = require('react-native-webview');
          const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0}body{background:#0D0D0D}</style></head><body><div class="tradingview-widget-container" style="height:220px;width:100%"><div id="tv_chart"></div><script src="https://s3.tradingview.com/tv.js"></script><script>new TradingView.widget({"width":"100%","height":220,"symbol":"BINANCE:${coin}USDT.P","interval":"${interval}","timezone":"Asia/Jakarta","theme":"dark","style":"1","locale":"id","hide_top_toolbar":true,"hide_legend":true,"container_id":"tv_chart"});</script></div></body></html>`;
          return (
            <View style={{ height: 220, borderRadius: 10, overflow: 'hidden', marginVertical: 4 }}>
              <WebView
                source={{ html }}
                style={{ flex: 1, backgroundColor: '#0D0D0D' }}
                scrollEnabled={false}
                javaScriptEnabled
                domStorageEnabled
              />
            </View>
          );
        })() : null}

        {/* Ilustrasi SVG */}
        <PatternIllustration name={patternName} direction={pattern.direction} colors={colors} />

        {/* Arti pattern */}
        <Text style={[styles.detailImplication, { color: colors.mutedForeground }]}>
          {pattern.category === 'continuation'
            ? `Pattern ini mengindikasikan trend saat ini kemungkinan akan berlanjut ke arah ${pattern.direction === 'bullish' ? 'atas' : 'bawah'}.`
            : `Pattern ini mengindikasikan kemungkinan pembalikan arah ke ${pattern.direction === 'bullish' ? 'atas (bullish)' : 'bawah (bearish)'}.`
          }
        </Text>
      </ScrollView>
    </View>
    </View>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.legend, { borderColor: colors.border }]}>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.bullish }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>High</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.gold }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Medium</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.legendDot, { backgroundColor: colors.mutedForeground }]} />
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Low</Text>
      </View>
      <View style={styles.legendItem}>
        <Text style={[styles.legendArrow, { color: colors.bullish }]}>▲</Text>
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Bullish</Text>
      </View>
      <View style={styles.legendItem}>
        <Text style={[styles.legendArrow, { color: colors.bearish }]}>▼</Text>
        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Bearish</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PatternsView({
  initialSymbol,
  topPadding: topPaddingProp,
}: { initialSymbol?: string; topPadding?: number } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const topPadding = topPaddingProp ?? insets.top + (Platform.OS === 'web' ? 67 : 0);
  const bottomPadding = insets.bottom + 80;

  const startSymbol = initialSymbol ?? params.symbol ?? '';
  const [inputSymbol, setInputSymbol] = useState(startSymbol);
  const [symbol, setSymbol] = useState(startSymbol);

  const handleSearch = useCallback(() => {
    if (!inputSymbol.trim()) return;
    const raw = inputSymbol.trim().toUpperCase();
    const sym = raw.endsWith('USDT') ? raw : `${raw}USDT`;
    setSymbol(sym);
  }, [inputSymbol]);

  const { data, isLoading, isError, refetch } = useGetPatterns(
    { symbol },
    { query: { enabled: !!symbol, staleTime: 120_000 } }
  );

  const [selected, setSelected] = useState<{ pattern: PatternResult; tf: string; name: string; symbol: string } | null>(null);

  // Summary: berapa TF punya pattern
  const activeTFs = data?.timeframes.filter(tf => tf.patterns.length > 0).length ?? 0;
  const totalPatterns = data?.timeframes.reduce((acc, tf) => acc + tf.patterns.length, 0) ?? 0;

  // Group patterns by category
  const continuationPatterns = ALL_PATTERNS.filter(p => getPatternMeta(p).category === 'continuation');
  const reversalPatterns = ALL_PATTERNS.filter(p => getPatternMeta(p).category === 'reversal');

  const renderGroup = (group: readonly string[], label: string) => (
    <>
      {/* Category label row */}
      <View style={[styles.categoryRow, { backgroundColor: `${colors.mutedForeground}08` }]}>
        <Text style={[styles.categoryLabel, { color: colors.mutedForeground }]}>{label}</Text>
        {TIMEFRAMES.map(tf => (
          <Text key={tf} style={[styles.tfHeader, { color: colors.mutedForeground }]}>{tf}</Text>
        ))}
      </View>

      {group.map(patternName => {
        const meta = getPatternMeta(patternName);
        const nameColor = meta.direction === 'bullish' ? colors.bullish : colors.bearish;
        const hasAny = data?.timeframes.some(tf => findPattern(tf, patternName));

        return (
          <View
            key={patternName}
            style={[
              styles.patternRow,
              { borderBottomColor: colors.border },
              hasAny && { backgroundColor: `${colors.primary}05` },
            ]}
          >
            {/* Pattern name */}
            <View style={styles.patternNameCell}>
              <Text style={[styles.patternName, { color: hasAny ? nameColor : colors.mutedForeground }]} numberOfLines={1}>
                {patternName}
              </Text>
            </View>

            {/* TF cells */}
            {TIMEFRAMES.map(tf => {
              const tfData = data?.timeframes.find(t => t.tf === tf);
              const p = tfData ? findPattern(tfData, patternName) : undefined;
              return (
                <View key={tf} style={styles.cellWrapper}>
                  <PatternCell
                    pattern={p}
                    colors={colors}
                    onPress={p ? () => setSelected({ pattern: p, tf, name: patternName, symbol }) : undefined}
                  />
                </View>
              );
            })}
          </View>
        );
      })}
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding + 12, borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <View style={styles.headerTop}>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, flex: 1 }]}>
            Multi-Timeframe Pattern Detector
          </Text>
          {data && (
            <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
              <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        {/* Summary strip */}
        {data && !isLoading && (
          <View style={[styles.summaryStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{totalPatterns}</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Pattern</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{activeTFs}/5</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>TF Aktif</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Update</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]} numberOfLines={1}>
                {data.timestamp.split(' ')[0] + ' ' + data.timestamp.split(' ')[1]}
              </Text>
            </View>
          </View>
        )}

        {/* Search bar */}
        <View style={styles.searchRow}>
          <View style={[styles.inputBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="activity" size={15} color={colors.primary} />
            <TextInput
              style={[styles.inputText, { color: colors.foreground }]}
              placeholder="Masukkan pair (BTCUSDT)"
              placeholderTextColor={colors.mutedForeground}
              value={inputSymbol}
              onChangeText={setInputSymbol}
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {inputSymbol.length > 0 && (
              <Pressable onPress={() => setInputSymbol('')}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={handleSearch}
            style={({ pressed }) => [styles.analyzeBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[styles.analyzeBtnText, { color: colors.primaryForeground }]}>Cari</Text>
          </Pressable>
        </View>
      </View>

      {/* Content */}
      {!symbol ? (
        <View style={styles.center}>
          <Feather name="activity" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Masukkan Symbol</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Ketik pair di atas atau buka dari halaman Sniper Entry
          </Text>
        </View>
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            Mendeteksi pattern...
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            H4 → H1 → M30 → M15 → M5
          </Text>
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color={colors.bearish} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Gagal memuat</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : data ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPadding }}
          showsVerticalScrollIndicator={false}
        >
          <Legend colors={colors} />

          <ScrollView horizontal showsHorizontalScrollIndicator={true}>
            <View>
              {/* Column headers */}
              <View style={[styles.columnHeaders, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
                <View style={styles.patternNameCell}>
                  <Text style={[styles.colHeaderText, { color: colors.mutedForeground }]}>PATTERN</Text>
                </View>
                {TIMEFRAMES.map(tf => (
                  <View key={tf} style={styles.cellWrapper}>
                    <Text style={[styles.colHeaderText, { color: colors.mutedForeground, textAlign: 'center' }]}>{tf}</Text>
                  </View>
                ))}
              </View>

              {renderGroup(continuationPatterns, 'CONTINUATION')}
              {renderGroup(reversalPatterns, 'REVERSAL')}
            </View>
          </ScrollView>

          {totalPatterns === 0 && (
            <View style={styles.noPatternBox}>
              <Feather name="check-circle" size={28} color={colors.mutedForeground} />
              <Text style={[styles.noPatternText, { color: colors.mutedForeground }]}>
                Tidak ada pattern terdeteksi saat ini
              </Text>
            </View>
          )}
        </ScrollView>
      ) : null}

      {/* Detail overlay */}
      {selected && (
        <PatternDetail
          symbol={selected.symbol}
          pattern={selected.pattern}
          tf={selected.tf}
          patternName={selected.name}
          colors={colors}
          onClose={() => setSelected(null)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CELL_SIZE = 48;
const NAME_WIDTH = 120;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  refreshBtn: { padding: 6, marginTop: 4 },

  summaryStrip: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  summaryValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  summaryLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 1 },
  summaryDivider: { width: StyleSheet.hairlineWidth },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center', marginTop: 8 },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  // Legend
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendArrow: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  legendText: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  // Grid
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colHeaderText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 },

  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  categoryLabel: {
    width: NAME_WIDTH,
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  tfHeader: {
    width: CELL_SIZE,
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  patternRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  patternNameCell: { width: NAME_WIDTH, paddingRight: 8 },
  patternName: { fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 14 },
  cellWrapper: { width: CELL_SIZE, alignItems: 'center' },

  cell: {
    width: 34,
    height: 34,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellEmpty: {},
  cellActive: { borderWidth: 1 },
  cellDash: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  cellIcon: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  cellDot: { width: 5, height: 5, borderRadius: 3, position: 'absolute', bottom: 5, right: 5 },

  noPatternBox: { alignItems: 'center', gap: 8, padding: 32 },
  noPatternText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },

  // Detail overlay
  detailOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', zIndex: 100 },
  detailBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  detailCard: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  detailName: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  detailTf: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  detailClose: { padding: 4 },
  detailBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  detailDesc: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 10,
    borderRadius: 4,
  },
  detailDescText: { fontSize: 13, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  detailImplication: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  // Search bar
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  inputBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  inputText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 },
  analyzeBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  analyzeBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
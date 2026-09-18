import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PulseDot } from './PulseDot';

interface CyberBadgeProps {
  label: string;
  color: string;
  pulsing?: boolean;
}

/** Badge status pil-bentuk dengan dot berdenyut -- dipakai di header kartu hasil. */
export function CyberBadge({ label, color, pulsing = true }: CyberBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}60` }]}>
      {pulsing && <PulseDot color={color} size={5} />}
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, borderWidth: 1,
  },
  text: { fontSize: 10, fontFamily: 'Courier', fontWeight: '700', letterSpacing: 0.5 },
});

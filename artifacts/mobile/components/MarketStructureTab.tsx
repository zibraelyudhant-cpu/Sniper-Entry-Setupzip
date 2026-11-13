import React from 'react';
import { Linking, Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';

// ═══════════════════════════════════════════════════════════════════════════
// Tab 2 "📐 Market Structure" (v26). Halaman HTML/JS ASLI (index_market_structure.html + app_market_structure.js +
// msacard.js + helpers.js + style.css) dilayani api-server di /api/msa/ui dan ditampilkan di WebView (web: iframe).
// Jembatan ke HP (bridge.js di halaman): salin teks -> clipboard HP; buka URL (gambar PNG layar penuh /
// TradingView) -> browser HP. Tidak ada logika analisa di file ini.
// ═══════════════════════════════════════════════════════════════════════════
const BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
const UI_URL = `${BASE}/api/msa/ui`;

export function MarketStructureTab() {
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1 }}>
        {React.createElement('iframe', {
          src: UI_URL, title: 'Market Structure', allow: 'clipboard-write',
          style: { border: 0, width: '100%', height: '100%', flex: 1, background: '#0f1218' },
        })}
      </View>
    );
  }
  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type?: string; text?: string; url?: string } = {};
    try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (m.type === 'copy' && typeof m.text === 'string') Clipboard.setStringAsync(m.text).catch(() => {});
    if (m.type === 'open-url' && typeof m.url === 'string') Linking.openURL(m.url).catch(() => {});
  };
  return (
    <WebView
      source={{ uri: UI_URL }}
      style={{ flex: 1, backgroundColor: '#0f1218' }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      onMessage={onMessage}
      setSupportMultipleWindows={false}
    />
  );
}

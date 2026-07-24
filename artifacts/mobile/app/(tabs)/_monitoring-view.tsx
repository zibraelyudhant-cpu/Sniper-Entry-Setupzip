import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  evaluateHealth,
  loadActiveMonitoringLogs,
  monitoringStyles as s,
  scanEntryHits,
  scanResolves,
  type HealthStatus,
  type MonitoringResult,
  type MonitoringSignalLog,
} from "./monitoring-helpers";

const REFRESH_INTERVAL_MS = 60_000; // 60 detik

function statusColor(status: HealthStatus, colors: ReturnType<typeof useColors>) {
  if (status === "aman") return colors.bullish;
  if (status === "warning") return colors.gold;
  return colors.bearish;
}

function statusLabel(status: HealthStatus) {
  if (status === "aman") return "AMAN";
  if (status === "warning") return "WARNING";
  return "CLOSE POSISI";
}

function statusIcon(status: HealthStatus): keyof typeof Feather.glyphMap {
  if (status === "aman") return "check-circle";
  if (status === "warning") return "alert-triangle";
  return "x-circle";
}

// ─── Card component ─────────────────────────────────────────────────────────

function MonitoringCard({
  log,
  result,
  loading,
}: {
  log: MonitoringSignalLog;
  result: MonitoringResult | null;
  loading: boolean;
}) {
  const colors = useColors();
  const status = result?.status ?? "aman";
  const sColor = result ? statusColor(status, colors) : colors.mutedForeground;
  const biasColor = log.bias === "bullish" ? colors.bullish : colors.bearish;

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={s.cardHeaderLeft}>
          <Text style={[s.symbol, { color: colors.foreground }]}>{log.symbol}</Text>
          <View style={[s.menuBadge, { borderColor: colors.border }]}>
            <Text style={[s.menuBadgeText, { color: colors.mutedForeground }]}>
              {log.menu === "sniper" ? "SNIPER" : "SCALPING"}
            </Text>
          </View>
          <Text style={[{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: biasColor }]}>
            {log.bias === "bullish" ? "▲ LONG" : "▼ SHORT"}
          </Text>
        </View>
        <View style={[s.statusBadge, { borderColor: sColor, backgroundColor: `${sColor}15` }]}>
          {loading && !result ? (
            <ActivityIndicator size="small" color={sColor} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Feather name={statusIcon(status)} size={11} color={sColor} />
              <Text style={[s.statusText, { color: sColor }]}>{statusLabel(status)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Progress bars: risk used + progress to TP1 */}
      {result && (
        <View style={s.progressWrap}>
          <View>
            <View style={s.progressLabelRow}>
              <Text style={[s.progressLabel, { color: colors.mutedForeground }]}>Risk Used</Text>
              <Text style={[s.progressValue, { color: sColor }]}>
                {result.metrics.riskUsedPct.toFixed(0)}%
              </Text>
            </View>
            <View style={[s.progressBar, { backgroundColor: `${colors.border}` }]}>
              <View
                style={[
                  s.progressFill,
                  {
                    width: `${Math.min(100, result.metrics.riskUsedPct)}%`,
                    backgroundColor:
                      result.metrics.riskUsedPct > 80
                        ? colors.bearish
                        : result.metrics.riskUsedPct >= 50
                        ? colors.gold
                        : colors.mutedForeground,
                  },
                ]}
              />
            </View>
          </View>
          <View>
            <View style={s.progressLabelRow}>
              <Text style={[s.progressLabel, { color: colors.mutedForeground }]}>Progress ke TP1</Text>
              <Text style={[s.progressValue, { color: colors.bullish }]}>
                {result.metrics.progressToTP1Pct.toFixed(0)}%
              </Text>
            </View>
            <View style={[s.progressBar, { backgroundColor: `${colors.border}` }]}>
              <View
                style={[
                  s.progressFill,
                  {
                    width: `${Math.min(100, result.metrics.progressToTP1Pct)}%`,
                    backgroundColor: colors.bullish,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {/* Price info */}
      <View style={[s.priceRow, { borderTopColor: colors.border }]}>
        <View style={s.priceItem}>
          <Text style={[s.priceLabel, { color: colors.mutedForeground }]}>ENTRY</Text>
          <Text style={[s.priceValue, { color: colors.foreground }]}>
            {log.entryPrice.toPrecision(6)}
          </Text>
        </View>
        <View style={s.priceItem}>
          <Text style={[s.priceLabel, { color: colors.mutedForeground }]}>PRICE NOW</Text>
          <Text style={[s.priceValue, { color: sColor }]}>
            {result ? result.metrics.currentPrice.toPrecision(6) : "—"}
          </Text>
        </View>
        <View style={s.priceItem}>
          <Text style={[s.priceLabel, { color: colors.mutedForeground }]}>SL</Text>
          <Text style={[s.priceValue, { color: colors.bearish }]}>
            {log.stopLoss.toPrecision(6)}
          </Text>
        </View>
        <View style={s.priceItem}>
          <Text style={[s.priceLabel, { color: colors.mutedForeground }]}>TP1</Text>
          <Text style={[s.priceValue, { color: colors.bullish }]}>
            {log.takeProfit1.toPrecision(6)}
          </Text>
        </View>
      </View>

      {/* Metrics extra */}
      {result && (
        <View style={[s.metricsRow, { borderTopColor: colors.border }]}>
          <View style={s.metric}>
            <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>OI Δ</Text>
            <Text
              style={[
                s.metricValue,
                {
                  color:
                    result.metrics.oiChangePct > 0
                      ? colors.bullish
                      : result.metrics.oiChangePct < 0
                      ? colors.bearish
                      : colors.foreground,
                },
              ]}
            >
              {result.metrics.oiChangePct > 0 ? "+" : ""}
              {result.metrics.oiChangePct.toFixed(1)}%
            </Text>
          </View>
          <View style={s.metric}>
            <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>FUNDING</Text>
            <Text
              style={[
                s.metricValue,
                {
                  color:
                    result.metrics.fundingRate > 0
                      ? colors.bullish
                      : result.metrics.fundingRate < 0
                      ? colors.bearish
                      : colors.foreground,
                },
              ]}
            >
              {(result.metrics.fundingRate * 100).toFixed(3)}%
            </Text>
          </View>
          <View style={s.metric}>
            <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>TAKER B/S</Text>
            <Text
              style={[
                s.metricValue,
                {
                  color:
                    result.metrics.takerRatio > 1
                      ? colors.bullish
                      : result.metrics.takerRatio < 1
                      ? colors.bearish
                      : colors.foreground,
                },
              ]}
            >
              {result.metrics.takerRatio.toFixed(2)}
            </Text>
          </View>
          <View style={s.metric}>
            <Text style={[s.metricLabel, { color: colors.mutedForeground }]}>CVD DIV</Text>
            <Text
              style={[
                s.metricValue,
                {
                  color:
                    result.metrics.cvdDivergence === "bullish"
                      ? colors.bullish
                      : result.metrics.cvdDivergence === "bearish"
                      ? colors.bearish
                      : colors.mutedForeground,
                },
              ]}
            >
              {result.metrics.cvdDivergence === "none"
                ? "—"
                : result.metrics.cvdDivergence === "bullish"
                ? "▲"
                : "▼"}
            </Text>
          </View>
        </View>
      )}

      {/* Triggers */}
      {result && result.triggers.length > 0 && (
        <View style={[s.triggersWrap, { borderTopColor: colors.border, backgroundColor: `${sColor}08` }]}>
          {result.triggers.map((t, i) => (
            <View key={i} style={s.triggerRow}>
              <Feather name="alert-circle" size={12} color={sColor} style={{ marginTop: 1 }} />
              <Text style={[s.triggerText, { color: colors.foreground }]}>{t}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main view ──────────────────────────────────────────────────────────────

export default function MonitoringView() {
  const colors = useColors();
  const [logs, setLogs] = useState<MonitoringSignalLog[]>([]);
  const [results, setResults] = useState<Record<string, MonitoringResult | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [scanStatus, setScanStatus] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doFullScan = useCallback(async () => {
    setScanStatus("Cek entry baru...");
    const newHits = await scanEntryHits();
    if (newHits > 0) setScanStatus(`${newHits} entry baru kehit`);

    setScanStatus("Cek SL/TP...");
    const resolved = await scanResolves();
    if (resolved > 0) setScanStatus(`${resolved} sinyal resolved`);

    setScanStatus("Load monitoring...");
    const active = await loadActiveMonitoringLogs();
    setLogs(active);

    setScanStatus("Evaluasi health...");
    const newResults: Record<string, MonitoringResult | null> = {};
    for (const log of active) {
      const result = await evaluateHealth(log);
      newResults[log.id] = result;
      // update partial biar UI progresif
      setResults((prev) => ({ ...prev, [log.id]: result }));
      await new Promise((r) => setTimeout(r, 300));
    }
    setLastRefresh(new Date());
    setScanStatus("");
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    await doFullScan();
    setLoading(false);
  }, [doFullScan]);

  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await doFullScan();
    setRefreshing(false);
  }, [doFullScan]);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(() => {
      doFullScan();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Summary counts
  const amanCount = logs.filter((l) => results[l.id]?.status === "aman").length;
  const warningCount = logs.filter((l) => results[l.id]?.status === "warning").length;
  const closeCount = logs.filter((l) => results[l.id]?.status === "close").length;

  if (loading) {
    return (
      <View style={s.emptyBox}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
          {scanStatus || "Loading monitoring..."}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Refresh info */}
      <View style={s.refreshInfo}>
        <Feather name="clock" size={11} color={colors.mutedForeground} />
        <Text style={[s.refreshText, { color: colors.mutedForeground }]}>
          {scanStatus || (lastRefresh ? `Terakhir refresh: ${lastRefresh.toLocaleTimeString("id-ID")}` : "Belum di-refresh")}
          {"  ·  auto 60s"}
        </Text>
      </View>

      {/* Summary */}
      {logs.length > 0 && (
        <View style={[s.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.summaryItem}>
            <Text style={[s.summaryVal, { color: colors.bullish }]}>{amanCount}</Text>
            <Text style={[s.summaryLbl, { color: colors.mutedForeground }]}>AMAN</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={[s.summaryVal, { color: colors.gold }]}>{warningCount}</Text>
            <Text style={[s.summaryLbl, { color: colors.mutedForeground }]}>WARNING</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={[s.summaryVal, { color: colors.bearish }]}>{closeCount}</Text>
            <Text style={[s.summaryLbl, { color: colors.mutedForeground }]}>CLOSE</Text>
          </View>
          <View style={s.summaryItem}>
            <Text style={[s.summaryVal, { color: colors.foreground }]}>{logs.length}</Text>
            <Text style={[s.summaryLbl, { color: colors.mutedForeground }]}>TOTAL</Text>
          </View>
        </View>
      )}

      {logs.length === 0 ? (
        <View style={s.emptyBox}>
          <Feather name="inbox" size={40} color={colors.mutedForeground} />
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>Belum ada posisi aktif</Text>
          <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
            Sinyal dari Menu 2 (Sniper) & Menu 4 (Scalping) yang harga entry-nya sudah kehit akan otomatis muncul di sini untuk dipantau.
          </Text>
          <Pressable
            onPress={onRefresh}
            style={{
              marginTop: 12,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Feather name="refresh-cw" size={13} color={colors.foreground} />
            <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
              Scan Ulang
            </Text>
          </Pressable>
        </View>
      ) : (
        logs.map((log) => (
          <MonitoringCard
            key={log.id}
            log={log}
            result={results[log.id] ?? null}
            loading={!results[log.id]}
          />
        ))
      )}
    </ScrollView>
  );
}
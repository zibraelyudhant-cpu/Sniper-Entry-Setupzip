// ─── Menu 6: Backtest ─────────────────────────────────────────────────────────

export interface BacktestBreakdownItem {
  trades: number;
  wins: number;
  winRate: number;
}

export interface BacktestAnalysis {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRR: number;
  breakdown: {
    withChoch15M: BacktestBreakdownItem;
    withoutChoch15M: BacktestBreakdownItem;
    withRejection15M: BacktestBreakdownItem;
    withoutRejection15M: BacktestBreakdownItem;
    withPattern: BacktestBreakdownItem;
    withoutPattern: BacktestBreakdownItem;
    tier1to2: BacktestBreakdownItem;
    tier3plus: BacktestBreakdownItem;
    londonNY: BacktestBreakdownItem;
    asian: BacktestBreakdownItem;
    highVolume: BacktestBreakdownItem;
    lowVolume: BacktestBreakdownItem;
  };
  lossCauses: Array<{ cause: string; count: number; percentage: number }>;
  recommendations: string[];
}

export interface BacktestResult {
  symbol: string;
  period: string;
  totalCandles: number;
  sniperResult?: BacktestAnalysis;
  breakoutResult?: BacktestAnalysis;
  comparison?: {
    better: 'sniper' | 'breakout' | 'equal';
    sniperWinRate: number;
    breakoutWinRate: number;
    mostImpactfulFilter: string;
  };
  timestamp: string;
}

export type BacktestPeriod = '1m' | '3m' | '6m' | '1y';
export type BacktestMenu = 'sniper' | 'breakout' | 'both';

export interface BacktestParams {
  symbol: string;
  period: BacktestPeriod;
  menu: BacktestMenu;
}
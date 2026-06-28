// ── Token & Pair Data ──

export interface TokenPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceNative: string;
  liquidity?: { usd: number; base: number; quote: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  volume?: { h24: number; h6: number; h1: number; m5: number };
  priceChange?: { h24: number; h6: number; h1: number; m5: number };
  txns?: {
    h24: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    m5: { buys: number; sells: number };
  };
  info?: {
    imageUrl?: string;
    websites?: { url: string }[];
    socials?: { type: string; url: string }[];
  };
}

// ── Safety Check Result ──

export interface SafetyResult {
  score: number;
  passed: boolean;
  checks: SafetyCheck[];
  flags: string[];
}

export interface SafetyCheck {
  name: string;
  passed: boolean;
  score: number;
  maxScore: number;
  detail: string;
}

// ── Token Evaluation ──

export interface TokenEvaluation {
  token: TokenPair;
  safetyResult: SafetyResult;
  entryScore: number;
  reasons: string[];
  timestamp: number;
}

// ── Position / Trade ──

export type PositionStatus = 'open' | 'closed' | 'partial';

export interface Position {
  id: string;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  pairAddress: string;

  entryPrice: number;
  currentPrice: number;
  highestPrice: number;

  initialSizeUsd: number;
  remainingSizeUsd: number;
  soldUsd: number;

  entryTime: number;
  lastUpdate: number;

  status: PositionStatus;
  pnlUsd: number;
  pnlPct: number;

  takeProfitLevelsHit: number[];
  trailingStopPrice: number;

  exitReason?: string;
}

// ── Trade Action ──

export type TradeAction = 'BUY' | 'SELL' | 'PARTIAL_SELL';

export interface TradeEvent {
  action: TradeAction;
  position: Position;
  amountUsd: number;
  price: number;
  reason: string;
  timestamp: number;
}

// ── Bot State ──

export interface BotState {
  budgetRemaining: number;
  totalPnl: number;
  tradesExecuted: number;
  positions: Map<string, Position>;
  seenTokens: Set<string>;
  startTime: number;
}

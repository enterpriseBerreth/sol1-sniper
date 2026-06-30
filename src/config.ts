import 'dotenv/config';

export const CONFIG = {
  // ── Mode ──
  PAPER_TRADE: process.env.PAPER_TRADE !== 'false',

  // ── Budget ──
  STARTING_BUDGET_USD: 1000,
  TRADE_SIZE_USD: 30,
  MAX_CONCURRENT_TRADES: 3,

  // ── Scanner ──
  SCAN_INTERVAL_MS: 10_000,
  PRICE_UPDATE_INTERVAL_MS: 5_000,
  MAX_TOKEN_AGE_MINUTES: 30,

  // ── Safety Thresholds ──
  MIN_LIQUIDITY_USD: 5_000,
  MIN_SAFETY_SCORE: 77,
  MAX_SINGLE_HOLDER_PCT: 10,
  MIN_HOLDERS: 30,
  MAX_TOP10_HOLDER_PCT: 40,

  // ── Entry Criteria ──
  MIN_ENTRY_SCORE: 80,
  MIN_5M_VOLUME_USD: 1_000,
  MIN_BUY_SELL_RATIO: 1.5,

  // ── Exit Strategy ──
  INITIAL_STOP_LOSS_PCT: 20,
  TRAILING_STOP_TIERS: [
    { activateAbovePct: 30, trailDistancePct: 15 },
    { activateAbovePct: 75, trailDistancePct: 12 },
    { activateAbovePct: 150, trailDistancePct: 10 },
    { activateAbovePct: 300, trailDistancePct: 8 },
  ],
  TAKE_PROFIT_LEVELS: [
    { triggerPct: 100, sellPct: 25 },
    { triggerPct: 200, sellPct: 25 },
    { triggerPct: 500, sellPct: 25 },
  ],
  MAX_HOLD_TIME_MINUTES: 120,
  STALE_EXIT_MINUTES: 30,
  STALE_EXIT_MIN_GAIN_PCT: 10,

  // ── API Endpoints ──
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  DEXSCREENER_BASE: 'https://api.dexscreener.com',
  JUPITER_PRICE_API: 'https://api.jup.ag/price/v2',

  // ── Telegram ──
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
} as const;

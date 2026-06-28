import { CONFIG } from './config.js';
import { TokenScanner } from './scanner.js';
import { runSafetyChecks } from './safety.js';
import { PaperTrader } from './trader.js';
import { TelegramAlert } from './telegram.js';
import { TokenPair } from './types.js';
import { log } from './logger.js';

const MODULE = 'SOL1';

// ── Status display interval ──
const STATUS_INTERVAL_MS = 60_000;
const DAILY_SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function main() {
  log.banner('SOL1 — Solana Sniper Bot');

  console.log(`  Mode:              ${CONFIG.PAPER_TRADE ? 'PAPER TRADE' : 'LIVE TRADING'}`);
  console.log(`  Budget:            $${CONFIG.STARTING_BUDGET_USD}`);
  console.log(`  Trade Size:        $${CONFIG.TRADE_SIZE_USD}`);
  console.log(`  Max Concurrent:    ${CONFIG.MAX_CONCURRENT_TRADES}`);
  console.log(`  Min Safety Score:  ${CONFIG.MIN_SAFETY_SCORE}/100`);
  console.log(`  Stop Loss:         ${CONFIG.INITIAL_STOP_LOSS_PCT}%`);
  console.log(`  Max Hold Time:     ${CONFIG.MAX_HOLD_TIME_MINUTES}m`);
  const rpcHost = new URL(CONFIG.SOLANA_RPC_URL).hostname;
  console.log(`  RPC:               ${rpcHost}`);
  console.log('');

  if (!CONFIG.PAPER_TRADE) {
    log.warn(MODULE, '*** LIVE TRADING MODE — Real money at risk! ***');
    log.warn(MODULE, 'Press Ctrl+C within 10 seconds to abort...');
    await sleep(10_000);
  }

  // Initialize components
  const telegram = new TelegramAlert();
  const trader = new PaperTrader(telegram);
  const scanner = new TokenScanner();

  // Send startup notification
  await telegram.sendStartupAlert();

  // Processing queue to avoid concurrent evaluations overwhelming the RPC
  let evaluating = false;
  const evaluationQueue: TokenPair[] = [];

  async function processQueue() {
    if (evaluating || evaluationQueue.length === 0) return;
    evaluating = true;

    while (evaluationQueue.length > 0) {
      const pair = evaluationQueue.shift()!;

      if (!trader.canTrade()) {
        log.info(MODULE, `Skipping ${pair.baseToken.symbol} — trade limit reached or insufficient budget`);
        continue;
      }

      if (trader.hasPosition(pair.baseToken.address)) {
        continue;
      }

      try {
        // Run safety checks
        const safetyResult = await runSafetyChecks(pair);

        if (!safetyResult.passed) {
          log.warn(MODULE, `${pair.baseToken.symbol} REJECTED — Safety score: ${safetyResult.score}/100`);
          if (safetyResult.flags.length > 0) {
            for (const flag of safetyResult.flags) {
              log.warn(MODULE, `  Red flag: ${flag}`);
            }
          }
          continue;
        }

        // Additional entry quality check
        if (!isHighQualityEntry(pair)) {
          log.info(MODULE, `${pair.baseToken.symbol} — Passed safety but entry quality too low, skipping`);
          continue;
        }

        log.success(MODULE, `${pair.baseToken.symbol} APPROVED — Score: ${safetyResult.score}/100 — Executing buy...`);
        await trader.executeBuy(pair, safetyResult);
      } catch (err) {
        log.error(MODULE, `Error evaluating ${pair.baseToken.symbol}: ${err}`);
      }
    }

    evaluating = false;
  }

  // Hook scanner to evaluation pipeline
  scanner.onNewToken = (pair: TokenPair) => {
    evaluationQueue.push(pair);
    processQueue();
  };

  // Start all systems
  scanner.start();
  trader.startPriceMonitor();

  // Periodic status display
  const statusInterval = setInterval(() => {
    trader.printStatus();
  }, STATUS_INTERVAL_MS);

  // Daily summary
  const dailyInterval = setInterval(() => {
    trader.sendDailySummary();
  }, DAILY_SUMMARY_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    log.info(MODULE, 'Shutting down...');
    scanner.stop();
    trader.stopPriceMonitor();
    clearInterval(statusInterval);
    clearInterval(dailyInterval);

    trader.printStatus();
    await trader.sendDailySummary();

    log.banner('SOL1 — Shutdown Complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // ── Crash protection for Railway / long-running deploy ──
  process.on('uncaughtException', (err) => {
    log.error(MODULE, `Uncaught exception (kept alive): ${err.message}`);
    log.error(MODULE, err.stack ?? '');
  });
  process.on('unhandledRejection', (reason) => {
    log.error(MODULE, `Unhandled rejection (kept alive): ${reason}`);
  });

  log.success(MODULE, 'All systems online — scanning for new tokens...');

  // Keep the process alive indefinitely
  await new Promise(() => {});
}

// ── Entry quality filter ──
// Only enter trades that look "extremely promising"

function isHighQualityEntry(pair: TokenPair): boolean {
  const reasons: string[] = [];

  // Must have meaningful volume
  const vol5m = pair.volume?.m5 ?? 0;
  if (vol5m < CONFIG.MIN_5M_VOLUME_USD) {
    return false;
  }

  // Must have positive price action
  const priceChange5m = pair.priceChange?.m5 ?? 0;
  if (priceChange5m < 0) {
    return false;
  }

  // Buy pressure must be strong
  const buys5m = pair.txns?.m5?.buys ?? 0;
  const sells5m = pair.txns?.m5?.sells ?? 0;
  if (sells5m > 0) {
    const ratio = buys5m / sells5m;
    if (ratio < CONFIG.MIN_BUY_SELL_RATIO) {
      return false;
    }
    reasons.push(`Buy/sell ratio: ${ratio.toFixed(1)}:1`);
  }

  // Must have minimum liquidity
  const liq = pair.liquidity?.usd ?? 0;
  if (liq < CONFIG.MIN_LIQUIDITY_USD) {
    return false;
  }
  reasons.push(`Liquidity: $${liq.toFixed(0)}`);

  // Bonus: strong volume/liquidity ratio indicates hype
  const volLiqRatio = vol5m / liq;
  if (volLiqRatio > 0.1) {
    reasons.push(`Vol/Liq ratio: ${volLiqRatio.toFixed(2)} (strong hype)`);
  }

  if (reasons.length > 0) {
    log.info('ENTRY', `Quality signals for ${pair.baseToken.symbol}: ${reasons.join(' | ')}`);
  }

  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Launch ──
main().catch((err) => {
  log.error(MODULE, `Fatal error: ${err}`);
  process.exit(1);
});

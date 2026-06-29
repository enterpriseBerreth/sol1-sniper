import { CONFIG } from './config.js';
import { SeederCandidate, CopyPosition } from './types.js';
import { getTokenRecentBuyers } from './helius.js';
import { WalletMonitor } from './wallet-monitor.js';
import { log } from './logger.js';

const MODULE = 'SEEDER';

// Known program addresses to exclude from seeder candidates
const EXCLUDED_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  'So11111111111111111111111111111111111111112',
]);

export class WalletSeeder {
  private candidates: Map<string, SeederCandidate> = new Map();
  private trackedTokens: Set<string> = new Set();
  private monitor: WalletMonitor;
  private seederInterval: ReturnType<typeof setInterval> | null = null;

  constructor(monitor: WalletMonitor) {
    this.monitor = monitor;
  }

  // Record that a watched wallet bought a token (called by the main loop)
  recordBuy(tokenMint: string): void {
    this.trackedTokens.add(tokenMint);
  }

  // Record a closed trade for scoring purposes
  recordClosedTrade(position: CopyPosition): void {
    // If trade was profitable, boost seeder priority for that token
    if (position.pnlUsd > 0) {
      log.info(MODULE, `Profitable trade on ${position.tokenSymbol} — will prioritize co-buyers for seeding`);
    }
  }

  start(): void {
    log.info(MODULE, `Wallet seeder started — scanning every ${CONFIG.SEEDER_INTERVAL_MS / 60_000}m`);
    // First scan after a delay to let the bot establish baseline
    setTimeout(() => {
      this.scanForNewWallets();
      this.seederInterval = setInterval(
        () => this.scanForNewWallets(),
        CONFIG.SEEDER_INTERVAL_MS
      );
    }, 60_000); // Wait 1 minute before first seeder scan
  }

  stop(): void {
    if (this.seederInterval) {
      clearInterval(this.seederInterval);
      this.seederInterval = null;
    }
    log.info(MODULE, 'Wallet seeder stopped');
  }

  private async scanForNewWallets(): Promise<void> {
    if (this.monitor.walletCount >= CONFIG.MAX_WATCHED_WALLETS) {
      log.info(MODULE, `Already at max wallets (${CONFIG.MAX_WATCHED_WALLETS}) — skipping scan`);
      return;
    }

    if (this.trackedTokens.size === 0) {
      log.info(MODULE, 'No tracked tokens yet — skipping scan');
      return;
    }

    log.info(MODULE, `Scanning ${this.trackedTokens.size} token(s) for co-buyers...`);

    const currentWallets = new Set(this.monitor.watchedAddresses);

    for (const tokenMint of this.trackedTokens) {
      try {
        const buyers = await getTokenRecentBuyers(tokenMint);

        for (const buyer of buyers) {
          // Skip known addresses and already-watched wallets
          if (EXCLUDED_ADDRESSES.has(buyer)) continue;
          if (currentWallets.has(buyer)) continue;

          // Update or create candidate
          let candidate = this.candidates.get(buyer);
          if (!candidate) {
            candidate = {
              address: buyer,
              coBuyCount: 0,
              coBuyTokens: [],
              firstSeen: Date.now(),
              lastSeen: Date.now(),
            };
            this.candidates.set(buyer, candidate);
          }

          // Only count each token once per candidate
          if (!candidate.coBuyTokens.includes(tokenMint)) {
            candidate.coBuyCount++;
            candidate.coBuyTokens.push(tokenMint);
            candidate.lastSeen = Date.now();
          }
        }

        // Rate limit: small delay between token lookups
        await sleep(1000);
      } catch (err) {
        log.error(MODULE, `Error scanning token ${tokenMint.slice(0, 8)}...: ${err}`);
      }
    }

    // Promote candidates that meet the threshold
    const promoted: string[] = [];
    for (const [address, candidate] of this.candidates) {
      if (candidate.coBuyCount >= CONFIG.SEEDER_MIN_COBUYS) {
        if (this.monitor.walletCount >= CONFIG.MAX_WATCHED_WALLETS) break;

        const added = this.monitor.addWallet(address, 'seeded');
        if (added) {
          promoted.push(address);
          log.success(
            MODULE,
            `Seeded new wallet: ${address.slice(0, 4)}...${address.slice(-4)} | ` +
            `Co-buys: ${candidate.coBuyCount} | ` +
            `Tokens: ${candidate.coBuyTokens.length}`
          );
        }
      }
    }

    // Remove promoted candidates
    for (const addr of promoted) {
      this.candidates.delete(addr);
    }

    // Prune old candidates (older than 1 hour with low co-buys)
    const oneHourAgo = Date.now() - 60 * 60_000;
    for (const [address, candidate] of this.candidates) {
      if (candidate.lastSeen < oneHourAgo && candidate.coBuyCount < CONFIG.SEEDER_MIN_COBUYS) {
        this.candidates.delete(address);
      }
    }

    const stats = `Candidates: ${this.candidates.size} | Watching: ${this.monitor.walletCount}/${CONFIG.MAX_WATCHED_WALLETS}`;
    log.info(MODULE, `Scan complete — ${promoted.length} wallet(s) seeded | ${stats}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

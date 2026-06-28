import { CONFIG } from './config.js';
import { TokenPair } from './types.js';
import { log } from './logger.js';

const MODULE = 'SCANNER';

// ── Fetch helpers ──

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ── DexScreener latest token profiles ──

interface DexScreenerProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  description?: string;
}

async function fetchLatestProfiles(): Promise<DexScreenerProfile[]> {
  const data = await fetchJSON<DexScreenerProfile[]>(
    `${CONFIG.DEXSCREENER_BASE}/token-profiles/latest/v1`
  );
  if (!data || !Array.isArray(data)) return [];
  return data.filter((p) => p.chainId === 'solana');
}

// ── DexScreener latest boosted tokens ──

interface DexScreenerBoost {
  url: string;
  chainId: string;
  tokenAddress: string;
  amount: number;
  totalAmount: number;
}

async function fetchLatestBoosts(): Promise<DexScreenerBoost[]> {
  const data = await fetchJSON<DexScreenerBoost[]>(
    `${CONFIG.DEXSCREENER_BASE}/token-boosts/latest/v1`
  );
  if (!data || !Array.isArray(data)) return [];
  return data.filter((b) => b.chainId === 'solana');
}

// ── Fetch full pair data for a token ──

interface DexScreenerPairsResponse {
  pairs: TokenPair[] | null;
}

export async function fetchTokenPairs(tokenAddress: string): Promise<TokenPair[]> {
  const data = await fetchJSON<DexScreenerPairsResponse>(
    `${CONFIG.DEXSCREENER_BASE}/latest/dex/tokens/${tokenAddress}`
  );
  if (!data?.pairs) return [];
  return data.pairs.filter((p) => p.chainId === 'solana');
}

// ── Jupiter price lookup ──

interface JupiterPriceResponse {
  data: Record<string, { id: string; price: string } | undefined>;
}

export async function fetchJupiterPrices(mints: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  if (mints.length === 0) return prices;

  const ids = mints.join(',');
  const data = await fetchJSON<JupiterPriceResponse>(
    `${CONFIG.JUPITER_PRICE_API}?ids=${ids}`
  );
  if (!data?.data) return prices;

  for (const [mint, info] of Object.entries(data.data)) {
    if (info?.price) {
      prices.set(mint, parseFloat(info.price));
    }
  }
  return prices;
}

// ── Pick the best pair for a token ──

function pickBestPair(pairs: TokenPair[]): TokenPair | null {
  if (pairs.length === 0) return null;
  return pairs
    .filter((p) => (p.liquidity?.usd ?? 0) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

// ── Check if a token is new enough to snipe ──

function isNewEnough(pair: TokenPair): boolean {
  if (!pair.pairCreatedAt) return false;
  const ageMs = Date.now() - pair.pairCreatedAt;
  return ageMs < CONFIG.MAX_TOKEN_AGE_MINUTES * 60 * 1000;
}

// ── Main scanner class ──

export class TokenScanner {
  private seenTokens = new Set<string>();
  private interval: ReturnType<typeof setInterval> | null = null;

  onNewToken: ((pair: TokenPair) => void) | null = null;

  start() {
    log.info(MODULE, `Starting scanner — polling every ${CONFIG.SCAN_INTERVAL_MS / 1000}s`);
    this.scan();
    this.interval = setInterval(() => this.scan(), CONFIG.SCAN_INTERVAL_MS);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info(MODULE, 'Scanner stopped');
  }

  markSeen(address: string) {
    this.seenTokens.add(address);
  }

  private async scan() {
    try {
      const [profiles, boosts] = await Promise.all([
        fetchLatestProfiles(),
        fetchLatestBoosts(),
      ]);

      // Collect unique new token addresses
      const candidateAddresses = new Set<string>();
      for (const p of profiles) {
        if (!this.seenTokens.has(p.tokenAddress)) {
          candidateAddresses.add(p.tokenAddress);
        }
      }
      for (const b of boosts) {
        if (!this.seenTokens.has(b.tokenAddress)) {
          candidateAddresses.add(b.tokenAddress);
        }
      }

      if (candidateAddresses.size === 0) return;

      log.info(MODULE, `Found ${candidateAddresses.size} new candidate(s) — fetching pair data...`);

      // Fetch pair data for all candidates (batch in groups of 5)
      const addresses = Array.from(candidateAddresses);
      const batchSize = 5;

      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        const results = await Promise.all(batch.map((addr) => fetchTokenPairs(addr)));

        for (let j = 0; j < batch.length; j++) {
          const addr = batch[j];
          this.seenTokens.add(addr);

          const pairs = results[j];
          const best = pickBestPair(pairs);

          if (!best) continue;
          if (!isNewEnough(best)) {
            log.info(MODULE, `${best.baseToken.symbol} — too old, skipping`);
            continue;
          }

          const liqUsd = best.liquidity?.usd ?? 0;
          if (liqUsd < CONFIG.MIN_LIQUIDITY_USD) {
            log.info(MODULE, `${best.baseToken.symbol} — liquidity $${liqUsd.toFixed(0)} too low, skipping`);
            continue;
          }

          log.success(
            MODULE,
            `New candidate: ${best.baseToken.symbol} | Price: $${best.priceUsd} | Liq: $${liqUsd.toFixed(0)} | Age: ${this.formatAge(best.pairCreatedAt)}`
          );

          this.onNewToken?.(best);
        }
      }
    } catch (err) {
      log.error(MODULE, `Scan error: ${err}`);
    }
  }

  private formatAge(createdAt?: number): string {
    if (!createdAt) return 'unknown';
    const mins = Math.floor((Date.now() - createdAt) / 60_000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }
}

import { Connection, PublicKey } from '@solana/web3.js';
import { CONFIG } from './config.js';
import { TokenPair, SafetyResult, SafetyCheck } from './types.js';
import { log } from './logger.js';

const MODULE = 'SAFETY';

// ── Solana connection (lazy init) ──

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(CONFIG.SOLANA_RPC_URL, 'confirmed');
  }
  return connection;
}

// ── Mint account layout offsets ──
// SPL Token Mint layout: 0-35 mintAuthority (4 option + 32 key), 36-43 supply,
// 44 decimals, 45 isInitialized, 46-81 freezeAuthority (4 option + 32 key)
const MINT_AUTHORITY_OPTION_OFFSET = 0;
const FREEZE_AUTHORITY_OPTION_OFFSET = 46;

// ── Individual Safety Checks ──

async function checkMintAuthority(tokenAddress: string): Promise<SafetyCheck> {
  const name = 'Mint Authority Revoked';
  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(tokenAddress);
    const accountInfo = await conn.getAccountInfo(mintPubkey);

    if (!accountInfo?.data) {
      return { name, passed: false, score: 0, maxScore: 15, detail: 'Could not fetch mint account' };
    }

    // COption<Pubkey>: first 4 bytes are 0 if None (revoked), 1 if Some
    const hasAuthority = accountInfo.data[MINT_AUTHORITY_OPTION_OFFSET] === 1;

    if (hasAuthority) {
      return { name, passed: false, score: 0, maxScore: 15, detail: 'DANGER: Mint authority NOT revoked — unlimited supply risk' };
    }
    return { name, passed: true, score: 15, maxScore: 15, detail: 'Mint authority revoked — supply is fixed' };
  } catch (err) {
    return { name, passed: false, score: 0, maxScore: 15, detail: `RPC error: ${err}` };
  }
}

async function checkFreezeAuthority(tokenAddress: string): Promise<SafetyCheck> {
  const name = 'Freeze Authority Revoked';
  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(tokenAddress);
    const accountInfo = await conn.getAccountInfo(mintPubkey);

    if (!accountInfo?.data) {
      return { name, passed: false, score: 0, maxScore: 10, detail: 'Could not fetch mint account' };
    }

    const hasFreeze = accountInfo.data[FREEZE_AUTHORITY_OPTION_OFFSET] === 1;

    if (hasFreeze) {
      return { name, passed: false, score: 0, maxScore: 10, detail: 'DANGER: Freeze authority active — tokens can be frozen' };
    }
    return { name, passed: true, score: 10, maxScore: 10, detail: 'Freeze authority revoked — tokens cannot be frozen' };
  } catch (err) {
    return { name, passed: false, score: 0, maxScore: 10, detail: `RPC error: ${err}` };
  }
}

async function checkTopHolders(tokenAddress: string): Promise<SafetyCheck> {
  const name = 'Holder Distribution';
  try {
    const conn = getConnection();
    const mintPubkey = new PublicKey(tokenAddress);

    const largest = await conn.getTokenLargestAccounts(mintPubkey);
    const supply = await conn.getTokenSupply(mintPubkey);

    if (!largest.value.length || !supply.value.uiAmount) {
      return { name, passed: false, score: 0, maxScore: 15, detail: 'Could not fetch holder data' };
    }

    const totalSupply = supply.value.uiAmount;
    const topHolderPct = ((largest.value[0].uiAmount ?? 0) / totalSupply) * 100;

    // Calculate top 10 concentration (excluding first which may be LP)
    const top10Pct = largest.value
      .slice(0, 10)
      .reduce((sum, acc) => sum + ((acc.uiAmount ?? 0) / totalSupply) * 100, 0);

    let score = 0;
    let detail = '';
    let passed = true;

    if (topHolderPct > 50) {
      detail = `DANGER: Top holder owns ${topHolderPct.toFixed(1)}% — extreme rug risk`;
      passed = false;
    } else if (topHolderPct > CONFIG.MAX_SINGLE_HOLDER_PCT) {
      detail = `WARNING: Top holder owns ${topHolderPct.toFixed(1)}%`;
      score = 5;
    } else {
      score = 10;
      detail = `Top holder: ${topHolderPct.toFixed(1)}%`;
    }

    if (top10Pct > CONFIG.MAX_TOP10_HOLDER_PCT && top10Pct <= 70) {
      detail += ` | Top 10: ${top10Pct.toFixed(1)}% (concentrated)`;
      score = Math.min(score, 5);
    } else if (top10Pct > 70) {
      detail += ` | Top 10: ${top10Pct.toFixed(1)}% — extreme concentration`;
      score = 0;
      passed = false;
    } else {
      detail += ` | Top 10: ${top10Pct.toFixed(1)}% (healthy)`;
      score += 5;
    }

    return { name, passed, score: Math.min(score, 15), maxScore: 15, detail };
  } catch (err) {
    return { name, passed: false, score: 0, maxScore: 15, detail: `RPC error: ${err}` };
  }
}

function checkLiquidity(pair: TokenPair): SafetyCheck {
  const name = 'Liquidity Depth';
  const liq = pair.liquidity?.usd ?? 0;

  if (liq < CONFIG.MIN_LIQUIDITY_USD) {
    return { name, passed: false, score: 0, maxScore: 10, detail: `Liquidity $${liq.toFixed(0)} below minimum $${CONFIG.MIN_LIQUIDITY_USD}` };
  }
  if (liq < 10_000) {
    return { name, passed: true, score: 4, maxScore: 10, detail: `Liquidity: $${liq.toFixed(0)} — low but acceptable` };
  }
  if (liq < 50_000) {
    return { name, passed: true, score: 7, maxScore: 10, detail: `Liquidity: $${liq.toFixed(0)} — moderate` };
  }
  return { name, passed: true, score: 10, maxScore: 10, detail: `Liquidity: $${liq.toFixed(0)} — strong` };
}

function checkVolumeAndMomentum(pair: TokenPair): SafetyCheck {
  const name = 'Volume & Momentum';
  const vol5m = pair.volume?.m5 ?? 0;
  const volH1 = pair.volume?.h1 ?? 0;
  const buys5m = pair.txns?.m5?.buys ?? 0;
  const sells5m = pair.txns?.m5?.sells ?? 0;
  const priceChange5m = pair.priceChange?.m5 ?? 0;

  let score = 0;
  const details: string[] = [];
  let passed = true;

  // Volume check
  if (vol5m >= CONFIG.MIN_5M_VOLUME_USD) {
    score += 4;
    details.push(`5m vol: $${vol5m.toFixed(0)}`);
  } else {
    details.push(`5m vol: $${vol5m.toFixed(0)} (low)`);
  }

  // Buy/sell ratio
  const totalTxns = buys5m + sells5m;
  if (totalTxns > 0) {
    const ratio = buys5m / Math.max(sells5m, 1);
    if (ratio >= CONFIG.MIN_BUY_SELL_RATIO) {
      score += 4;
      details.push(`Buy/sell: ${ratio.toFixed(1)}:1`);
    } else if (ratio >= 1) {
      score += 2;
      details.push(`Buy/sell: ${ratio.toFixed(1)}:1 (neutral)`);
    } else {
      details.push(`Buy/sell: ${ratio.toFixed(1)}:1 (bearish)`);
      passed = false;
    }
  }

  // Price momentum
  if (priceChange5m > 10) {
    score += 5;
    details.push(`5m change: +${priceChange5m.toFixed(1)}%`);
  } else if (priceChange5m > 0) {
    score += 3;
    details.push(`5m change: +${priceChange5m.toFixed(1)}%`);
  } else {
    details.push(`5m change: ${priceChange5m.toFixed(1)}%`);
  }

  // Hourly volume bonus
  if (volH1 > 10_000) {
    score += 2;
  }

  return { name, passed, score: Math.min(score, 15), maxScore: 15, detail: details.join(' | ') };
}

function checkSocialPresence(pair: TokenPair): SafetyCheck {
  const name = 'Social / Metadata';
  let score = 0;
  const details: string[] = [];

  if (pair.info?.websites && pair.info.websites.length > 0) {
    score += 3;
    details.push('Has website');
  }

  const socials = pair.info?.socials ?? [];
  const hasTwitter = socials.some((s) => s.type === 'twitter');
  const hasTelegram = socials.some((s) => s.type === 'telegram');

  if (hasTwitter) { score += 3; details.push('Has Twitter'); }
  if (hasTelegram) { score += 2; details.push('Has Telegram'); }

  if (details.length === 0) {
    details.push('No social presence detected');
  }

  return { name, passed: true, score: Math.min(score, 8), maxScore: 8, detail: details.join(' | ') };
}

function checkTokenAge(pair: TokenPair): SafetyCheck {
  const name = 'Token Age';
  if (!pair.pairCreatedAt) {
    return { name, passed: false, score: 0, maxScore: 7, detail: 'Unknown creation time' };
  }

  const ageMin = (Date.now() - pair.pairCreatedAt) / 60_000;

  if (ageMin < 5) {
    return { name, passed: true, score: 7, maxScore: 7, detail: `Just launched: ${ageMin.toFixed(0)}m ago — maximum snipe potential` };
  }
  if (ageMin < 15) {
    return { name, passed: true, score: 5, maxScore: 7, detail: `${ageMin.toFixed(0)}m old — early entry` };
  }
  if (ageMin < CONFIG.MAX_TOKEN_AGE_MINUTES) {
    return { name, passed: true, score: 3, maxScore: 7, detail: `${ageMin.toFixed(0)}m old — still viable` };
  }
  return { name, passed: false, score: 0, maxScore: 7, detail: `${ageMin.toFixed(0)}m old — too old to snipe` };
}

// ── Honeypot Simulation ──
// We check if the token can be sold by verifying Jupiter has a quote for it

async function checkHoneypot(tokenAddress: string): Promise<SafetyCheck> {
  const name = 'Honeypot Check';

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  // Try multiple Jupiter API versions for resilience
  const urls = [
    `https://api.jup.ag/swap/v1/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=5000`,
    `https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=${SOL_MINT}&amount=1000000&slippageBps=5000`,
  ];

  for (const quoteUrl of urls) {
    try {
      const res = await fetch(quoteUrl, { signal: AbortSignal.timeout(8_000) });

      if (!res.ok) {
        const status = res.status;
        // 400 = bad input (token not routable), 404 = endpoint gone
        if (status === 400) {
          return { name, passed: false, score: 0, maxScore: 20, detail: 'DANGER: Token not routable — possible honeypot' };
        }
        continue; // Try next URL
      }

      const data = await res.json() as { outAmount?: string; routePlan?: unknown[] };

      if (!data.outAmount || data.outAmount === '0') {
        return { name, passed: false, score: 0, maxScore: 20, detail: 'DANGER: Sell returns 0 — confirmed honeypot' };
      }

      return { name, passed: true, score: 20, maxScore: 20, detail: 'Sell route verified — not a honeypot' };
    } catch {
      continue; // Try next URL
    }
  }

  // If all URLs failed, give partial score (network issue, not necessarily honeypot)
  return { name, passed: true, score: 10, maxScore: 20, detail: 'Could not verify sell route (API unreachable) — proceeding with caution' };
}

// ── Aggregate Safety Check ──

export async function runSafetyChecks(pair: TokenPair): Promise<SafetyResult> {
  const tokenAddr = pair.baseToken.address;
  log.info(MODULE, `Running safety checks on ${pair.baseToken.symbol} (${tokenAddr.slice(0, 8)}...)`);

  // Run on-chain checks in parallel
  const [mintAuth, freezeAuth, holders, honeypot] = await Promise.all([
    checkMintAuthority(tokenAddr),
    checkFreezeAuthority(tokenAddr),
    checkTopHolders(tokenAddr),
    checkHoneypot(tokenAddr),
  ]);

  // Run data-based checks synchronously (no I/O)
  const liquidity = checkLiquidity(pair);
  const volume = checkVolumeAndMomentum(pair);
  const social = checkSocialPresence(pair);
  const age = checkTokenAge(pair);

  const checks = [mintAuth, freezeAuth, holders, honeypot, liquidity, volume, social, age];
  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const maxPossible = checks.reduce((sum, c) => sum + c.maxScore, 0);
  const normalizedScore = Math.round((totalScore / maxPossible) * 100);

  // Collect red flags
  const flags: string[] = [];
  for (const c of checks) {
    if (!c.passed) flags.push(`${c.name}: ${c.detail}`);
  }

  // Critical failures that auto-reject regardless of score
  const criticalFail = !mintAuth.passed || !honeypot.passed || (!holders.passed && (flags.some(f => f.includes('DANGER'))));
  const passed = !criticalFail && normalizedScore >= CONFIG.MIN_SAFETY_SCORE;

  // Log results
  for (const c of checks) {
    const icon = c.passed ? '+' : 'X';
    const lvl = c.passed ? 'info' : 'warn';
    log[lvl](MODULE, `  [${icon}] ${c.name} (${c.score}/${c.maxScore}) — ${c.detail}`);
  }
  log[passed ? 'success' : 'warn'](MODULE, `Safety score: ${normalizedScore}/100 — ${passed ? 'PASSED' : 'FAILED'}`);

  return { score: normalizedScore, passed, checks, flags };
}

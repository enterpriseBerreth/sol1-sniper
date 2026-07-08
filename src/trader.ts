import { CONFIG } from './config.js';
import { Position, TradeEvent, BotState, TokenPair, SafetyResult } from './types.js';
import { fetchJupiterPrices } from './scanner.js';
import { TelegramAlert } from './telegram.js';
import { log } from './logger.js';

const MODULE = 'TRADER';

export class PaperTrader {
  private state: BotState;
  private telegram: TelegramAlert;
  private priceInterval: ReturnType<typeof setInterval> | null = null;
  private tradeLog: TradeEvent[] = [];
  private wins = 0;
  private losses = 0;

  constructor(telegram: TelegramAlert) {
    this.telegram = telegram;
    this.state = {
      budgetRemaining: CONFIG.STARTING_BUDGET_USD,
      totalPnl: 0,
      tradesExecuted: 0,
      positions: new Map(),
      seenTokens: new Set(),
      startTime: Date.now(),
    };
  }

  // ── Getters ──

  get openPositionCount(): number {
    let count = 0;
    for (const p of this.state.positions.values()) {
      if (p.status === 'open' || p.status === 'partial') count++;
    }
    return count;
  }

  get budgetRemaining(): number {
    return this.state.budgetRemaining;
  }

  canTrade(): boolean {
    return (
      this.openPositionCount < CONFIG.MAX_CONCURRENT_TRADES &&
      this.state.budgetRemaining >= CONFIG.TRADE_SIZE_USD
    );
  }

  hasPosition(tokenAddress: string): boolean {
    const pos = this.state.positions.get(tokenAddress);
    return !!pos && (pos.status === 'open' || pos.status === 'partial');
  }

  // ── Entry ──

  async executeBuy(pair: TokenPair, safetyResult: SafetyResult): Promise<void> {
    const tokenAddr = pair.baseToken.address;
    const price = parseFloat(pair.priceUsd);
    const sizeUsd = CONFIG.TRADE_SIZE_USD;

    if (!this.canTrade()) {
      log.warn(MODULE, `Cannot trade — limit reached or insufficient budget`);
      return;
    }

    if (this.hasPosition(tokenAddr)) {
      log.warn(MODULE, `Already have position in ${pair.baseToken.symbol}`);
      return;
    }

    // Deduct from budget
    this.state.budgetRemaining -= sizeUsd;

    const position: Position = {
      id: `${tokenAddr}-${Date.now()}`,
      tokenAddress: tokenAddr,
      tokenSymbol: pair.baseToken.symbol,
      tokenName: pair.baseToken.name,
      pairAddress: pair.pairAddress,
      entryPrice: price,
      currentPrice: price,
      highestPrice: price,
      initialSizeUsd: sizeUsd,
      remainingSizeUsd: sizeUsd,
      soldUsd: 0,
      entryTime: Date.now(),
      lastUpdate: Date.now(),
      status: 'open',
      pnlUsd: 0,
      pnlPct: 0,
      safetyScore: safetyResult.score,
      capitalBeforeBuy: this.state.budgetRemaining + sizeUsd,
      takeProfitLevelsHit: [],
      trailingStopPrice: price * (1 - CONFIG.INITIAL_STOP_LOSS_PCT / 100),
    };

    this.state.positions.set(tokenAddr, position);
    this.state.tradesExecuted++;

    const event: TradeEvent = {
      action: 'BUY',
      position,
      amountUsd: sizeUsd,
      price,
      reason: `Safety: ${safetyResult.score}/100`,
      timestamp: Date.now(),
    };
    this.tradeLog.push(event);

    log.trade(MODULE, `BUY ${pair.baseToken.symbol} @ $${this.fmtPrice(price)} | Size: $${sizeUsd.toFixed(2)} | Budget left: $${this.state.budgetRemaining.toFixed(2)}`);
  }

  // ── Price updates & exit monitoring ──

  startPriceMonitor() {
    log.info(MODULE, `Starting price monitor — updating every ${CONFIG.PRICE_UPDATE_INTERVAL_MS / 1000}s`);
    this.priceInterval = setInterval(() => this.updatePrices(), CONFIG.PRICE_UPDATE_INTERVAL_MS);
  }

  stopPriceMonitor() {
    if (this.priceInterval) {
      clearInterval(this.priceInterval);
      this.priceInterval = null;
    }
  }

  private async updatePrices(): Promise<void> {
    const openPositions = this.getOpenPositions();
    if (openPositions.length === 0) return;

    const mints = openPositions.map((p) => p.tokenAddress);
    const prices = await fetchJupiterPrices(mints);

    for (const position of openPositions) {
      const newPrice = prices.get(position.tokenAddress);
      if (!newPrice || newPrice <= 0) continue;

      position.currentPrice = newPrice;
      position.lastUpdate = Date.now();

      // Track highest price
      if (newPrice > position.highestPrice) {
        position.highestPrice = newPrice;
      }

      // Recalculate PNL
      const priceChangePct = ((newPrice - position.entryPrice) / position.entryPrice) * 100;
      position.pnlPct = priceChangePct;
      position.pnlUsd = position.remainingSizeUsd * (priceChangePct / 100);

      // Check exit conditions
      await this.checkExits(position);
    }
  }

  private async checkExits(position: Position): Promise<void> {
    if (position.status === 'closed') return;

    const pricePctFromEntry = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
    const pricePctFromHigh = ((position.currentPrice - position.highestPrice) / position.highestPrice) * 100;
    const holdTimeMs = Date.now() - position.entryTime;
    const holdTimeMin = holdTimeMs / 60_000;

    // ── 1. Check take-profit levels ──
    for (const level of CONFIG.TAKE_PROFIT_LEVELS) {
      if (position.takeProfitLevelsHit.includes(level.triggerPct)) continue;
      if (pricePctFromEntry >= level.triggerPct) {
        const sellAmount = position.initialSizeUsd * (level.sellPct / 100);
        const actualSell = Math.min(sellAmount, position.remainingSizeUsd);
        if (actualSell <= 0) continue;

        position.takeProfitLevelsHit.push(level.triggerPct);
        await this.executePartialSell(
          position,
          actualSell,
          `Take profit @ +${level.triggerPct}%`
        );

        // If all take-profit levels hit and only 25% remains, tighten trailing stop
        if (position.takeProfitLevelsHit.length >= CONFIG.TAKE_PROFIT_LEVELS.length) {
          const tightStop = position.highestPrice * 0.92; // 8% trail
          if (tightStop > position.trailingStopPrice) {
            position.trailingStopPrice = tightStop;
            log.info(MODULE, `${position.tokenSymbol} — Tightened trailing stop to $${this.fmtPrice(tightStop)} (final 25%)`);
          }
        }
      }
    }

    // ── 2. Update trailing stop ──
    this.updateTrailingStop(position, pricePctFromEntry);

    // ── 3. Check trailing stop hit ──
    if (position.currentPrice <= position.trailingStopPrice && position.remainingSizeUsd > 0) {
      await this.executeSell(position, `Trailing stop hit @ $${this.fmtPrice(position.trailingStopPrice)}`);
      return;
    }

    // ── 4. Initial stop loss (before any profit) ──
    if (pricePctFromEntry <= -CONFIG.INITIAL_STOP_LOSS_PCT && position.takeProfitLevelsHit.length === 0) {
      await this.executeSell(position, `Stop loss: ${pricePctFromEntry.toFixed(1)}%`);
      return;
    }

    // ── 5. Time-based stale exit ──
    if (holdTimeMin >= CONFIG.STALE_EXIT_MINUTES && pricePctFromEntry < CONFIG.STALE_EXIT_MIN_GAIN_PCT) {
      await this.executeSell(position, `Stale exit: only +${pricePctFromEntry.toFixed(1)}% after ${holdTimeMin.toFixed(0)}m`);
      return;
    }

    // ── 6. Max hold time ──
    if (holdTimeMin >= CONFIG.MAX_HOLD_TIME_MINUTES) {
      await this.executeSell(position, `Max hold time reached (${CONFIG.MAX_HOLD_TIME_MINUTES}m)`);
      return;
    }
  }

  private updateTrailingStop(position: Position, pricePctFromEntry: number): void {
    // Find the appropriate trailing tier based on current profit
    let bestTier = null;
    for (const tier of CONFIG.TRAILING_STOP_TIERS) {
      if (pricePctFromEntry >= tier.activateAbovePct) {
        bestTier = tier;
      }
    }

    if (!bestTier) return;

    const newStop = position.highestPrice * (1 - bestTier.trailDistancePct / 100);
    if (newStop > position.trailingStopPrice) {
      const oldStop = position.trailingStopPrice;
      position.trailingStopPrice = newStop;
      log.info(
        MODULE,
        `${position.tokenSymbol} — Trailing stop raised: $${this.fmtPrice(oldStop)} -> $${this.fmtPrice(newStop)} (${bestTier.trailDistancePct}% from peak at +${pricePctFromEntry.toFixed(0)}%)`
      );
    }
  }

  // ── Sell execution ──

  private async executeSell(position: Position, reason: string): Promise<void> {
    if (position.remainingSizeUsd <= 0) return;

    const budgetBefore = this.state.budgetRemaining;

    const sellAmount = position.remainingSizeUsd;
    const pnlOnSell = sellAmount * (position.pnlPct / 100);
    const proceeds = sellAmount + pnlOnSell;

    position.soldUsd += proceeds;
    position.remainingSizeUsd = 0;
    position.status = 'closed';
    position.exitReason = reason;

    // Return proceeds to budget
    this.state.budgetRemaining += proceeds;

    // Track total PNL
    const totalPnl = position.soldUsd - position.initialSizeUsd;
    const totalPnlPct = (totalPnl / position.initialSizeUsd) * 100;
    position.pnlUsd = totalPnl;
    position.pnlPct = totalPnlPct;

    this.state.totalPnl += totalPnl;

    if (totalPnl >= 0) this.wins++;
    else this.losses++;

    const holdTime = this.formatHoldTime(Date.now() - position.entryTime);
    const sign = totalPnl >= 0 ? '+' : '';

    log.trade(
      MODULE,
      `SELL ${position.tokenSymbol} @ $${this.fmtPrice(position.currentPrice)} | PNL: ${sign}$${totalPnl.toFixed(2)} (${sign}${totalPnlPct.toFixed(2)}%) | Reason: ${reason} | Hold: ${holdTime}`
    );

    const event: TradeEvent = {
      action: 'SELL',
      position,
      amountUsd: sellAmount,
      price: position.currentPrice,
      reason,
      timestamp: Date.now(),
    };
    this.tradeLog.push(event);

    // Telegram: TRADE MADE alert (only on full close)
    await this.telegram.sendTradeAlert({
      tokenName: `${position.tokenSymbol} (${position.tokenName})`,
      safetyScore: position.safetyScore,
      capitalBeforeBuy: position.capitalBeforeBuy,
      capitalAfterSell: this.state.budgetRemaining,
      pnlUsd: totalPnl,
      pnlPct: totalPnlPct,
    });
  }

  private async executePartialSell(position: Position, amountUsd: number, reason: string): Promise<void> {
    const pnlOnSell = amountUsd * (position.pnlPct / 100);
    const proceeds = amountUsd + pnlOnSell;

    position.soldUsd += proceeds;
    position.remainingSizeUsd -= amountUsd;
    position.status = position.remainingSizeUsd > 0 ? 'partial' : 'closed';

    // Return proceeds to budget
    this.state.budgetRemaining += proceeds;
    this.state.totalPnl += pnlOnSell;

    const holdTime = this.formatHoldTime(Date.now() - position.entryTime);
    const sign = pnlOnSell >= 0 ? '+' : '';

    log.trade(
      MODULE,
      `PARTIAL SELL ${position.tokenSymbol} ($${amountUsd.toFixed(2)}) @ $${this.fmtPrice(position.currentPrice)} | PNL: ${sign}$${pnlOnSell.toFixed(2)} | Remaining: $${position.remainingSizeUsd.toFixed(2)} | ${reason}`
    );

    const event: TradeEvent = {
      action: 'PARTIAL_SELL',
      position,
      amountUsd,
      price: position.currentPrice,
      reason,
      timestamp: Date.now(),
    };
    this.tradeLog.push(event);
  }

  // ── Status & Reporting ──

  getOpenPositions(): Position[] {
    return Array.from(this.state.positions.values()).filter(
      (p) => p.status === 'open' || p.status === 'partial'
    );
  }

  printStatus(): void {
    const open = this.getOpenPositions();
    const runtime = this.formatHoldTime(Date.now() - this.state.startTime);
    const totalTrades = this.state.tradesExecuted;
    const winRate = totalTrades > 0 ? (this.wins / (this.wins + this.losses)) * 100 : 0;

    log.banner('SOL1 STATUS');
    console.log(`  Mode:            ${CONFIG.PAPER_TRADE ? 'Paper Trade' : 'LIVE'}`);
    console.log(`  Runtime:         ${runtime}`);
    console.log(`  Budget:          $${this.state.budgetRemaining.toFixed(2)} / $${CONFIG.STARTING_BUDGET_USD}`);
    console.log(`  Total PNL:       $${this.state.totalPnl.toFixed(2)}`);
    console.log(`  Trades:          ${totalTrades} (W: ${this.wins} / L: ${this.losses} | ${winRate.toFixed(0)}%)`);
    console.log(`  Open positions:  ${open.length} / ${CONFIG.MAX_CONCURRENT_TRADES}`);

    if (open.length > 0) {
      console.log(`\n  Open Positions:`);
      for (const p of open) {
        const sign = p.pnlPct >= 0 ? '+' : '';
        const holdTime = this.formatHoldTime(Date.now() - p.entryTime);
        console.log(
          `    ${p.tokenSymbol.padEnd(10)} | Entry: $${this.fmtPrice(p.entryPrice)} | Now: $${this.fmtPrice(p.currentPrice)} | PNL: ${sign}${p.pnlPct.toFixed(1)}% | Stop: $${this.fmtPrice(p.trailingStopPrice)} | Hold: ${holdTime}`
        );
      }
    }
    console.log('');
  }

  // ── Helpers ──

  private fmtPrice(price: number): string {
    if (price < 0.00001) return price.toExponential(4);
    if (price < 0.01) return price.toFixed(8);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(4);
  }

  private formatAge(createdAt?: number): string {
    if (!createdAt) return 'unknown';
    const mins = Math.floor((Date.now() - createdAt) / 60_000);
    if (mins < 1) return '<1m';
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  private formatHoldTime(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }
}

import { CONFIG } from './config.js';
import { log } from './logger.js';

const MODULE = 'TELEGRAM';

export class TelegramAlert {
  private botToken: string;
  private chatId: string;
  private enabled: boolean;

  constructor() {
    this.botToken = CONFIG.TELEGRAM_BOT_TOKEN;
    this.chatId = CONFIG.TELEGRAM_CHAT_ID;
    this.enabled = !!(this.botToken && this.chatId);

    if (!this.enabled) {
      log.warn(MODULE, 'Telegram not configured — alerts will only show in console');
      log.warn(MODULE, 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable');
    } else {
      log.success(MODULE, 'Telegram alerts enabled');
    }
  }

  async sendBuyAlert(data: {
    symbol: string;
    name: string;
    price: number;
    sizeUsd: number;
    safetyScore: number;
    liquidity: number;
    pairAge: string;
    tokenAddress: string;
  }): Promise<void> {
    const msg = [
      `🟢 *SOL1 — NEW BUY*`,
      ``,
      `*Token:* ${this.esc(data.symbol)} (${this.esc(data.name)})`,
      `*Price:* $${this.formatPrice(data.price)}`,
      `*Size:* $${data.sizeUsd.toFixed(2)}`,
      `*Safety:* ${data.safetyScore}/100`,
      `*Liquidity:* $${data.liquidity.toFixed(0)}`,
      `*Age:* ${data.pairAge}`,
      `*Mode:* ${CONFIG.PAPER_TRADE ? '📝 Paper Trade' : '💰 LIVE'}`,
      ``,
      `[DexScreener](https://dexscreener.com/solana/${data.tokenAddress})`,
    ].join('\n');

    await this.send(msg);
  }

  async sendSellAlert(data: {
    symbol: string;
    name: string;
    action: string;
    entryPrice: number;
    exitPrice: number;
    pnlUsd: number;
    pnlPct: number;
    reason: string;
    holdTime: string;
  }): Promise<void> {
    const pnlEmoji = data.pnlUsd >= 0 ? '🟢' : '🔴';
    const pnlSign = data.pnlUsd >= 0 ? '+' : '';

    const msg = [
      `${pnlEmoji} *SOL1 — ${data.action}*`,
      ``,
      `*Token:* ${this.esc(data.symbol)} (${this.esc(data.name)})`,
      `*Entry:* $${this.formatPrice(data.entryPrice)}`,
      `*Exit:* $${this.formatPrice(data.exitPrice)}`,
      `*PNL:* ${pnlSign}$${data.pnlUsd.toFixed(2)} (${pnlSign}${data.pnlPct.toFixed(2)}%)`,
      `*Reason:* ${data.reason}`,
      `*Hold Time:* ${data.holdTime}`,
      `*Mode:* ${CONFIG.PAPER_TRADE ? '📝 Paper Trade' : '💰 LIVE'}`,
    ].join('\n');

    await this.send(msg);
  }

  async sendDailySummary(data: {
    totalTrades: number;
    openPositions: number;
    totalPnlUsd: number;
    totalPnlPct: number;
    budgetRemaining: number;
    winRate: number;
    bestTrade: string;
    worstTrade: string;
  }): Promise<void> {
    const msg = [
      `📊 *SOL1 — DAILY SUMMARY*`,
      ``,
      `*Total Trades:* ${data.totalTrades}`,
      `*Open Positions:* ${data.openPositions}`,
      `*Total PNL:* $${data.totalPnlUsd.toFixed(2)} (${data.totalPnlPct.toFixed(2)}%)`,
      `*Budget Remaining:* $${data.budgetRemaining.toFixed(2)}`,
      `*Win Rate:* ${data.winRate.toFixed(1)}%`,
      `*Best:* ${data.bestTrade}`,
      `*Worst:* ${data.worstTrade}`,
    ].join('\n');

    await this.send(msg);
  }

  async sendStartupAlert(): Promise<void> {
    const msg = [
      `🚀 *SOL1 Sniper Bot Started*`,
      ``,
      `*Mode:* ${CONFIG.PAPER_TRADE ? '📝 Paper Trade' : '💰 LIVE TRADING'}`,
      `*Budget:* $${CONFIG.STARTING_BUDGET_USD}`,
      `*Trade Size:* $${CONFIG.TRADE_SIZE_USD}`,
      `*Max Concurrent:* ${CONFIG.MAX_CONCURRENT_TRADES}`,
      `*Min Safety Score:* ${CONFIG.MIN_SAFETY_SCORE}/100`,
    ].join('\n');

    await this.send(msg);
  }

  // ── Internal ──

  private async send(text: string): Promise<void> {
    if (!this.enabled) return;

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const err = await res.text();
        log.error(MODULE, `Failed to send: ${err}`);
      }
    } catch (err) {
      log.error(MODULE, `Send error: ${err}`);
    }
  }

  private esc(text: string): string {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
  }

  private formatPrice(price: number): string {
    if (price < 0.00001) return price.toExponential(4);
    if (price < 0.01) return price.toFixed(8);
    if (price < 1) return price.toFixed(6);
    return price.toFixed(4);
  }
}

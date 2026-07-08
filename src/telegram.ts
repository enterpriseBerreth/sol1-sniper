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
    } else {
      log.success(MODULE, 'Telegram alerts enabled');
    }
  }

  // ── ALERT 1: TRADE MADE ──

  async sendTradeAlert(data: {
    tokenName: string;
    safetyScore: number;
    capitalBeforeBuy: number;
    capitalAfterSell: number;
    pnlUsd: number;
    pnlPct: number;
  }): Promise<void> {
    const pnlEmoji = data.pnlUsd >= 0 ? '🟢' : '🔴';
    const sign = data.pnlUsd >= 0 ? '+' : '';

    const msg = [
      `${pnlEmoji} *SOL1 — TRADE MADE*`,
      ``,
      `*Token:* ${this.esc(data.tokenName)}`,
      `*Safety Score:* ${data.safetyScore}/100`,
      `*Capital Before Buy:* $${data.capitalBeforeBuy.toFixed(2)}`,
      `*Capital After Sell:* $${data.capitalAfterSell.toFixed(2)}`,
      `*PNL:* ${sign}$${data.pnlUsd.toFixed(2)}`,
      `*PNL %:* ${sign}${data.pnlPct.toFixed(2)}%`,
    ].join('\n');

    await this.send(msg);
  }

  // ── ALERT 2: BOT STOPPED / CRASHED ──

  async sendStoppedAlert(reason: string): Promise<void> {
    const msg = [
      `🛑 *SOL1 — BOT STOPPED*`,
      ``,
      `*Reason:* ${this.esc(reason)}`,
      `*Mode:* ${CONFIG.PAPER_TRADE ? '📝 Paper Trade' : '💰 LIVE'}`,
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
}

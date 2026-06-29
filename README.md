# SOL1 — Solana Sniper Bot

A Solana token sniper bot that automatically detects and paper-trades newly launched tokens, with aggressive scam protection and trailing exit strategies for maximum profit capture.

## Features

- **New Token Detection** — Monitors DexScreener for freshly launched Solana tokens (< 30 min old)
- **8-Layer Safety System** — Mint authority, freeze authority, holder distribution, liquidity depth, honeypot simulation, volume/momentum, social presence, token age
- **Paper Trading** — Starts with $1,000 USD simulated budget, $30 per trade
- **Smart Position Management** — Max 3 concurrent trades with full lifecycle tracking
- **Trailing Stop Loss** — Dynamic stops that tighten as profit increases (15% → 12% → 10% → 8%)
- **Multi-Level Take Profit** — Auto-sells 25% at 2x, 3x, and 6x with tight trailing stop on final 25%
- **Telegram Alerts** — Real-time buy/sell notifications with PNL in $ and %
- **Stale Exit** — Auto-closes positions with < 10% gain after 30 minutes
- **Time-Based Exit** — Mandatory close after 2 hours max hold

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
copy env.template .env
```

Edit `.env` with your settings:

```env
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
PAPER_TRADE=true
```

#### Getting Telegram credentials

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → save the token
2. Message your new bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → find your `chat_id`

#### Recommended RPC

The public Solana RPC has rate limits. For best performance, use a dedicated RPC:
- [Helius](https://helius.dev) (free tier available)
- [QuickNode](https://quicknode.com)
- [Alchemy](https://alchemy.com)

### 3. Run the bot

```bash
npm start
```

Or in watch mode (auto-restart on changes):

```bash
npm run dev
```

## Trading Parameters

| Parameter | Value |
|-----------|-------|
| Mode | Paper Trading |
| Budget | $1,000 USD |
| Trade Size | $30 per trade |
| Max Concurrent | 3 trades |
| Min Safety Score | 80/100 |
| Min Liquidity | $5,000 |
| Stop Loss | 20% initial |
| Max Hold | 2 hours |

## Safety Checks (Scoring)

| Check | Max Score | Critical? |
|-------|-----------|-----------|
| Honeypot Simulation | 20 | Yes — auto-reject |
| Mint Authority Revoked | 15 | Yes — auto-reject |
| Holder Distribution | 15 | If DANGER flag |
| Volume & Momentum | 15 | No |
| Freeze Authority | 10 | No |
| Liquidity Depth | 10 | No |
| Social Presence | 8 | No |
| Token Age | 7 | No |

Tokens must score **80/100+** AND pass all critical checks to be traded.

## Exit Strategy

```
Price Movement          Action
─────────────────────────────────────
Drop -20%              → Stop loss (sell 100%)
Rise +100% (2x)        → Take profit (sell 25%)
Rise +200% (3x)        → Take profit (sell 25%)
Rise +500% (6x)        → Take profit (sell 25%)
Final 25%              → Tight 8% trailing stop

Trailing Stop Tiers:
  Above +30%           → 15% trail from peak
  Above +75%           → 12% trail from peak
  Above +150%          → 10% trail from peak
  Above +300%          → 8% trail from peak

Time Exits:
  30 min + <10% gain   → Stale exit (sell 100%)
  2 hours              → Forced exit (sell 100%)
```

## Project Structure

```
src/
├── index.ts       Main orchestrator
├── config.ts      All configuration constants
├── types.ts       TypeScript interfaces
├── scanner.ts     New token discovery (DexScreener + Jupiter)
├── safety.ts      8-layer scam protection
├── trader.ts      Paper trading engine + exits
├── telegram.ts    Telegram alert system
└── logger.ts      Colored console logging
```

## Disclaimer

This bot is for **educational and paper trading purposes only**. Cryptocurrency trading involves substantial risk of loss. New token sniping is extremely high risk. Never trade with money you cannot afford to lose. The authors are not responsible for any financial losses.

# COPYBOT — Solana Copytrade Bot

A Solana copytrading bot that monitors specified wallets, copies their token buys and sells in real-time, auto-seeds new profitable wallets, and sends Telegram alerts after each trade exit.

## Features

- **Wallet Copy Trading** — Monitors up to 10 Solana wallets and copies their token swaps (buys & sells)
- **Auto Wallet Seeding** — Discovers new profitable wallets by analyzing co-buying patterns, auto-adds up to 10 total
- **Paper Trading** — Starts with $1,000 USD simulated budget, $30 per trade, max 3 concurrent
- **Helius Enhanced Parsing** — Uses Helius Enhanced Transactions API for accurate swap detection
- **Telegram Alerts** — Sends detailed trade reports after each exit (Copied Wallet, Token, Capital, PNL)
- **Safety Exits** — Emergency stop loss at -50%, max hold time 4 hours
- **Crash Protection** — Graceful shutdown with Telegram notifications on errors

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
copy env.template .env
```

Edit `.env`:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PAPER_TRADE=true
```

### 3. Run the bot

```bash
npm start
```

Watch mode (auto-restart on changes):

```bash
npm run dev
```

## How It Works

```
Watched Wallets (3 starting + auto-seeded up to 10)
        │
        ▼
   Wallet Monitor (polls every 5s via Helius RPC)
        │
        ▼
   Helius Enhanced API (parse SWAP transactions)
        │
        ├── BUY detected → Copy buy ($30 paper trade)
        │
        └── SELL detected → Copy sell (close position)
                │
                ▼
         Telegram Alert (PNL report after exit)
```

## Trading Parameters

| Parameter | Value |
|-----------|-------|
| Mode | Paper Trading |
| Budget | $1,000 USD |
| Trade Size | $30 per trade |
| Max Concurrent | 3 trades |
| Max Hold Time | 4 hours |
| Emergency Stop Loss | -50% |
| Max Wallets | 10 (3 starting + auto-seeded) |

## Starting Wallets

| Wallet | Label |
|--------|-------|
| `4nvNc7dDEqKKLM4Sr9Kgk3t1of6f8G66kT64VoC95LYh` | 4nvN...5LYh |
| `kiLogfWUXp7nby7Xi6R9t7u8ERQyRdAzg6wBjvuE49uA` | kiLo...49uA |
| `UEQxhkAVz71w2WBa9BYSoZrydhYNJaKmfNomoNs9E4t` | UEQx...E4t |

## Telegram Alert Format

After each trade exit:

```
🟢 COPYBOT - TRADE CLOSED

Copied Wallet: 4nvN...5LYh
Token: BONK (Bonk)
Capital Before Buy: $1000.00
Capital After Sell: $1003.50
PNL: +$3.50
PNL %: +11.67%
```

## Auto Wallet Seeder

The bot automatically discovers and adds new wallets:

1. When a watched wallet buys a token, the seeder records it
2. Every 5 minutes, it scans for other wallets that bought the same tokens
3. Wallets with 2+ co-buys across different tokens get auto-added
4. Capped at 10 total watched wallets

## Project Structure

```
src/
├── index.ts            Main orchestrator
├── config.ts           Configuration constants
├── types.ts            TypeScript interfaces
├── helius.ts           Helius API helpers (transaction parsing, price lookups)
├── wallet-monitor.ts   Wallet transaction polling
├── copy-trader.ts      Paper trading engine
├── wallet-seeder.ts    Auto wallet discovery
├── telegram.ts         Telegram alert system
└── logger.ts           Colored console logging
```

## Deployment

### Railway

```bash
# Push to GitHub then connect Railway to the repo
railway up
```

Environment variables to set in Railway:
- `SOLANA_RPC_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `PAPER_TRADE=true`

## Disclaimer

This bot is for **educational and paper trading purposes only**. Cryptocurrency trading involves substantial risk of loss. Never trade with money you cannot afford to lose.

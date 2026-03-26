/**
 * Seed script — imports the TrumpChud investigation data into the DB.
 * Run: node server/seed.js
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { ingestAuditReport } from './ingest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the TrumpChud audit report
const reportPaths = [
  join(process.env.HOME, 'tools', 'reports', 'FqhdB5odSZzSbUBj_FULL_AUDIT.json'),
  join(__dirname, '..', 'data', 'reports', 'FqhdB5odSZzSbUBj_FULL_AUDIT.json'),
];

let report = null;
for (const p of reportPaths) {
  try {
    const raw = readFileSync(p, 'utf-8');
    report = JSON.parse(raw);
    console.log(`Loaded report from: ${p}`);
    break;
  } catch (e) {}
}

if (!report) {
  console.error('Could not find TrumpChud audit report. Run the forensic audit first.');
  process.exit(1);
}

// Ingest
console.log('Ingesting TrumpChud audit data...');
const result = ingestAuditReport(report);
console.log(`Token: ${result.name} (${result.mint})`);
console.log(`Risk Score: ${result.riskScore}`);

// Also seed the investigation article
db.prepare(`
  INSERT OR REPLACE INTO articles (slug, title, summary, content, token_mint, published, created_at)
  VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
`).run(
  'trumpchud-sybil-attack',
  'TrumpChud — A Coordinated Sybil Attack',
  'One entity controls 20 wallets holding 17% of supply. $102M market cap backed by $819K liquidity.',
  `# TrumpChud ($Trumpchud) — A Coordinated Sybil Attack on Pump.fun

I dug into TrumpChud and what I found is wild. Someone created this token today, spun up 20 brand new wallets, and loaded each one with the exact same amount. 17% of the supply sits in wallets that didn't exist 9 hours ago.

## The Creator

**Wallet:** \`3SoU4zFUH19rfRixeH5LgAoNhxBb323yJ8ULC3joC9YD\`

This wallet was created on March 25, 2026. It has exactly 6 transactions. Its entire life: got 1 SOL, made the token, set up a vesting escrow to look legit, and dipped.

One of its connected wallets is literally named \`dev2RNNbfXAuWdsKj2oKa3gEMRVrSGBe3uUUYZEngc5\` — the word "dev" is in the address.

The funding source \`893pzUZNqKmfcCUfzFqoSt5EKpu3Z6qiKMivsuMNx6Kr\` sent exactly 1 SOL to seed the whole operation.

## The 20 Sybil Wallets

After the token graduated from Pump.fun's bonding curve to PumpSwap (a regular AMM), 20 wallets each bought almost exactly 8.2 million tokens (~0.83% of supply). Every single wallet was created the same day.

The statistical variance of their holdings is 0.014. For reference, a normal token's top-20 holder variance is typically 2-10+. This is automated distribution, not organic buying.

**Combined: ~170M tokens = 17.07% of supply controlled by one entity.**

## The Numbers

| Metric | Value |
|--------|-------|
| Claimed Market Cap | $102,000,000 |
| Real Liquidity | $819,000 |
| Liq/MCap Ratio | 0.80% |
| Price on Pump.fun | $0.00003796 |
| Price on PumpSwap | $0.1019 |
| Price Discrepancy | 5,245x |
| Total Holders | 2,716 |

A coordinated sell of the sybil cluster would wipe out half the liquidity pool.

## How the Scheme Works

1. Fresh wallet receives 1 SOL from funding source
2. Creates token on Pump.fun — bonding curve launches at fractions of a cent
3. Rushes graduation — token moves to PumpSwap (normal AMM where LP is open)
4. Deploys 20 fresh wallets — each buys ~0.83% of supply
5. Creates vesting escrow to look legitimate to scanners
6. Creates Meteora pool with $7 of liquidity to appear "multi-DEX"
7. Runs bots — 65 rapid buys to inflate holder count and volume
8. Waits for organic buyers to provide exit liquidity, then dumps one wallet at a time

## What Most People Don't Realize

On Pump.fun's bonding curve, LP is protocol-controlled. You can't mess with it. But once a token graduates to PumpSwap, it's a regular constant-product AMM. Anyone can add or remove liquidity. The dev rushes graduation then plays the game from PumpSwap.

## Key Transactions

- **Token creation:** \`2Tvf9aQ713yVtgdmKix2jKpuc5UurLS2kEVAXBAr6aZHdxtc5hnSTWUAAtyA2g6qSTqP7mwvfokh6NwmY8TEPW6S\`
- **Creator funded:** \`WbmPwhrakcnJ8Ym5R2LLSpz83uyEf4oMPfhWS1Gn8pwtqFHoDXE1p3aJiQ6uMr94iWAzqhyMLvUERsFRveogaA4\`
- **Vesting escrow:** \`3g2eAYknt9iqkjqtYFtmEaL83KtAF1YG6SCvaEPzTYwp6zpA5DgiVC9A4EuYGGZH3Q2exXtrUQXtQbEuhQW2oFXd\`

Everything here is on chain. Check it yourself on Solscan.`,
  report.token
);

// Print stats
const stats = {
  tokens: db.prepare('SELECT COUNT(*) as c FROM tokens').get().c,
  findings: db.prepare('SELECT COUNT(*) as c FROM findings').get().c,
  pools: db.prepare('SELECT COUNT(*) as c FROM pools').get().c,
  wallets: db.prepare('SELECT COUNT(*) as c FROM wallets').get().c,
  connections: db.prepare('SELECT COUNT(*) as c FROM wallet_connections').get().c,
  links: db.prepare('SELECT COUNT(*) as c FROM token_wallet_links').get().c,
};

console.log('\nDatabase seeded:');
console.log(`  Tokens:      ${stats.tokens}`);
console.log(`  Findings:    ${stats.findings}`);
console.log(`  Pools:       ${stats.pools}`);
console.log(`  Wallets:     ${stats.wallets}`);
console.log(`  Connections:  ${stats.connections}`);
console.log(`  Token-Wallet: ${stats.links}`);
console.log('\nDone!');

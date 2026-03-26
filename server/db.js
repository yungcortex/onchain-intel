import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, '..', 'data', 'onchain-intel.db');

// Ensure data dir exists
import { mkdirSync } from 'fs';
mkdirSync(join(__dirname, '..', 'data'), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    mint TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    creator TEXT,
    risk_score INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    high_count INTEGER DEFAULT 0,
    medium_count INTEGER DEFAULT 0,
    low_count INTEGER DEFAULT 0,
    holder_count INTEGER DEFAULT 0,
    top_holder_pct REAL DEFAULT 0,
    status TEXT DEFAULT 'complete',
    raw_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_mint TEXT REFERENCES tokens(mint) ON DELETE CASCADE,
    severity TEXT,
    description TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_findings_mint ON findings(token_mint);

  CREATE TABLE IF NOT EXISTS pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_mint TEXT REFERENCES tokens(mint) ON DELETE CASCADE,
    dex TEXT,
    address TEXT,
    price REAL DEFAULT 0,
    mcap REAL DEFAULT 0,
    liquidity REAL DEFAULT 0,
    volume_24h REAL DEFAULT 0,
    buys_24h INTEGER DEFAULT 0,
    sells_24h INTEGER DEFAULT 0,
    liq_ratio REAL DEFAULT 0,
    pool_created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pools_mint ON pools(token_mint);

  CREATE TABLE IF NOT EXISTS wallets (
    address TEXT PRIMARY KEY,
    label TEXT,
    risk_level TEXT DEFAULT 'unknown',
    tokens_created INTEGER DEFAULT 0,
    total_rugs INTEGER DEFAULT 0,
    notes TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wallets_risk ON wallets(risk_level);

  CREATE TABLE IF NOT EXISTS token_wallet_links (
    token_mint TEXT REFERENCES tokens(mint) ON DELETE CASCADE,
    wallet_address TEXT REFERENCES wallets(address) ON DELETE CASCADE,
    role TEXT,
    amount REAL,
    PRIMARY KEY (token_mint, wallet_address, role)
  );
  CREATE INDEX IF NOT EXISTS idx_twl_wallet ON token_wallet_links(wallet_address);
  CREATE INDEX IF NOT EXISTS idx_twl_token ON token_wallet_links(token_mint);

  CREATE TABLE IF NOT EXISTS wallet_connections (
    from_address TEXT,
    to_address TEXT,
    type TEXT,
    tx_signature TEXT,
    amount REAL,
    timestamp TEXT,
    PRIMARY KEY (from_address, to_address, type)
  );
  CREATE INDEX IF NOT EXISTS idx_wc_from ON wallet_connections(from_address);
  CREATE INDEX IF NOT EXISTS idx_wc_to ON wallet_connections(to_address);

  CREATE TABLE IF NOT EXISTS articles (
    slug TEXT PRIMARY KEY,
    title TEXT,
    summary TEXT,
    content TEXT,
    token_mint TEXT,
    cover_image TEXT,
    published INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_mint TEXT,
    wallet TEXT,
    message TEXT,
    contact TEXT,
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export default db;

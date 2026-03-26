#!/usr/bin/env python3
"""
PumpFun Bundle Tracker & Dev Wallet Analyzer
=============================================
Tracks bundled wallets, LP manipulation, and dev activity
for pump.fun tokens that graduated to PumpSwap.

Usage:
    python pumpfun_bundle_tracker.py <TOKEN_MINT>
    python pumpfun_bundle_tracker.py FqhdB5odSZzSbUBjyemZZn9rF86xmRtHksLZGQ4Cpump
"""

import sys
import json
import time
import asyncio
import aiohttp
from datetime import datetime, timezone
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

# ── Config ──────────────────────────────────────────────────────────────────
SOLSCAN_API = "https://pro-api.solscan.io/v2.0"
HELIUS_API = "https://api.helius.xyz/v0"
DEXSCREENER_API = "https://api.dexscreener.com/latest/dex"
RUGCHECK_API = "https://api.rugcheck.xyz/v1"
SOLANA_RPC = "https://api.mainnet-beta.solana.com"

# Set your API keys here or via env vars
import os
HELIUS_KEY = os.getenv("HELIUS_API_KEY", "")
SOLSCAN_KEY = os.getenv("SOLSCAN_API_KEY", "")

# ── Data Models ─────────────────────────────────────────────────────────────
@dataclass
class WalletProfile:
    address: str
    token_balance: float = 0.0
    sol_balance: float = 0.0
    pct_supply: float = 0.0
    tx_count: int = 0
    first_buy_slot: int = 0
    first_buy_time: Optional[str] = None
    is_bundled: bool = False
    bundle_group: int = -1
    connected_wallets: list = field(default_factory=list)
    total_bought: float = 0.0
    total_sold: float = 0.0
    pnl_sol: float = 0.0

@dataclass
class BundleGroup:
    group_id: int
    wallets: list = field(default_factory=list)
    total_supply_pct: float = 0.0
    block_slot: int = 0
    tx_signature: str = ""

# ── API Helpers ─────────────────────────────────────────────────────────────
async def fetch_json(session, url, headers=None, params=None):
    """Fetch JSON from URL with retry."""
    for attempt in range(3):
        try:
            async with session.get(url, headers=headers, params=params, timeout=15) as resp:
                if resp.status == 200:
                    return await resp.json()
                elif resp.status == 429:
                    await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    return None
        except Exception:
            await asyncio.sleep(1)
    return None

async def rpc_call(session, method, params=None):
    """Make a Solana RPC call."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or []
    }
    try:
        async with session.post(SOLANA_RPC, json=payload, timeout=15) as resp:
            data = await resp.json()
            return data.get("result")
    except Exception:
        return None

# ── Core Analysis Functions ─────────────────────────────────────────────────
async def get_token_info(session, mint):
    """Get token info from DexScreener."""
    data = await fetch_json(session, f"{DEXSCREENER_API}/tokens/{mint}")
    if not data or "pairs" not in data:
        return None
    return data

async def get_rugcheck_report(session, mint):
    """Get full rugcheck report."""
    data = await fetch_json(session, f"{RUGCHECK_API}/tokens/{mint}/report")
    return data

async def get_top_holders(session, mint):
    """Get top token holders via Solana RPC (getTokenLargestAccounts)."""
    result = await rpc_call(session, "getTokenLargestAccounts", [mint])
    if not result or "value" not in result:
        return []

    holders = []
    for account in result["value"]:
        amount = float(account.get("uiAmount", 0) or 0)
        address = account.get("address", "")
        holders.append({
            "token_account": address,
            "amount": amount,
        })
    return holders

async def resolve_token_account_owner(session, token_account):
    """Resolve a token account to its owner wallet."""
    result = await rpc_call(session, "getAccountInfo", [
        token_account,
        {"encoding": "jsonParsed"}
    ])
    if not result or not result.get("value"):
        return None
    try:
        parsed = result["value"]["data"]["parsed"]["info"]
        return parsed.get("owner")
    except (KeyError, TypeError):
        return None

async def get_signatures_for_address(session, address, limit=100):
    """Get recent transaction signatures for an address."""
    result = await rpc_call(session, "getSignaturesForAddress", [
        address,
        {"limit": limit}
    ])
    return result or []

async def get_transaction(session, signature):
    """Get full transaction details."""
    result = await rpc_call(session, "getTransaction", [
        signature,
        {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}
    ])
    return result

# ── Bundle Detection ────────────────────────────────────────────────────────
async def detect_bundles(session, mint, holder_wallets):
    """
    Detect bundled wallets by finding wallets that:
    1. Bought in the same slot/block
    2. Were funded by the same wallet
    3. Have correlated buy/sell timing
    """
    print("\n[BUNDLE DETECTION] Analyzing wallet buy patterns...")

    slot_groups = defaultdict(list)  # slot -> [wallets]
    wallet_first_tx = {}

    # Check early transactions for each holder
    for i, wallet in enumerate(holder_wallets[:30]):  # Top 30 holders
        if not wallet:
            continue
        sigs = await get_signatures_for_address(session, wallet, limit=5)
        if sigs:
            earliest = sigs[-1]  # Last in list = earliest
            slot = earliest.get("slot", 0)
            sig = earliest.get("signature", "")
            block_time = earliest.get("blockTime", 0)

            slot_groups[slot].append(wallet)
            wallet_first_tx[wallet] = {
                "slot": slot,
                "signature": sig,
                "time": datetime.fromtimestamp(block_time, tz=timezone.utc).isoformat() if block_time else "unknown"
            }

        # Rate limit
        if i % 5 == 4:
            await asyncio.sleep(0.5)

    # Identify bundles: wallets active in the same slot
    bundles = []
    bundle_id = 0
    for slot, wallets in slot_groups.items():
        if len(wallets) >= 2:
            bundles.append(BundleGroup(
                group_id=bundle_id,
                wallets=wallets,
                block_slot=slot,
            ))
            bundle_id += 1

    return bundles, wallet_first_tx

async def trace_funding_source(session, wallet, depth=2):
    """Trace where a wallet got its initial SOL funding from."""
    funding_chain = []
    current = wallet

    for _ in range(depth):
        sigs = await get_signatures_for_address(session, current, limit=10)
        if not sigs:
            break

        # Look at the earliest transaction
        earliest_sig = sigs[-1]["signature"]
        tx = await get_transaction(session, earliest_sig)
        if not tx or not tx.get("transaction"):
            break

        try:
            # Find SOL transfer TO this wallet
            meta = tx.get("meta", {})
            msg = tx["transaction"]["message"]

            # Check for system transfers
            instructions = msg.get("instructions", [])
            for ix in instructions:
                if isinstance(ix, dict):
                    program = ix.get("program", "")
                    parsed = ix.get("parsed", {})
                    if program == "system" and isinstance(parsed, dict):
                        ptype = parsed.get("type", "")
                        info = parsed.get("info", {})
                        if ptype in ("transfer", "createAccount"):
                            source = info.get("source", "")
                            dest = info.get("destination", info.get("newAccount", ""))
                            if dest == current and source != current:
                                funding_chain.append({
                                    "funder": source,
                                    "funded": current,
                                    "signature": earliest_sig,
                                    "slot": sigs[-1].get("slot", 0)
                                })
                                current = source
                                break
        except Exception:
            break

        await asyncio.sleep(0.3)

    return funding_chain

# ── LP Analysis ─────────────────────────────────────────────────────────────
async def analyze_lp_activity(session, pool_address):
    """Check for LP add/remove activity on PumpSwap pool."""
    print(f"\n[LP ANALYSIS] Checking pool: {pool_address[:16]}...")

    sigs = await get_signatures_for_address(session, pool_address, limit=100)
    if not sigs:
        return {"error": "Could not fetch pool transactions"}

    lp_events = []
    checked = 0

    for sig_info in sigs[:50]:  # Check last 50 txs
        sig = sig_info["signature"]
        block_time = sig_info.get("blockTime", 0)

        tx = await get_transaction(session, sig)
        if not tx:
            continue
        checked += 1

        try:
            meta = tx.get("meta", {})
            log_messages = meta.get("logMessages", [])

            # Look for LP-related program logs
            for log in log_messages:
                log_lower = log.lower()
                if any(kw in log_lower for kw in [
                    "addliquidity", "removeliquidity", "add_liquidity",
                    "remove_liquidity", "deposit", "withdraw",
                    "create_pool", "initialize"
                ]):
                    lp_events.append({
                        "signature": sig,
                        "time": datetime.fromtimestamp(block_time, tz=timezone.utc).isoformat() if block_time else "unknown",
                        "slot": sig_info.get("slot", 0),
                        "log_hint": log[:120],
                        "signer": tx["transaction"]["message"].get("accountKeys", [{}])[0].get("pubkey", "unknown") if isinstance(tx["transaction"]["message"].get("accountKeys", [{}])[0], dict) else "unknown"
                    })
                    break
        except Exception:
            pass

        if checked % 10 == 0:
            await asyncio.sleep(0.5)

    return {
        "pool": pool_address,
        "txs_checked": checked,
        "lp_events": lp_events
    }

# ── Main Analysis Pipeline ──────────────────────────────────────────────────
async def analyze_token(mint):
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║  PUMPFUN BUNDLE TRACKER & LP MANIPULATION DETECTOR          ║
║  Token: {mint[:20]}...{mint[-8:]:>8}  ║
╚══════════════════════════════════════════════════════════════╝
    """)

    async with aiohttp.ClientSession() as session:
        # ── Step 1: Token Overview ──
        print("[1/6] Fetching token info from DexScreener...")
        dex_data = await get_token_info(session, mint)

        if dex_data and dex_data.get("pairs"):
            for pair in dex_data["pairs"]:
                name = pair.get("baseToken", {}).get("name", "?")
                dex = pair.get("dexId", "?")
                price = pair.get("priceUsd", "?")
                mcap = pair.get("marketCap", pair.get("fdv", "?"))
                liq = pair.get("liquidity", {}).get("usd", "?")
                vol24 = pair.get("volume", {}).get("h24", "?")
                pool = pair.get("pairAddress", "?")

                print(f"\n  [{dex}] {name}")
                print(f"  Price: ${price} | MCap: ${mcap:,.0f}" if isinstance(mcap, (int, float)) else f"  Price: ${price} | MCap: {mcap}")
                print(f"  Liquidity: ${liq:,.2f}" if isinstance(liq, (int, float)) else f"  Liquidity: {liq}")
                print(f"  24h Volume: ${vol24:,.2f}" if isinstance(vol24, (int, float)) else f"  24h Volume: {vol24}")
                print(f"  Pool: {pool}")

                if isinstance(mcap, (int, float)) and isinstance(liq, (int, float)) and mcap > 0:
                    ratio = (liq / mcap) * 100
                    print(f"  ⚠ Liquidity/MCap Ratio: {ratio:.2f}%", end="")
                    if ratio < 2:
                        print(" ← EXTREMELY LOW (rug risk)")
                    elif ratio < 5:
                        print(" ← LOW")
                    else:
                        print(" ← OK")

        # ── Step 2: Rugcheck Report ──
        print("\n[2/6] Fetching rugcheck report...")
        rugcheck = await get_rugcheck_report(session, mint)

        creator = None
        if rugcheck:
            creator = rugcheck.get("creator", None)
            print(f"  Creator: {creator}")

            top_holders_data = rugcheck.get("topHolders", [])
            total_insider_pct = 0
            print(f"\n  Top Holders ({len(top_holders_data)} tracked):")
            for i, h in enumerate(top_holders_data[:15]):
                addr = h.get("owner", h.get("address", "?"))
                pct = h.get("pct", 0)
                insider = h.get("isInsider", False)
                total_insider_pct += pct if insider else 0
                marker = " ← INSIDER" if insider else ""
                print(f"    #{i+1:2d} {addr[:12]}...{addr[-6:]} — {pct:.2f}%{marker}")

            if total_insider_pct > 0:
                print(f"\n  ⚠ Total insider holdings: {total_insider_pct:.2f}%")

            risks = rugcheck.get("risks", [])
            if risks:
                print(f"\n  Risk Flags:")
                for r in risks:
                    print(f"    ⚠ {r.get('name', '?')}: {r.get('description', '')}")

        # ── Step 3: Get Top Holders (on-chain) ──
        print("\n[3/6] Fetching top holders from chain...")
        top_holders = await get_top_holders(session, mint)

        # Resolve token accounts to owner wallets
        holder_wallets = []
        print(f"  Resolving {min(len(top_holders), 20)} token accounts to owner wallets...")

        for i, h in enumerate(top_holders[:20]):
            token_acct = h["token_account"]
            owner = await resolve_token_account_owner(session, token_acct)
            holder_wallets.append(owner)
            amount = h["amount"]
            pct = (amount / 1_000_000_000) * 100 if amount else 0  # Assuming 1B supply

            if owner:
                is_creator = " ← CREATOR" if owner == creator else ""
                print(f"    #{i+1:2d} {owner[:12]}...{owner[-6:]} — {amount:>15,.2f} ({pct:.2f}%){is_creator}")

            if i % 5 == 4:
                await asyncio.sleep(0.5)

        # ── Step 4: Bundle Detection ──
        print("\n[4/6] Detecting bundled wallets...")
        bundles, wallet_first_tx = await detect_bundles(session, mint, holder_wallets)

        if bundles:
            print(f"\n  ⚠ FOUND {len(bundles)} BUNDLE GROUP(S):")
            for bg in bundles:
                print(f"\n  Bundle #{bg.group_id} (Slot: {bg.block_slot}):")
                for w in bg.wallets:
                    info = wallet_first_tx.get(w, {})
                    print(f"    → {w[:16]}... (first tx: {info.get('time', '?')})")
        else:
            print("  No obvious same-slot bundles found in top holders")
            print("  (Dev may have used aged wallets or delayed distribution)")

        # ── Step 5: Trace Funding Sources ──
        print("\n[5/6] Tracing funding sources for top holders...")
        funding_map = defaultdict(list)  # funder -> [funded wallets]

        for wallet in holder_wallets[:10]:
            if not wallet:
                continue
            chain = await trace_funding_source(session, wallet, depth=2)
            for link in chain:
                funder = link["funder"]
                funding_map[funder].append(link["funded"])
            await asyncio.sleep(0.3)

        # Find common funders (wallets that funded multiple holders)
        sus_funders = {k: v for k, v in funding_map.items() if len(v) >= 2}
        if sus_funders:
            print(f"\n  ⚠ SUSPICIOUS COMMON FUNDERS (funded multiple top holders):")
            for funder, funded_list in sus_funders.items():
                is_creator_tag = " ← CREATOR WALLET" if funder == creator else ""
                print(f"\n  Funder: {funder}{is_creator_tag}")
                for f in funded_list:
                    print(f"    → funded: {f[:16]}...")
        else:
            print("  No common funders found in top 10 holders")

        # ── Step 6: LP Activity ──
        print("\n[6/6] Analyzing LP activity on PumpSwap pool...")
        if dex_data and dex_data.get("pairs"):
            # Find PumpSwap pair
            pumpswap_pool = None
            for pair in dex_data["pairs"]:
                if pair.get("dexId") == "pumpswap":
                    pumpswap_pool = pair.get("pairAddress")
                    break

            if pumpswap_pool:
                lp_data = await analyze_lp_activity(session, pumpswap_pool)
                lp_events = lp_data.get("lp_events", [])

                if lp_events:
                    print(f"\n  ⚠ FOUND {len(lp_events)} LP EVENTS:")
                    for ev in lp_events[:20]:
                        print(f"    {ev['time']} | {ev['signer'][:16]}... | {ev['log_hint'][:80]}")
                        print(f"      tx: {ev['signature'][:32]}...")
                else:
                    print("  No obvious LP add/remove events in recent transactions")
                    print("  (LP manipulation may use indirect methods or wrapped calls)")
            else:
                print("  No PumpSwap pool found")

        # ── Summary ─────────────────────────────────────────────────────────
        print(f"""
╔══════════════════════════════════════════════════════════════╗
║  SUMMARY                                                     ║
╠══════════════════════════════════════════════════════════════╣
║  Token: {mint[:46]:46s}  ║
║  Creator: {(creator or 'unknown')[:44]:44s}  ║
║  Bundle Groups Found: {len(bundles):<33}  ║
║  Suspicious Funders: {len(sus_funders):<34}  ║
║  LP Events: {len(lp_data.get('lp_events', [])) if 'lp_data' in dir() else 0:<43}  ║
╚══════════════════════════════════════════════════════════════╝

KEY FINDINGS:
""")

        # Flag suspicious patterns
        findings = []
        if dex_data and dex_data.get("pairs"):
            for pair in dex_data["pairs"]:
                mcap = pair.get("marketCap", pair.get("fdv", 0))
                liq = pair.get("liquidity", {}).get("usd", 0)
                if isinstance(mcap, (int, float)) and isinstance(liq, (int, float)):
                    if mcap > 0 and (liq / mcap) < 0.02:
                        findings.append(f"CRITICAL: Liquidity/MCap ratio is {(liq/mcap)*100:.2f}% on {pair.get('dexId')} — extreme rug risk")

        if bundles:
            total_bundled = sum(len(b.wallets) for b in bundles)
            findings.append(f"BUNDLED: {total_bundled} wallets bought in same slots — coordinated launch")

        if sus_funders:
            findings.append(f"LINKED WALLETS: {len(sus_funders)} wallet(s) funded multiple top holders — likely same entity")

        prices = []
        if dex_data and dex_data.get("pairs"):
            for pair in dex_data["pairs"]:
                p = pair.get("priceUsd")
                if p:
                    prices.append(float(p))
        if len(prices) >= 2:
            ratio = max(prices) / min(prices) if min(prices) > 0 else 0
            if ratio > 10:
                findings.append(f"PRICE DISCREPANCY: {ratio:.0f}x difference between pools — possible arbitrage/manipulation")

        if not findings:
            findings.append("No critical flags detected (may need deeper analysis with Helius/Solscan API keys)")

        for i, f in enumerate(findings):
            print(f"  {i+1}. {f}")

        print(f"""
NEXT STEPS:
  1. Check creator wallet on Solscan: https://solscan.io/account/{creator}
  2. Check PumpSwap pool: https://solscan.io/account/{pumpswap_pool if 'pumpswap_pool' in dir() and pumpswap_pool else 'N/A'}
  3. Set HELIUS_API_KEY env var for deeper transaction parsing
  4. Monitor with: python {__file__} {mint} --watch
""")

        # Save report
        report = {
            "token": mint,
            "creator": creator,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "bundles": [{"group_id": b.group_id, "wallets": b.wallets, "slot": b.block_slot} for b in bundles],
            "suspicious_funders": {k: v for k, v in sus_funders.items()},
            "holder_wallets": [w for w in holder_wallets if w],
            "findings": findings
        }

        report_path = f"/Users/yungcortex/tools/reports/{mint[:16]}_report.json"
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"  Report saved: {report_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pumpfun_bundle_tracker.py <TOKEN_MINT>")
        print("Example: python pumpfun_bundle_tracker.py FqhdB5odSZzSbUBjyemZZn9rF86xmRtHksLZGQ4Cpump")
        sys.exit(1)

    mint = sys.argv[1]
    asyncio.run(analyze_token(mint))

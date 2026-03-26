#!/usr/bin/env python3
"""
PumpFun Forensic Audit Tool
============================
Deep-dive investigation of pump.fun tokens: wallet clustering,
funding source tracing, dev history, LP manipulation, and full
on-chain forensics using Helius enhanced transaction API.

Usage:
    export HELIUS_API_KEY=your_key
    python pumpfun_forensic_audit.py <TOKEN_MINT>
"""

import sys
import os
import json
import asyncio
import aiohttp
import time
from datetime import datetime, timezone, timedelta
from collections import defaultdict, Counter
from dataclasses import dataclass, field
from typing import Optional, Dict, List, Set, Tuple

# ── Config ──────────────────────────────────────────────────────────────────
HELIUS_KEY = os.getenv("HELIUS_API_KEY", "")
HELIUS_RPC = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_KEY}"
HELIUS_API = f"https://api.helius.xyz/v0"
DEXSCREENER_API = "https://api.dexscreener.com/latest/dex"
RUGCHECK_API = "https://api.rugcheck.xyz/v1"

SUPPLY_DECIMALS = 6
TOTAL_SUPPLY = 1_000_000_000  # 1B for pump.fun tokens

# ── Formatting ──────────────────────────────────────────────────────────────
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

def banner(text):
    w = 70
    print(f"\n{CYAN}{'═'*w}")
    print(f"  {BOLD}{text}{RESET}{CYAN}")
    print(f"{'═'*w}{RESET}")

def warn(text):
    print(f"  {YELLOW}⚠ {text}{RESET}")

def crit(text):
    print(f"  {RED}🚨 {text}{RESET}")

def info(text):
    print(f"  {DIM}{text}{RESET}")

def ok(text):
    print(f"  {GREEN}✓ {text}{RESET}")

def addr(a, n=8):
    if not a: return "unknown"
    return f"{a[:n]}...{a[-6:]}"

# ── API Layer ───────────────────────────────────────────────────────────────
class HeliusClient:
    def __init__(self, session):
        self.session = session
        self.calls = 0

    async def rpc(self, method, params=None):
        """Solana RPC via Helius."""
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
        for attempt in range(3):
            try:
                async with self.session.post(HELIUS_RPC, json=payload, timeout=20) as resp:
                    self.calls += 1
                    data = await resp.json()
                    if "error" in data:
                        return None
                    return data.get("result")
            except Exception:
                await asyncio.sleep(1)
        return None

    async def get_parsed_transactions(self, address, limit=100, before=None):
        """Get Helius enhanced/parsed transactions for an address."""
        url = f"{HELIUS_API}/addresses/{address}/transactions?api-key={HELIUS_KEY}"
        params = {"limit": limit}
        if before:
            params["before"] = before
        try:
            async with self.session.get(url, params=params, timeout=20) as resp:
                self.calls += 1
                if resp.status == 200:
                    return await resp.json()
                return []
        except Exception:
            return []

    async def get_all_transactions(self, address, max_txs=500):
        """Page through all transactions for an address."""
        all_txs = []
        before = None
        while len(all_txs) < max_txs:
            batch = await self.get_parsed_transactions(address, limit=100, before=before)
            if not batch:
                break
            all_txs.extend(batch)
            before = batch[-1].get("signature")
            if len(batch) < 100:
                break
            await asyncio.sleep(0.3)
        return all_txs

    async def get_token_largest_accounts(self, mint):
        """Get top token holders."""
        result = await self.rpc("getTokenLargestAccounts", [mint])
        if result and "value" in result:
            return result["value"]
        return []

    async def resolve_token_owner(self, token_account):
        """Resolve token account → owner wallet."""
        result = await self.rpc("getAccountInfo", [token_account, {"encoding": "jsonParsed"}])
        if not result or not result.get("value"):
            return None
        try:
            return result["value"]["data"]["parsed"]["info"]["owner"]
        except (KeyError, TypeError):
            return None

    async def get_token_accounts_by_owner(self, owner, mint):
        """Get token accounts for a wallet for a specific mint."""
        result = await self.rpc("getTokenAccountsByOwner", [
            owner,
            {"mint": mint},
            {"encoding": "jsonParsed"}
        ])
        if result and "value" in result:
            return result["value"]
        return []

    async def get_balance(self, address):
        """Get SOL balance."""
        result = await self.rpc("getBalance", [address])
        if result and "value" in result:
            return result["value"] / 1e9
        return 0

    async def get_signatures(self, address, limit=100, before=None):
        """Get raw signatures for address."""
        params = [address, {"limit": limit}]
        if before:
            params[1]["before"] = before
        result = await self.rpc("getSignaturesForAddress", params)
        return result or []


async def fetch_json(session, url, headers=None, params=None):
    for attempt in range(3):
        try:
            async with session.get(url, headers=headers, params=params, timeout=15) as resp:
                if resp.status == 200:
                    return await resp.json()
                if resp.status == 429:
                    await asyncio.sleep(2 ** attempt)
                    continue
        except Exception:
            await asyncio.sleep(1)
    return None


# ── Analysis Modules ────────────────────────────────────────────────────────

async def audit_token_overview(session, helius, mint):
    """Phase 1: Token overview from multiple sources."""
    banner("PHASE 1: TOKEN OVERVIEW")

    # DexScreener
    dex = await fetch_json(session, f"{DEXSCREENER_API}/tokens/{mint}")
    pairs = dex.get("pairs", []) if dex else []

    token_name = "Unknown"
    best_liq = 0
    pools = []

    for p in pairs:
        name = p.get("baseToken", {}).get("name", "?")
        p_liq = p.get("liquidity", {}).get("usd", 0) or 0
        if p_liq > best_liq:
            best_liq = p_liq
            token_name = name
        dex_id = p.get("dexId", "?")
        price = p.get("priceUsd", "0")
        mcap = p.get("marketCap", p.get("fdv", 0)) or 0
        liq = p.get("liquidity", {}).get("usd", 0) or 0
        vol = p.get("volume", {}).get("h24", 0) or 0
        pool_addr = p.get("pairAddress", "?")
        created = p.get("pairCreatedAt", 0)

        created_dt = datetime.fromtimestamp(created/1000, tz=timezone.utc).isoformat() if created else "?"

        txns = p.get("txns", {})
        buys_24h = txns.get("h24", {}).get("buys", 0)
        sells_24h = txns.get("h24", {}).get("sells", 0)

        ratio = (liq / mcap * 100) if mcap > 0 else 0

        pool_info = {
            "dex": dex_id, "pool": pool_addr, "price": float(price or 0),
            "mcap": mcap, "liquidity": liq, "volume": vol,
            "buys_24h": buys_24h, "sells_24h": sells_24h,
            "created": created_dt, "liq_ratio": ratio
        }
        pools.append(pool_info)

        print(f"\n  [{dex_id.upper()}] {name}")
        print(f"  Pool: {pool_addr}")
        print(f"  Price: ${price} | MCap: ${mcap:,.0f} | Liq: ${liq:,.2f}")
        print(f"  24h Vol: ${vol:,.2f} | Buys: {buys_24h} | Sells: {sells_24h}")
        print(f"  Created: {created_dt}")

        if ratio < 1:
            crit(f"Liq/MCap: {ratio:.2f}% — EXTREME RUG RISK")
        elif ratio < 3:
            warn(f"Liq/MCap: {ratio:.2f}% — LOW")
        else:
            ok(f"Liq/MCap: {ratio:.2f}%")

    # Price discrepancy check
    prices = [p["price"] for p in pools if p["price"] > 0]
    if len(prices) >= 2:
        ratio = max(prices) / min(prices)
        if ratio > 10:
            crit(f"PRICE DISCREPANCY: {ratio:,.0f}x across pools")

    # RugCheck
    rugcheck = await fetch_json(session, f"{RUGCHECK_API}/tokens/{mint}/report")
    creator = rugcheck.get("creator") if rugcheck else None
    top_holders_rc = rugcheck.get("topHolders", []) if rugcheck else []
    risks = rugcheck.get("risks", []) if rugcheck else []

    print(f"\n  Creator: {BOLD}{creator}{RESET}")

    if risks:
        for r in risks:
            warn(f"{r.get('name', '?')}: {r.get('description', '')}")

    return {
        "name": token_name, "mint": mint, "creator": creator,
        "pools": pools, "top_holders_rc": top_holders_rc, "risks": risks,
        "rugcheck": rugcheck
    }


async def audit_holders(helius, mint, overview):
    """Phase 2: Deep holder analysis — resolve all top holders."""
    banner("PHASE 2: HOLDER ANALYSIS & WALLET RESOLUTION")

    # Get on-chain top holders
    top_accounts = await helius.get_token_largest_accounts(mint)
    print(f"  Found {len(top_accounts)} token accounts on-chain")

    holders = []  # (owner_wallet, token_amount, pct)
    pool_addresses = {p["pool"] for p in overview["pools"]}

    for i, acct in enumerate(top_accounts[:25]):
        token_acct = acct.get("address", "")
        amount = float(acct.get("uiAmount", 0) or acct.get("amount", 0))
        if isinstance(amount, str):
            amount = int(amount) / (10 ** SUPPLY_DECIMALS)

        # Use uiAmount if available
        ui_amount = acct.get("uiAmount")
        if ui_amount is not None:
            amount = float(ui_amount)
        else:
            raw = int(acct.get("amount", "0"))
            decimals = int(acct.get("decimals", SUPPLY_DECIMALS))
            amount = raw / (10 ** decimals)

        owner = await helius.resolve_token_owner(token_acct)
        pct = (amount / TOTAL_SUPPLY) * 100

        tag = ""
        if owner == overview["creator"]:
            tag = f" {RED}← CREATOR{RESET}"
        elif owner in pool_addresses:
            tag = f" {CYAN}← POOL{RESET}"
        elif token_acct in pool_addresses:
            tag = f" {CYAN}← POOL{RESET}"

        holders.append({
            "owner": owner, "token_account": token_acct,
            "amount": amount, "pct": pct
        })

        print(f"  #{i+1:2d} {addr(owner, 12)} | {amount:>15,.2f} | {pct:.2f}%{tag}")

        if i % 5 == 4:
            await asyncio.sleep(0.3)

    # Concentration analysis
    non_pool = [h for h in holders if h["owner"] not in pool_addresses
                and h["token_account"] not in pool_addresses]
    top10_pct = sum(h["pct"] for h in non_pool[:10])
    top20_pct = sum(h["pct"] for h in non_pool[:20])

    print(f"\n  {BOLD}Concentration (excluding pools):{RESET}")
    print(f"  Top 10 holders: {top10_pct:.2f}%")
    print(f"  Top 20 holders: {top20_pct:.2f}%")

    # Check for suspiciously uniform holdings
    amounts = [h["pct"] for h in non_pool[:20] if h["pct"] > 0.5]
    if len(amounts) >= 5:
        avg = sum(amounts) / len(amounts)
        variance = sum((a - avg) ** 2 for a in amounts) / len(amounts)
        if variance < 0.01:
            crit(f"UNIFORM DISTRIBUTION: {len(amounts)} wallets each hold ~{avg:.2f}% (variance={variance:.4f})")
            crit("This is a textbook bundled distribution pattern")
        elif variance < 0.05:
            warn(f"Suspiciously similar holdings: {len(amounts)} wallets ~{avg:.2f}% each (var={variance:.4f})")

    return holders, non_pool


async def audit_wallet_funding(helius, holders, creator, mint):
    """Phase 3: Trace funding sources for all top holders."""
    banner("PHASE 3: FUNDING SOURCE ANALYSIS")
    print("  Tracing where each top holder got their initial SOL...\n")

    funding_map = {}  # wallet -> [funding sources]
    funder_to_funded = defaultdict(list)  # funder -> [wallets it funded]
    wallet_ages = {}  # wallet -> first seen timestamp

    wallets_to_check = [h["owner"] for h in holders[:20] if h["owner"]]

    for i, wallet in enumerate(wallets_to_check):
        txs = await helius.get_parsed_transactions(wallet, limit=50)
        if not txs:
            continue

        # Find the earliest transactions
        earliest = txs[-1] if txs else None
        if earliest:
            ts = earliest.get("timestamp", 0)
            wallet_ages[wallet] = datetime.fromtimestamp(ts, tz=timezone.utc) if ts else None

        # Look for SOL transfers INTO this wallet
        funding_sources = []
        for tx in reversed(txs[:20]):  # Check first 20 txs (reversed = chronological)
            native_transfers = tx.get("nativeTransfers", [])
            for nt in native_transfers:
                to_addr = nt.get("toUserAccount", "")
                from_addr = nt.get("fromUserAccount", "")
                amount_lamports = nt.get("amount", 0)
                amount_sol = amount_lamports / 1e9

                if to_addr == wallet and from_addr != wallet and amount_sol > 0.01:
                    funding_sources.append({
                        "from": from_addr,
                        "amount_sol": amount_sol,
                        "signature": tx.get("signature", ""),
                        "timestamp": tx.get("timestamp", 0)
                    })
                    funder_to_funded[from_addr].append(wallet)

            # Also check token transfers for this specific mint
            token_transfers = tx.get("tokenTransfers", [])
            for tt in token_transfers:
                if tt.get("mint") == mint:
                    from_wallet = tt.get("fromUserAccount", "")
                    to_wallet = tt.get("toUserAccount", "")
                    token_amount = tt.get("tokenAmount", 0)
                    if to_wallet == wallet and from_wallet != wallet:
                        funding_sources.append({
                            "from": from_wallet,
                            "amount_tokens": token_amount,
                            "type": "token_transfer",
                            "signature": tx.get("signature", ""),
                            "timestamp": tx.get("timestamp", 0)
                        })
                        funder_to_funded[from_wallet].append(wallet)

        funding_map[wallet] = funding_sources

        if funding_sources:
            primary = funding_sources[0]
            ts = datetime.fromtimestamp(primary["timestamp"], tz=timezone.utc).isoformat() if primary.get("timestamp") else "?"
            amt = primary.get("amount_sol", primary.get("amount_tokens", "?"))
            unit = "SOL" if "amount_sol" in primary else "tokens"
            is_creator = f" {RED}← CREATOR{RESET}" if primary["from"] == creator else ""
            print(f"  {addr(wallet, 12)} ← funded by {addr(primary['from'], 12)} ({amt:.4f} {unit}) at {ts}{is_creator}")

        if i % 3 == 2:
            await asyncio.sleep(0.3)

    # Identify common funders (wallets that funded 2+ holders)
    suspicious_funders = {k: list(set(v)) for k, v in funder_to_funded.items() if len(set(v)) >= 2}

    if suspicious_funders:
        print(f"\n  {RED}{BOLD}🚨 COMMON FUNDERS DETECTED:{RESET}")
        for funder, funded in sorted(suspicious_funders.items(), key=lambda x: -len(x[1])):
            creator_tag = f" {RED}(CREATOR){RESET}" if funder == creator else ""
            print(f"\n  {BOLD}{addr(funder, 16)}{RESET}{creator_tag} funded {len(funded)} top holders:")
            for f in funded:
                print(f"    → {addr(f, 16)}")

    # Wallet age analysis
    if wallet_ages:
        print(f"\n  {BOLD}Wallet Age Analysis:{RESET}")
        now = datetime.now(timezone.utc)
        for wallet, first_seen in sorted(wallet_ages.items(), key=lambda x: x[1] or now):
            if first_seen:
                age = now - first_seen
                age_str = f"{age.days}d" if age.days > 0 else f"{age.seconds//3600}h"
                fresh_tag = f" {RED}← FRESH WALLET{RESET}" if age.days < 7 else ""
                print(f"    {addr(wallet, 12)}: first seen {first_seen.strftime('%Y-%m-%d')} ({age_str} old){fresh_tag}")

    return funding_map, suspicious_funders, wallet_ages


async def audit_creator_history(helius, creator):
    """Phase 4: Full creator wallet audit — other tokens, profit extraction."""
    banner("PHASE 4: CREATOR WALLET DEEP DIVE")
    print(f"  Creator: {BOLD}{creator}{RESET}")

    # Get SOL balance
    balance = await helius.get_balance(creator)
    print(f"  Current SOL balance: {balance:.4f} SOL")

    # Get ALL creator transactions
    print("  Fetching full transaction history...")
    all_txs = await helius.get_all_transactions(creator, max_txs=500)
    print(f"  Found {len(all_txs)} transactions")

    if not all_txs:
        warn("No transactions found — creator may have been wiped")
        return {}

    # Analyze transaction types
    tx_types = Counter()
    tokens_created = []
    tokens_traded = defaultdict(lambda: {"buys": 0, "sells": 0, "buy_sol": 0, "sell_sol": 0})
    sol_flows = {"in": 0, "out": 0}
    interaction_programs = Counter()
    connected_wallets = set()

    for tx in all_txs:
        tx_type = tx.get("type", "UNKNOWN")
        tx_types[tx_type] += 1
        ts = tx.get("timestamp", 0)

        # Track programs interacted with
        for inst in tx.get("instructions", []):
            prog = inst.get("programId", "")
            if prog:
                interaction_programs[prog] += 1

        # Track native SOL flows
        for nt in tx.get("nativeTransfers", []):
            from_addr = nt.get("fromUserAccount", "")
            to_addr = nt.get("toUserAccount", "")
            amount = nt.get("amount", 0) / 1e9

            if from_addr == creator:
                sol_flows["out"] += amount
                connected_wallets.add(to_addr)
            elif to_addr == creator:
                sol_flows["in"] += amount
                connected_wallets.add(from_addr)

        # Track token activity
        for tt in tx.get("tokenTransfers", []):
            token_mint = tt.get("mint", "")
            from_wallet = tt.get("fromUserAccount", "")
            to_wallet = tt.get("toUserAccount", "")
            token_amount = tt.get("tokenAmount", 0)

            if from_wallet == creator:
                tokens_traded[token_mint]["sells"] += 1
            elif to_wallet == creator:
                tokens_traded[token_mint]["buys"] += 1

        # Check for token creation
        desc = tx.get("description", "").lower()
        if "create" in desc and "token" in desc:
            tokens_created.append({
                "signature": tx.get("signature", ""),
                "timestamp": ts,
                "description": tx.get("description", "")
            })

    # Print results
    print(f"\n  {BOLD}Transaction Type Breakdown:{RESET}")
    for tx_type, count in tx_types.most_common(15):
        print(f"    {tx_type:30s}: {count}")

    print(f"\n  {BOLD}SOL Flow Summary:{RESET}")
    print(f"    Total SOL received:  {sol_flows['in']:>12.4f} SOL")
    print(f"    Total SOL sent out:  {sol_flows['out']:>12.4f} SOL")
    print(f"    Net SOL flow:        {sol_flows['in'] - sol_flows['out']:>12.4f} SOL")

    if tokens_created:
        print(f"\n  {BOLD}Tokens Created by This Wallet:{RESET}")
        for tc in tokens_created:
            ts_str = datetime.fromtimestamp(tc["timestamp"], tz=timezone.utc).isoformat() if tc["timestamp"] else "?"
            print(f"    {ts_str}: {tc['description'][:80]}")
            print(f"      tx: {tc['signature'][:48]}...")

    # Show tokens this creator has traded
    active_tokens = {k: v for k, v in tokens_traded.items() if v["buys"] + v["sells"] >= 2}
    if active_tokens:
        print(f"\n  {BOLD}Tokens Actively Traded ({len(active_tokens)}):{RESET}")
        for token, stats in sorted(active_tokens.items(), key=lambda x: -(x[1]["buys"]+x[1]["sells"]))[:15]:
            print(f"    {addr(token, 16)} — buys: {stats['buys']}, sells: {stats['sells']}")

    # Connected wallets
    connected_wallets.discard(creator)
    connected_wallets.discard("")
    print(f"\n  {BOLD}Connected Wallets ({len(connected_wallets)} unique):{RESET}")
    for cw in list(connected_wallets)[:20]:
        print(f"    {addr(cw, 20)}")

    # Check for serial launcher pattern
    if len(tokens_created) > 1:
        crit(f"SERIAL LAUNCHER: Creator has launched {len(tokens_created)} tokens")

    # First and last activity
    if all_txs:
        first_ts = all_txs[-1].get("timestamp", 0)
        last_ts = all_txs[0].get("timestamp", 0)
        first_dt = datetime.fromtimestamp(first_ts, tz=timezone.utc) if first_ts else None
        last_dt = datetime.fromtimestamp(last_ts, tz=timezone.utc) if last_ts else None
        if first_dt and last_dt:
            age = last_dt - first_dt
            print(f"\n  Wallet active: {first_dt.strftime('%Y-%m-%d')} → {last_dt.strftime('%Y-%m-%d')} ({age.days} days)")

    return {
        "balance": balance, "tx_count": len(all_txs), "tx_types": dict(tx_types),
        "sol_flows": sol_flows, "tokens_created": tokens_created,
        "tokens_traded": len(active_tokens), "connected_wallets": list(connected_wallets)[:50]
    }


async def audit_bundle_detection(helius, mint, holders, creator):
    """Phase 5: Advanced bundle detection using Helius parsed txs."""
    banner("PHASE 5: BUNDLE DETECTION (HELIUS ENHANCED)")
    print("  Analyzing early token transactions to find bundled buys...\n")

    # Get early transactions for the token mint itself
    mint_txs = await helius.get_parsed_transactions(mint, limit=100)
    print(f"  Found {len(mint_txs)} transactions on the token mint")

    # Group by slot/block to find bundled operations
    slot_groups = defaultdict(list)  # slot -> [tx data]
    early_buyers = {}  # wallet -> first buy info

    for tx in mint_txs:
        slot = tx.get("slot", 0)
        sig = tx.get("signature", "")
        ts = tx.get("timestamp", 0)

        # Track which wallets appear in this tx
        wallets_in_tx = set()
        for tt in tx.get("tokenTransfers", []):
            if tt.get("mint") == mint:
                to_wallet = tt.get("toUserAccount", "")
                from_wallet = tt.get("fromUserAccount", "")
                amount = tt.get("tokenAmount", 0)

                if to_wallet and to_wallet not in early_buyers:
                    early_buyers[to_wallet] = {
                        "slot": slot, "timestamp": ts,
                        "amount": amount, "signature": sig,
                        "from": from_wallet
                    }
                wallets_in_tx.add(to_wallet)

        for nt in tx.get("nativeTransfers", []):
            wallets_in_tx.add(nt.get("fromUserAccount", ""))
            wallets_in_tx.add(nt.get("toUserAccount", ""))

        wallets_in_tx.discard("")
        wallets_in_tx.discard(None)

        slot_groups[slot].append({
            "signature": sig, "timestamp": ts,
            "wallets": wallets_in_tx, "type": tx.get("type", "?")
        })

    # Find slots with multiple transactions (bundled)
    bundle_slots = {s: txs for s, txs in slot_groups.items() if len(txs) >= 2}

    if bundle_slots:
        print(f"  {RED}{BOLD}🚨 FOUND {len(bundle_slots)} SLOTS WITH BUNDLED TRANSACTIONS:{RESET}")
        for slot, txs in sorted(bundle_slots.items()):
            ts = txs[0]["timestamp"]
            dt = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else "?"
            all_wallets = set()
            for t in txs:
                all_wallets.update(t["wallets"])
            print(f"\n  Slot {slot} ({dt}) — {len(txs)} txs, {len(all_wallets)} wallets:")
            for t in txs:
                print(f"    tx: {t['signature'][:32]}... [{t['type']}]")
            for w in list(all_wallets)[:10]:
                creator_tag = f" {RED}(CREATOR){RESET}" if w == creator else ""
                print(f"    wallet: {addr(w, 16)}{creator_tag}")
    else:
        info("No same-slot bundles found in recent token transactions")

    # Early buyer analysis
    if early_buyers:
        print(f"\n  {BOLD}Earliest Token Buyers ({len(early_buyers)}):{RESET}")
        sorted_buyers = sorted(early_buyers.items(), key=lambda x: x[1]["slot"])
        for wallet, buy_info in sorted_buyers[:20]:
            ts = datetime.fromtimestamp(buy_info["timestamp"], tz=timezone.utc).isoformat() if buy_info["timestamp"] else "?"
            creator_tag = f" {RED}← CREATOR{RESET}" if wallet == creator else ""
            from_tag = f" (from: {addr(buy_info['from'])})" if buy_info.get("from") else ""
            print(f"    {addr(wallet, 12)} | {buy_info['amount']:>15,.2f} tokens | slot {buy_info['slot']} | {ts}{creator_tag}{from_tag}")

        # Check if early buyers are current holders
        holder_wallets = {h["owner"] for h in holders if h["owner"]}
        early_still_holding = [w for w in list(early_buyers.keys())[:20] if w in holder_wallets]
        if early_still_holding:
            warn(f"{len(early_still_holding)} early buyers are still in top holders — they haven't sold yet (bag holding or waiting)")

    return {
        "bundle_slots": len(bundle_slots),
        "early_buyers": len(early_buyers),
        "earliest_buyers": {k: v for k, v in list(early_buyers.items())[:20]}
    }


async def audit_lp_manipulation(helius, overview):
    """Phase 6: LP event forensics on PumpSwap pool."""
    banner("PHASE 6: LP MANIPULATION FORENSICS")

    pumpswap_pool = None
    for p in overview["pools"]:
        if p["dex"] == "pumpswap":
            pumpswap_pool = p["pool"]
            break

    if not pumpswap_pool:
        warn("No PumpSwap pool found")
        return {}

    print(f"  PumpSwap pool: {pumpswap_pool}")
    print("  Fetching pool transaction history...\n")

    pool_txs = await helius.get_all_transactions(pumpswap_pool, max_txs=300)
    print(f"  Found {len(pool_txs)} pool transactions")

    # Categorize pool events
    lp_adds = []
    lp_removes = []
    swaps = []
    pool_creation = None

    for tx in pool_txs:
        tx_type = tx.get("type", "UNKNOWN")
        sig = tx.get("signature", "")
        ts = tx.get("timestamp", 0)
        desc = tx.get("description", "").lower()

        # Check for LP events in instructions
        events = tx.get("events", {})
        instructions = tx.get("instructions", [])

        # Parse native transfers to detect liquidity adds/removes
        native_in = 0
        native_out = 0
        for nt in tx.get("nativeTransfers", []):
            if nt.get("toUserAccount") == pumpswap_pool:
                native_in += nt.get("amount", 0) / 1e9
            elif nt.get("fromUserAccount") == pumpswap_pool:
                native_out += nt.get("amount", 0) / 1e9

        # Heuristic: large SOL movements to/from pool = LP events
        signer = tx.get("feePayer", "?")

        if "create" in desc or "initialize" in desc:
            pool_creation = {
                "signature": sig, "timestamp": ts, "signer": signer,
                "description": tx.get("description", "")
            }
        elif native_in > 1.0 and native_out < 0.1:
            lp_adds.append({
                "signature": sig, "timestamp": ts, "signer": signer,
                "sol_added": native_in, "type": tx_type
            })
        elif native_out > 1.0 and native_in < 0.1:
            lp_removes.append({
                "signature": sig, "timestamp": ts, "signer": signer,
                "sol_removed": native_out, "type": tx_type
            })
        else:
            swaps.append({
                "signature": sig, "timestamp": ts, "signer": signer,
                "sol_in": native_in, "sol_out": native_out, "type": tx_type
            })

    # Print pool creation
    if pool_creation:
        ts_str = datetime.fromtimestamp(pool_creation["timestamp"], tz=timezone.utc).isoformat() if pool_creation["timestamp"] else "?"
        print(f"\n  {BOLD}Pool Creation:{RESET}")
        print(f"    Created by: {pool_creation['signer']}")
        print(f"    Time: {ts_str}")
        print(f"    tx: {pool_creation['signature'][:48]}...")

    # LP adds
    if lp_adds:
        total_added = sum(e["sol_added"] for e in lp_adds)
        print(f"\n  {BOLD}LP Additions ({len(lp_adds)} events, {total_added:.2f} SOL total):{RESET}")
        for ev in lp_adds[:15]:
            ts_str = datetime.fromtimestamp(ev["timestamp"], tz=timezone.utc).strftime("%m-%d %H:%M") if ev["timestamp"] else "?"
            creator_tag = f" {RED}← CREATOR{RESET}" if ev["signer"] == overview["creator"] else ""
            print(f"    {ts_str} | {addr(ev['signer'], 12)} | +{ev['sol_added']:.4f} SOL{creator_tag}")
    else:
        info("No LP additions detected")

    # LP removes — this is the suspicious activity
    if lp_removes:
        total_removed = sum(e["sol_removed"] for e in lp_removes)
        crit(f"LP REMOVALS DETECTED ({len(lp_removes)} events, {total_removed:.2f} SOL total):")
        for ev in lp_removes[:15]:
            ts_str = datetime.fromtimestamp(ev["timestamp"], tz=timezone.utc).strftime("%m-%d %H:%M") if ev["timestamp"] else "?"
            creator_tag = f" {RED}← CREATOR{RESET}" if ev["signer"] == overview["creator"] else ""
            print(f"    {ts_str} | {addr(ev['signer'], 12)} | -{ev['sol_removed']:.4f} SOL{creator_tag}")

        # Check if LP remover is creator or connected
        removers = set(e["signer"] for e in lp_removes)
        if overview["creator"] in removers:
            crit("CREATOR IS REMOVING LIQUIDITY")
    else:
        ok("No LP removals detected")

    # Swap volume analysis
    print(f"\n  {BOLD}Swap Activity: {len(swaps)} swaps{RESET}")
    if swaps:
        # Check for wash trading (same wallet buying and selling repeatedly)
        swap_wallets = Counter(s["signer"] for s in swaps)
        heavy_traders = {w: c for w, c in swap_wallets.items() if c >= 10}
        if heavy_traders:
            warn(f"Heavy traders (10+ swaps) — possible wash trading:")
            for w, c in sorted(heavy_traders.items(), key=lambda x: -x[1])[:10]:
                creator_tag = " (CREATOR)" if w == overview["creator"] else ""
                print(f"      {addr(w, 16)}: {c} swaps{creator_tag}")

    return {
        "pool_creation": pool_creation,
        "lp_adds": len(lp_adds),
        "lp_removes": len(lp_removes),
        "total_sol_added": sum(e["sol_added"] for e in lp_adds),
        "total_sol_removed": sum(e["sol_removed"] for e in lp_removes),
        "total_swaps": len(swaps),
        "lp_remove_details": lp_removes[:20],
        "lp_add_details": lp_adds[:20]
    }


async def audit_wallet_cluster(helius, holders, suspicious_funders, creator):
    """Phase 7: Build wallet cluster graph."""
    banner("PHASE 7: WALLET CLUSTER ANALYSIS")
    print("  Building connection graph between holder wallets...\n")

    # Union-Find for clustering
    parent = {}

    def find(x):
        if x not in parent:
            parent[x] = x
        if parent[x] != x:
            parent[x] = find(parent[x])
        return parent[x]

    def union(x, y):
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py

    # Connect wallets via common funders
    for funder, funded_wallets in suspicious_funders.items():
        for i in range(len(funded_wallets)):
            for j in range(i + 1, len(funded_wallets)):
                union(funded_wallets[i], funded_wallets[j])

    # Also connect via creator
    holder_wallets = [h["owner"] for h in holders if h["owner"]]
    for wallet in holder_wallets:
        # Check if creator funded this wallet (from Phase 3 data)
        if creator in suspicious_funders:
            if wallet in suspicious_funders[creator]:
                union(wallet, creator)

    # Build clusters
    clusters = defaultdict(set)
    for wallet in holder_wallets:
        if wallet in parent:
            root = find(wallet)
            clusters[root].add(wallet)

    # Also add non-parent wallets
    significant_clusters = {k: v for k, v in clusters.items() if len(v) >= 2}

    if significant_clusters:
        print(f"  {RED}{BOLD}🚨 FOUND {len(significant_clusters)} WALLET CLUSTER(S):{RESET}")
        for root, members in significant_clusters.items():
            total_pct = sum(h["pct"] for h in holders if h["owner"] in members)
            print(f"\n  Cluster (root: {addr(root)}) — {len(members)} wallets, {total_pct:.2f}% supply:")
            for m in members:
                h_info = next((h for h in holders if h["owner"] == m), None)
                pct_str = f"{h_info['pct']:.2f}%" if h_info else "?"
                creator_tag = " (CREATOR)" if m == creator else ""
                print(f"    → {addr(m, 20)} [{pct_str}]{creator_tag}")

            if total_pct > 5:
                crit(f"This cluster controls {total_pct:.2f}% of supply — SIGNIFICANT RISK")
    else:
        info("No multi-wallet clusters found through funding analysis")
        info("(Dev may have used CEX or mixer for wallet funding)")

    # Cross-check: wallets with similar balance amounts
    print(f"\n  {BOLD}Balance Pattern Analysis:{RESET}")
    pct_groups = defaultdict(list)
    for h in holders:
        if h["owner"] and h["pct"] > 0.3:
            # Round to 0.1% bucket
            bucket = round(h["pct"], 1)
            pct_groups[bucket].append(h)

    for bucket, group in sorted(pct_groups.items(), key=lambda x: -len(x[1])):
        if len(group) >= 3:
            wallets_str = ", ".join(addr(h["owner"]) for h in group[:5])
            warn(f"{len(group)} wallets each hold ~{bucket}%: {wallets_str}")

    return significant_clusters


async def generate_final_report(mint, overview, holders, funding, suspicious_funders,
                                 wallet_ages, creator_data, bundle_data, lp_data, clusters):
    """Generate comprehensive audit report."""
    banner("FINAL AUDIT REPORT")

    creator = overview["creator"]
    findings = []
    severity_scores = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}

    # F1: Liquidity/MCap ratio — only flag the main pool as CRITICAL
    # Sort pools by liquidity descending
    sorted_pools = sorted(overview["pools"], key=lambda x: x.get("liquidity", 0), reverse=True)
    main_pool = sorted_pools[0] if sorted_pools else None

    if main_pool and main_pool["liq_ratio"] < 1 and main_pool["liquidity"] > 0:
        findings.append(("CRITICAL", f"Main pool ({main_pool['dex']}) Liq/MCap {main_pool['liq_ratio']:.2f}% — rug-pullable with ~${main_pool['liquidity']/2:,.0f}"))
        severity_scores["CRITICAL"] += 1
    elif main_pool and main_pool["liq_ratio"] < 5 and main_pool["liquidity"] > 0:
        findings.append(("HIGH", f"Main pool ({main_pool['dex']}) Liq/MCap {main_pool['liq_ratio']:.2f}% — low liquidity"))
        severity_scores["HIGH"] += 1

    # Count how many secondary pools have dangerously low liquidity
    low_liq_pools = [p for p in sorted_pools[1:] if p.get("liquidity", 0) < 1000 and p.get("liquidity", 0) > 0]
    if len(low_liq_pools) >= 3:
        findings.append(("MEDIUM", f"{len(low_liq_pools)} secondary pools with <$1K liquidity"))
        severity_scores["MEDIUM"] += 1

    # F2: Price discrepancy
    prices = [p["price"] for p in overview["pools"] if p["price"] > 0]
    if len(prices) >= 2:
        ratio = max(prices) / min(prices)
        if ratio > 100:
            findings.append(("CRITICAL", f"{ratio:,.0f}x price discrepancy across pools"))
            severity_scores["CRITICAL"] += 1

    # F3: Holder concentration
    non_pool = [h for h in holders if h.get("owner") and h["owner"] not in {p["pool"] for p in overview["pools"]}]
    amounts = [h["pct"] for h in non_pool[:20] if h["pct"] > 0.5]
    if len(amounts) >= 5:
        avg = sum(amounts) / len(amounts)
        variance = sum((a - avg) ** 2 for a in amounts) / len(amounts)
        if variance < 0.05:
            findings.append(("CRITICAL", f"{len(amounts)} wallets hold identical ~{avg:.2f}% each — bundled distribution"))
            severity_scores["CRITICAL"] += 1

    # F4: Common funders
    if suspicious_funders:
        for funder, funded in suspicious_funders.items():
            tag = "(CREATOR)" if funder == creator else ""
            findings.append(("HIGH", f"Wallet {addr(funder)} {tag} funded {len(funded)} top holders"))
            severity_scores["HIGH"] += 1

    # F5: Fresh wallets
    if wallet_ages:
        fresh = [w for w, dt in wallet_ages.items() if dt and (datetime.now(timezone.utc) - dt).days < 7]
        if len(fresh) >= 3:
            findings.append(("HIGH", f"{len(fresh)} top holder wallets created within 7 days — likely sybils"))
            severity_scores["HIGH"] += 1

    # F6: Creator activity
    if creator_data:
        if creator_data.get("tokens_created") and len(creator_data["tokens_created"]) > 1:
            findings.append(("HIGH", f"Creator has launched {len(creator_data['tokens_created'])} tokens — serial launcher"))
            severity_scores["HIGH"] += 1

        net_sol = creator_data.get("sol_flows", {}).get("in", 0) - creator_data.get("sol_flows", {}).get("out", 0)
        if net_sol > 10:
            findings.append(("MEDIUM", f"Creator netted {net_sol:.2f} SOL profit"))
            severity_scores["MEDIUM"] += 1

    # F7: Bundles
    if bundle_data.get("bundle_slots", 0) > 0:
        findings.append(("CRITICAL", f"{bundle_data['bundle_slots']} bundled transaction slots detected"))
        severity_scores["CRITICAL"] += 1

    # F8: LP manipulation
    if lp_data.get("lp_removes", 0) > 0:
        findings.append(("CRITICAL", f"LP removal detected: {lp_data['total_sol_removed']:.2f} SOL removed from pool"))
        severity_scores["CRITICAL"] += 1

    if lp_data.get("lp_adds", 0) > 0 and lp_data.get("lp_removes", 0) > 0:
        findings.append(("HIGH", "LP add/remove pattern — possible LP manipulation cycle"))
        severity_scores["HIGH"] += 1

    # F9: Clusters
    if clusters:
        for root, members in clusters.items():
            total_pct = sum(h["pct"] for h in holders if h["owner"] in members)
            if total_pct > 5:
                findings.append(("CRITICAL", f"Wallet cluster ({len(members)} wallets) controls {total_pct:.2f}% of supply"))
                severity_scores["CRITICAL"] += 1

    # F10: Low holders
    for r in overview.get("risks", []):
        if "holder" in r.get("name", "").lower():
            findings.append(("MEDIUM", r.get("description", "Low holder count")))
            severity_scores["MEDIUM"] += 1

    # Calculate risk score
    # Weighted scoring — diminishing returns for multiple findings of same severity
    crit = severity_scores["CRITICAL"]
    high = severity_scores["HIGH"]
    med = severity_scores["MEDIUM"]

    # First CRITICAL = 25, second = 20, third = 15, rest = 5 each
    crit_score = min(crit, 1) * 25 + min(max(crit - 1, 0), 1) * 20 + min(max(crit - 2, 0), 1) * 15 + max(crit - 3, 0) * 5
    high_score = min(high, 2) * 10 + max(high - 2, 0) * 3
    med_score = med * 3

    risk_score = min(crit_score + high_score + med_score, 100)

    if risk_score >= 70:
        risk_label = f"{RED}EXTREME RISK — DO NOT TRADE{RESET}"
    elif risk_score >= 40:
        risk_label = f"{YELLOW}HIGH RISK{RESET}"
    elif risk_score >= 20:
        risk_label = f"{YELLOW}MODERATE RISK{RESET}"
    else:
        risk_label = f"{GREEN}LOW RISK{RESET}"

    # Print
    print(f"""
  {BOLD}Token:{RESET} {overview['name']} ({mint})
  {BOLD}Creator:{RESET} {creator}
  {BOLD}Risk Score:{RESET} {risk_score}/100 — {risk_label}

  {BOLD}Severity Breakdown:{RESET}
    CRITICAL: {severity_scores['CRITICAL']}
    HIGH:     {severity_scores['HIGH']}
    MEDIUM:   {severity_scores['MEDIUM']}
    LOW:      {severity_scores['LOW']}

  {BOLD}All Findings:{RESET}
""")

    for i, (sev, desc) in enumerate(findings):
        if sev == "CRITICAL":
            print(f"  {RED}[{sev}]{RESET} {desc}")
        elif sev == "HIGH":
            print(f"  {YELLOW}[{sev}]{RESET}     {desc}")
        else:
            print(f"  {DIM}[{sev}]{RESET}   {desc}")

    # Verdict
    print(f"\n  {'─'*60}")
    if risk_score >= 70:
        print(f"""
  {RED}{BOLD}VERDICT: THIS TOKEN IS ALMOST CERTAINLY A COORDINATED SCHEME{RESET}
  {RED}The combination of bundled wallets, LP manipulation potential,{RESET}
  {RED}extreme liquidity/mcap imbalance, and uniform holder distribution{RESET}
  {RED}strongly indicates this is orchestrated by the dev/team.{RESET}
""")
    elif risk_score >= 40:
        print(f"\n  {YELLOW}VERDICT: HIGH RISK — Significant red flags. Proceed with extreme caution.{RESET}\n")
    else:
        print(f"\n  {GREEN}VERDICT: Moderate risk — Some concerns but not definitive manipulation.{RESET}\n")

    # Save full report
    report = {
        "token": mint,
        "name": overview["name"],
        "creator": creator,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "risk_score": risk_score,
        "severity_counts": severity_scores,
        "findings": [{"severity": s, "description": d} for s, d in findings],
        "pools": overview["pools"],
        "holder_count": len(holders),
        "top_holder_concentration": sum(h["pct"] for h in non_pool[:10]),
        "suspicious_funders": {k: v for k, v in suspicious_funders.items()},
        "wallet_clusters": {k: list(v) for k, v in clusters.items()} if clusters else {},
        "creator_data": {k: v for k, v in creator_data.items() if k != "connected_wallets"} if creator_data else {},
        "bundle_data": bundle_data,
        "lp_data": {k: v for k, v in lp_data.items() if k not in ("lp_add_details", "lp_remove_details")} if lp_data else {},
        "links": {
            "creator_solscan": f"https://solscan.io/account/{creator}",
            "token_solscan": f"https://solscan.io/token/{mint}",
            "token_birdeye": f"https://birdeye.so/token/{mint}?chain=solana",
            "rugcheck": f"https://rugcheck.xyz/tokens/{mint}",
        }
    }

    # Use AUDIT_OUTPUT_DIR env var if set, otherwise default
    output_dir = os.getenv("AUDIT_OUTPUT_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "reports"))
    if not os.path.exists(output_dir):
        output_dir = os.path.join(os.getcwd(), "data", "reports")
    report_path = os.path.join(output_dir, f"{mint[:16]}_FULL_AUDIT.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"  Full report saved: {report_path}")

    return report


# ── Main ────────────────────────────────────────────────────────────────────
async def main(mint):
    if not HELIUS_KEY:
        print(f"{RED}ERROR: Set HELIUS_API_KEY environment variable{RESET}")
        sys.exit(1)

    print(f"""
{CYAN}╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   PUMPFUN FORENSIC AUDIT TOOL v2.0                                   ║
║   Deep-dive on-chain investigation                                   ║
║                                                                      ║
║   Token: {mint[:48]:48s}   ║
║   Time:  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'):48s}   ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝{RESET}
""")

    async with aiohttp.ClientSession() as session:
        helius = HeliusClient(session)

        # Phase 1: Overview
        overview = await audit_token_overview(session, helius, mint)
        if not overview:
            print("Failed to fetch token data")
            return

        creator = overview["creator"]
        if not creator:
            warn("Could not identify creator wallet")

        # Phase 2: Holders
        holders, non_pool = await audit_holders(helius, mint, overview)

        # Phase 3: Funding
        funding_map, suspicious_funders, wallet_ages = await audit_wallet_funding(
            helius, non_pool, creator, mint
        )

        # Phase 4: Creator history
        creator_data = {}
        if creator:
            creator_data = await audit_creator_history(helius, creator)

        # Phase 5: Bundles
        bundle_data = await audit_bundle_detection(helius, mint, holders, creator)

        # Phase 6: LP
        lp_data = await audit_lp_manipulation(helius, overview)

        # Phase 7: Clusters
        clusters = await audit_wallet_cluster(helius, holders, suspicious_funders, creator)

        # Final Report
        report = await generate_final_report(
            mint, overview, holders, funding_map, suspicious_funders,
            wallet_ages, creator_data, bundle_data, lp_data, clusters
        )

        print(f"\n  {DIM}Helius API calls made: {helius.calls}{RESET}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pumpfun_forensic_audit.py <TOKEN_MINT>")
        sys.exit(1)

    asyncio.run(main(sys.argv[1]))

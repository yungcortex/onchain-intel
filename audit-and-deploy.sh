#!/bin/bash
# Audit a token and deploy the results to the live site
# Usage: ./audit-and-deploy.sh <TOKEN_MINT>

set -e

MINT=$1
if [ -z "$MINT" ]; then
  echo "Usage: ./audit-and-deploy.sh <TOKEN_MINT>"
  exit 1
fi

echo "══════════════════════════════════════════"
echo "  OnChain Intel — Audit & Deploy"
echo "  Token: ${MINT:0:20}..."
echo "══════════════════════════════════════════"

# Step 1: Run the forensic audit
echo ""
echo "[1/4] Running forensic audit..."
HELIUS_API_KEY="${HELIUS_API_KEY:-a703f342-3bce-4bba-bb06-50c42c12a232}" \
  python3 ~/tools/pumpfun_forensic_audit.py "$MINT"

# Step 2: Find the report
REPORT=$(ls -t ~/tools/reports/${MINT:0:16}_FULL_AUDIT.json 2>/dev/null | head -1)
if [ -z "$REPORT" ]; then
  echo "ERROR: Audit report not found"
  exit 1
fi
echo ""
echo "[2/4] Report found: $REPORT"

# Step 3: Copy to public data + ingest into local DB
echo ""
echo "[3/4] Ingesting into database..."
SLUG=$(python3 -c "import json; d=json.load(open('$REPORT')); print(d.get('name','unknown').lower().replace(' ','-'))")
cp "$REPORT" ~/chainscope/public/data/${SLUG}.json

# Run the ingest via Node
cd ~/chainscope
node --input-type=module -e "
import { readFileSync } from 'fs';
import { ingestAuditReport } from './server/ingest.js';
const report = JSON.parse(readFileSync('$REPORT', 'utf-8'));
const result = ingestAuditReport(report);
console.log('Ingested:', result.name, '- Risk:', result.riskScore);
"

# Step 4: Build and deploy
echo ""
echo "[4/4] Building and deploying..."
cd ~/chainscope
npm run build
npx gh-pages -d dist --nojekyll -m "Add audit: $SLUG"
git add -A
git commit -m "Add audit: $SLUG" --allow-empty
git push

echo ""
echo "══════════════════════════════════════════"
echo "  DONE! Audit live at:"
echo "  https://yungcortex.github.io/onchain-intel/#/token/$MINT"
echo "══════════════════════════════════════════"

import { spawn } from 'child_process';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPORTS_DIR = join(__dirname, '..', 'data', 'reports');
const TOOL_PATHS = [
  join(__dirname, '..', 'tools', 'pumpfun_forensic_audit.py'),
  join(process.env.HOME || '/root', 'tools', 'pumpfun_forensic_audit.py'),
];

// Ensure reports dir exists
await mkdir(REPORTS_DIR, { recursive: true });

function getToolPath() {
  for (const p of TOOL_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

function getReportPath(mint) {
  return join(REPORTS_DIR, `${mint.slice(0, 16)}_FULL_AUDIT.json`);
}

/**
 * Run a forensic audit on a Solana token mint.
 */
export async function runForensicAudit(mint) {
  // Check cache first
  const cached = await loadCachedAudit(mint);
  if (cached) return cached;

  const toolPath = getToolPath();
  if (!toolPath) {
    throw new Error('Python forensic tool not found');
  }

  const heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey) {
    throw new Error('HELIUS_API_KEY not set — cannot run audit');
  }

  console.log(`[AUDIT] Starting audit for ${mint.slice(0, 16)}...`);
  console.log(`[AUDIT] Tool: ${toolPath}`);
  console.log(`[AUDIT] Reports dir: ${REPORTS_DIR}`);
  console.log(`[AUDIT] Helius key: ${heliusKey.slice(0, 8)}...`);

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [toolPath, mint], {
      env: {
        ...process.env,
        HELIUS_API_KEY: heliusKey,
        AUDIT_OUTPUT_DIR: REPORTS_DIR,
        HOME: process.env.HOME || '/root',
      },
      timeout: 240_000, // 4 min max
      cwd: join(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      const line = d.toString();
      stdout += line;
      // Log progress lines
      if (line.includes('[') || line.includes('Phase') || line.includes('Found')) {
        console.log(`[AUDIT] ${line.trim().slice(0, 120)}`);
      }
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', async (code) => {
      console.log(`[AUDIT] Process exited with code ${code}`);

      if (code !== 0) {
        console.error(`[AUDIT] FAILED: ${stderr.slice(-300)}`);
        return reject(new Error(`Audit failed (exit ${code}): ${stderr.slice(-300)}`));
      }

      // Find the report — check multiple locations
      const searchPaths = [
        getReportPath(mint),
        join(process.env.HOME || '/root', 'tools', 'reports', `${mint.slice(0, 16)}_FULL_AUDIT.json`),
        join('/tmp', `${mint.slice(0, 16)}_FULL_AUDIT.json`),
      ];

      for (const p of searchPaths) {
        if (existsSync(p)) {
          console.log(`[AUDIT] Report found: ${p}`);
          const raw = await readFile(p, 'utf-8');
          const report = JSON.parse(raw);

          // Also save a copy to our reports dir
          const ourPath = getReportPath(mint);
          await writeFile(ourPath, raw);

          return resolve(report);
        }
      }

      // Try to find it by scanning
      console.error(`[AUDIT] Report not found in any expected path`);
      console.error(`[AUDIT] stdout tail: ${stdout.slice(-200)}`);
      reject(new Error('Audit completed but report file not found'));
    });

    proc.on('error', (err) => {
      console.error(`[AUDIT] Spawn error: ${err.message}`);
      reject(new Error(`Failed to start audit: ${err.message}`));
    });
  });
}

/**
 * Check if a cached audit exists.
 */
export async function loadCachedAudit(mint) {
  const paths = [
    getReportPath(mint),
    join(__dirname, '..', 'public', 'data', 'trumpchud.json'), // only for TrumpChud
  ];

  for (const p of paths) {
    try {
      if (existsSync(p)) {
        const raw = await readFile(p, 'utf-8');
        const data = JSON.parse(raw);
        // Only return if this is actually the right token
        if (data.token === mint) {
          return data;
        }
      }
    } catch {}
  }
  return null;
}

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOOL_PATH = join(__dirname, '..', 'tools', 'pumpfun_forensic_audit.py');
const REPORTS_DIR = process.env.AUDIT_OUTPUT_DIR || join(__dirname, '..', 'data', 'reports');

/**
 * Run a forensic audit on a Solana token mint.
 * Spawns the Python forensic tool and returns parsed JSON.
 */
export async function runForensicAudit(mint) {
  // Check if we already have a cached report < 24h old
  const reportPath = getReportPath(mint);
  if (existsSync(reportPath)) {
    const raw = await readFile(reportPath, 'utf-8');
    return JSON.parse(raw);
  }

  // Check Python tool exists
  // Try local tools/ first, then fall back to ~/tools/
  let toolPath = TOOL_PATH;
  if (!existsSync(toolPath)) {
    toolPath = join(process.env.HOME, 'tools', 'pumpfun_forensic_audit.py');
  }
  if (!existsSync(toolPath)) {
    throw new Error('Forensic audit tool not found. Expected at: ' + TOOL_PATH);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [toolPath, mint], {
      env: {
        ...process.env,
        HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
        AUDIT_OUTPUT_DIR: REPORTS_DIR,
      },
      timeout: 180_000, // 3 min max
    });

    let stderr = '';
    proc.stdout.on('data', () => {}); // drain stdout
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        return reject(new Error(`Audit failed (exit ${code}): ${stderr.slice(-500)}`));
      }

      try {
        // The Python tool writes to ~/tools/reports/{mint[:16]}_FULL_AUDIT.json
        // Check multiple possible paths
        const paths = [
          reportPath,
          join(process.env.HOME, 'tools', 'reports', `${mint.slice(0, 16)}_FULL_AUDIT.json`),
        ];

        for (const p of paths) {
          if (existsSync(p)) {
            const raw = await readFile(p, 'utf-8');
            return resolve(JSON.parse(raw));
          }
        }

        reject(new Error('Audit completed but report file not found'));
      } catch (err) {
        reject(new Error(`Failed to read audit report: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn audit process: ${err.message}`));
    });
  });
}

function getReportPath(mint) {
  return join(REPORTS_DIR, `${mint.slice(0, 16)}_FULL_AUDIT.json`);
}

/**
 * Check if a cached audit exists for this mint.
 */
export function hasCachedAudit(mint) {
  const reportPath = getReportPath(mint);
  return existsSync(reportPath);
}

/**
 * Load a cached audit report.
 */
export async function loadCachedAudit(mint) {
  const reportPath = getReportPath(mint);
  if (!existsSync(reportPath)) {
    // Try home dir
    const homePath = join(process.env.HOME, 'tools', 'reports', `${mint.slice(0, 16)}_FULL_AUDIT.json`);
    if (existsSync(homePath)) {
      const raw = await readFile(homePath, 'utf-8');
      return JSON.parse(raw);
    }
    return null;
  }
  const raw = await readFile(reportPath, 'utf-8');
  return JSON.parse(raw);
}

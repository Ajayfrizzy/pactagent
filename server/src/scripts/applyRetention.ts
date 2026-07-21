import { prisma } from '../db';
import { runRetention } from '../services/retentionService';

function numberOption(name: string, fallback: number, min: number, max: number) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return parsed;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const batchSize = numberOption('batch-size', 500, 1, 5000);
  const maxBatches = numberOption('max-batches', 10, 1, 1000);
  const startedAt = new Date();
  const results = await runRetention({ dryRun, batchSize, maxBatches });
  process.stdout.write(`${JSON.stringify({ dryRun, batchSize, maxBatches, startedAt, completedAt: new Date(), results })}\n`);
  if (results.some((result) => result.truncated)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

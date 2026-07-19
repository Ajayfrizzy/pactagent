import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

const configSource = readFileSync('server/src/config.ts', 'utf8');
const allSource = sourceFiles('server/src').map((path) => readFileSync(path, 'utf8')).join('\n');
const examplePath = 'server/.env.example';
const example = readFileSync(examplePath, 'utf8');
const referenced = new Set(
  [...allSource.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]+)|\[['"]([A-Z][A-Z0-9_]+)['"]\])/g)]
    .map((match) => match[1] || match[2]),
);
for (const match of configSource.matchAll(/^  ([A-Z][A-Z0-9_]+):/gm)) referenced.add(match[1]);
for (const match of configSource.matchAll(/secretValue\(['"]([A-Z][A-Z0-9_]+)['"]\)/g)) {
  referenced.add(match[1]);
  referenced.add(`${match[1]}_FILE`);
}
const declared = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
const missing = [...referenced].filter((name) => !declared.has(name)).sort();

if (process.argv.includes('--write')) {
  if (missing.length) {
    const addition = `\n# Generated entries from server/src/config.ts\n${missing.map((name) => `${name}=`).join('\n')}\n`;
    writeFileSync(examplePath, example.trimEnd() + addition);
  }
  console.log(`Environment example is synchronized (${referenced.size} referenced variables).`);
} else if (process.argv.includes('--check')) {
  if (missing.length) {
    console.error(`server/.env.example is missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`Environment example covers all ${referenced.size} referenced variables.`);
} else {
  console.error('Usage: node scripts/generate-env-example.mjs <--check|--write>');
  process.exit(2);
}

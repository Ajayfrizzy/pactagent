import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

const router = Router();
const openApiSpec = JSON.parse(
  readFileSync(join(process.cwd(), 'docs/openapi/pactagent.v1.openapi.json'), 'utf8'),
) as {
  paths: Record<string, Record<string, { summary?: string }>>;
};
const openApiJson = JSON.stringify(openApiSpec);
const openApiGzip = gzipSync(openApiJson);

function renderDocsHtml() {
  const paths = Object.entries(openApiSpec.paths)
    .flatMap(([path, methods]) => Object.entries(methods as Record<string, { summary?: string }>).map(([method, spec]) => ({
      method: method.toUpperCase(),
      path,
      summary: spec.summary ?? '',
    })));

  const rows = paths.map((item) => `
    <tr>
      <td><code>${item.method}</code></td>
      <td><code>${item.path}</code></td>
      <td>${item.summary}</td>
    </tr>
  `).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PactAgent API Docs</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b1020; color: #e5e7eb; }
    body { margin: 0; padding: 32px; }
    main { max-width: 1080px; margin: 0 auto; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    p { color: #9ca3af; line-height: 1.6; }
    a { color: #38bdf8; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; background: #111827; border: 1px solid #243044; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #243044; vertical-align: top; }
    th { color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    code { color: #bfdbfe; }
  </style>
</head>
<body>
  <main>
    <h1>PactAgent Infrastructure API</h1>
    <p>App-scoped API for agreements, milestones, escrow, proof, disputes, events, webhooks, and audit logs.</p>
    <p><a href="/openapi.json">OpenAPI JSON</a> is available for generated clients and API tooling.</p>
    <table>
      <thead><tr><th>Method</th><th>Path</th><th>Summary</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </main>
</body>
</html>`;
}

router.get('/openapi.json', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Vary', 'Accept-Encoding');
  res.type('application/json');
  if (req.acceptsEncodings('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    return res.send(openApiGzip);
  }
  return res.send(openApiJson);
});

router.get('/docs', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.type('html').send(renderDocsHtml());
});

export default router;

import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { readFileSync } from 'fs';

if (process.env.OTEL_EXPORTER_OTLP_HEADERS_FILE) {
  process.env.OTEL_EXPORTER_OTLP_HEADERS = readFileSync(
    process.env.OTEL_EXPORTER_OTLP_HEADERS_FILE,
    'utf8',
  ).trim();
}

const enabled = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
const sdk = enabled ? new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
  })],
}) : null;

if (sdk) {
  sdk.start();
}

export async function shutdownTracing() {
  await sdk?.shutdown();
}

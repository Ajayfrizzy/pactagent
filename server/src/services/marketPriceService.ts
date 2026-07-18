import { config } from '../config';
import { assertProviderResponse, executeProviderRequest } from '../common/resilience/provider';

type CachedQuote = {
  expiresAt: number;
  value: CkbPriceQuote;
};

export type CkbPriceQuote = {
  assetId: 'nervos-network';
  symbol: 'CKB';
  currency: 'USD';
  priceUsd: number;
  inversePriceCkbPerUsd: number;
  lastUpdatedAt: string | null;
  fetchedAt: string;
};

let cachedQuote: CachedQuote | null = null;
let inflightQuote: Promise<CkbPriceQuote> | null = null;

function parsePositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function getApiHeaders() {
  return config.coinGeckoApiKey
    ? { 'x-cg-demo-api-key': config.coinGeckoApiKey }
    : undefined;
}

function buildQuote(priceUsd: number, lastUpdatedAt: string | null): CkbPriceQuote {
  return {
    assetId: 'nervos-network',
    symbol: 'CKB',
    currency: 'USD',
    priceUsd,
    inversePriceCkbPerUsd: 1 / priceUsd,
    lastUpdatedAt,
    fetchedAt: new Date().toISOString(),
  };
}

function buildCoinGeckoPriceUrl() {
  const normalizedBase = config.coinGeckoApiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${normalizedBase}/simple/price`);
  url.searchParams.set('ids', 'nervos-network');
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_last_updated_at', 'true');
  return url;
}

export function parseUsdAmount(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!normalized?.[0]) {
    return null;
  }

  const amount = Number.parseFloat(normalized[0]);
  return Number.isFinite(amount) ? amount : null;
}

export function convertUsdToCkb(usdAmount: number, priceUsd: number) {
  if (!Number.isFinite(usdAmount) || usdAmount <= 0 || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return null;
  }

  return usdAmount / priceUsd;
}

export async function fetchCkbPriceQuote(forceFresh = false): Promise<CkbPriceQuote> {
  const now = Date.now();
  if (!forceFresh && cachedQuote && cachedQuote.expiresAt > now) {
    return cachedQuote.value;
  }

  if (!forceFresh && inflightQuote) {
    return inflightQuote;
  }

  inflightQuote = (async () => {
    const url = buildCoinGeckoPriceUrl();

    const response = await executeProviderRequest({
      provider: 'market_price', operation: 'ckb_usd_quote', timeoutMs: 8_000,
      run: async ({ signal, requestId }) => {
        const result = await fetch(url.toString(), { headers: { ...getApiHeaders(), 'x-request-id': requestId }, signal });
        assertProviderResponse(result, 'market_price', requestId);
        return result;
      },
    });

    const data = await response.json() as {
      ['nervos-network']?: {
        usd?: number;
        last_updated_at?: number;
      };
    };

    const priceUsd = parsePositiveNumber(data?.['nervos-network']?.usd);
    if (!priceUsd) {
      throw new Error('CoinGecko did not return a valid CKB/USD quote.');
    }

    const lastUpdatedUnix = parsePositiveNumber(data?.['nervos-network']?.last_updated_at);
    const quote = buildQuote(
      priceUsd,
      lastUpdatedUnix ? new Date(lastUpdatedUnix * 1000).toISOString() : null,
    );

    cachedQuote = {
      value: quote,
      expiresAt: Date.now() + config.marketPriceCacheTtlMs,
    };

    return quote;
  })();

  try {
    return await inflightQuote;
  } catch (error) {
    if (cachedQuote) return cachedQuote.value;
    throw error;
  } finally {
    inflightQuote = null;
  }
}

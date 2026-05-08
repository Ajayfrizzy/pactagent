import { config } from '../config';

type OpenAIResponse = {
  output_text?: string;
  error?: {
    message?: string;
  };
};

export function canUseOpenAI() {
  return Boolean(
    config.aiEnabled
    && config.aiProvider === 'openai'
    && config.openaiApiKey
  );
}

export async function generateStructuredAiOutput<T>(params: {
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  userPayload: Record<string, unknown>;
}): Promise<T> {
  if (!canUseOpenAI()) {
    throw new Error('OpenAI structured output is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.openaiModel,
        input: [
          {
            role: 'system',
            content: [{ type: 'input_text', text: params.systemPrompt }],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: JSON.stringify(params.userPayload) }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: params.schemaName,
            strict: true,
            schema: params.schema,
          },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${rawError}`);
    }

    const data = await response.json() as OpenAIResponse;
    const rawOutput = data.output_text?.trim();
    if (!rawOutput) {
      throw new Error(data.error?.message || 'OpenAI response did not include structured output');
    }

    return JSON.parse(rawOutput) as T;
  } finally {
    clearTimeout(timeout);
  }
}

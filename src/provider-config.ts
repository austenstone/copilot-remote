export interface RemoteProviderConfig {
  type?: 'openai' | 'azure' | 'anthropic';
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  wireApi?: 'completions' | 'responses';
  azure?: {
    apiVersion?: string;
  };
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function sanitizeProviderConfig(input: Partial<RemoteProviderConfig> | undefined): RemoteProviderConfig | undefined {
  if (!input) return undefined;

  const baseUrl = toNonEmptyString(input.baseUrl);
  const type = input.type;
  const apiKey = toNonEmptyString(input.apiKey);
  const bearerToken = toNonEmptyString(input.bearerToken);
  const wireApi = input.wireApi;
  const apiVersion = toNonEmptyString(input.azure?.apiVersion);

  const hasAnyField = Boolean(baseUrl || type || apiKey || bearerToken || wireApi || apiVersion);
  if (!hasAnyField) return undefined;
  if (!baseUrl) {
    throw new Error(
      'BYOK provider is configured but missing baseUrl. Set provider.baseUrl or COPILOT_REMOTE_PROVIDER_BASE_URL.',
    );
  }

  return {
    ...(type ? { type } : {}),
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(bearerToken ? { bearerToken } : {}),
    ...(wireApi ? { wireApi } : {}),
    ...(apiVersion ? { azure: { apiVersion } } : {}),
  };
}

export function resolveProviderConfig(
  fileProvider?: Partial<RemoteProviderConfig>,
  env: NodeJS.ProcessEnv = process.env,
): RemoteProviderConfig | undefined {
  return sanitizeProviderConfig({
    ...fileProvider,
    type: (env.COPILOT_REMOTE_PROVIDER_TYPE as RemoteProviderConfig['type'] | undefined) ?? fileProvider?.type,
    baseUrl: env.COPILOT_REMOTE_PROVIDER_BASE_URL ?? fileProvider?.baseUrl,
    apiKey: env.COPILOT_REMOTE_PROVIDER_API_KEY ?? fileProvider?.apiKey,
    bearerToken: env.COPILOT_REMOTE_PROVIDER_BEARER_TOKEN ?? fileProvider?.bearerToken,
    wireApi:
      (env.COPILOT_REMOTE_PROVIDER_WIRE_API as RemoteProviderConfig['wireApi'] | undefined) ?? fileProvider?.wireApi,
    azure: {
      apiVersion: env.COPILOT_REMOTE_PROVIDER_AZURE_API_VERSION ?? fileProvider?.azure?.apiVersion,
    },
  });
}

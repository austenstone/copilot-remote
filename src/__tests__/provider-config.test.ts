import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderConfig } from '../provider-config.js';

describe('resolveProviderConfig', () => {
  it('returns undefined when no BYOK settings are present', () => {
    assert.equal(resolveProviderConfig(undefined, {} as NodeJS.ProcessEnv), undefined);
  });

  it('merges file config with env overrides', () => {
    const provider = resolveProviderConfig(
      {
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'file-key',
      },
      {
        COPILOT_REMOTE_PROVIDER_API_KEY: 'env-key',
        COPILOT_REMOTE_PROVIDER_WIRE_API: 'responses',
      } as NodeJS.ProcessEnv,
    );

    assert.deepEqual(provider, {
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'env-key',
      wireApi: 'responses',
    });
  });

  it('supports azure apiVersion overrides', () => {
    const provider = resolveProviderConfig(
      {
        type: 'azure',
        baseUrl: 'https://example.openai.azure.com',
      },
      {
        COPILOT_REMOTE_PROVIDER_AZURE_API_VERSION: '2024-10-21',
      } as NodeJS.ProcessEnv,
    );

    assert.deepEqual(provider, {
      type: 'azure',
      baseUrl: 'https://example.openai.azure.com',
      azure: {
        apiVersion: '2024-10-21',
      },
    });
  });

  it('throws when provider fields are present without a baseUrl', () => {
    assert.throws(() => resolveProviderConfig({ type: 'openai' }, {} as NodeJS.ProcessEnv), /missing baseUrl/);
  });
});

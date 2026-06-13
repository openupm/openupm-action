import { describe, expect, it, vi } from 'vitest';

import {
  OpenUpmApiError,
  OpenUpmClient,
  validatePositiveNumber,
  waitForPublishedVersion,
  type ReleaseStatus,
} from './openupm.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenUpmClient', () => {
  it('triggers package refresh with OIDC bearer token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(202, {}));
    const client = new OpenUpmClient({
      apiUrl: 'https://api.openupm.com/',
      fetchImpl,
    });

    await client.triggerRefresh({
      oidcToken: 'token',
      packageName: 'com.example.foo',
      tag: 'upm/1.2.3',
      version: '1.2.3',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openupm.com/packages/com.example.foo/refresh',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ version: '1.2.3', tag: 'upm/1.2.3' }),
      }),
    );
  });

  it('maps API errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(403, { error: 'RepositoryMismatch', message: 'no' }),
      );
    const client = new OpenUpmClient({
      apiUrl: 'https://api.openupm.com',
      fetchImpl,
    });

    await expect(
      client.triggerRefresh({
        oidcToken: 'token',
        packageName: 'com.example.foo',
        version: '1.2.3',
      }),
    ).rejects.toMatchObject(
      new OpenUpmApiError(403, 'no', 'RepositoryMismatch'),
    );
  });
});

describe('waitForPublishedVersion', () => {
  it('returns success when OpenUPM publishes the requested version', async () => {
    const statuses: ReleaseStatus[] = [
      {
        packageName: 'com.example.foo',
        version: '1.2.3',
        state: 'unknown',
        reason: 'unknown',
        signed: false,
      },
      {
        packageName: 'com.example.foo',
        version: '1.2.3',
        state: 'succeeded',
        reason: 'none',
        signed: true,
        publishedVersion: '1.2.3',
      },
    ];
    const client = {
      getReleaseStatus: vi.fn().mockImplementation(async () => statuses.shift()),
    };

    const result = await waitForPublishedVersion({
      client,
      now: () => 0,
      packageName: 'com.example.foo',
      pollIntervalMs: 1000,
      sleep: async () => {},
      timeoutMs: 5000,
      version: '1.2.3',
    });

    expect(result.state).toBe('succeeded');
    expect(result.publishedVersion).toBe('1.2.3');
  });

  it('returns failure immediately when OpenUPM reports failure', async () => {
    const client = {
      getReleaseStatus: vi.fn().mockResolvedValue({
        packageName: 'com.example.foo',
        version: '1.2.3',
        state: 'failed',
        reason: 'PackageNotFound',
        signed: false,
      }),
    };

    const result = await waitForPublishedVersion({
      client,
      now: () => 0,
      packageName: 'com.example.foo',
      pollIntervalMs: 1000,
      sleep: async () => {},
      timeoutMs: 5000,
      version: '1.2.3',
    });

    expect(result.state).toBe('failed');
    expect(result.reason).toBe('PackageNotFound');
  });

  it('returns timeout when OpenUPM does not finish before the deadline', async () => {
    let now = 0;
    const client = {
      getReleaseStatus: vi.fn().mockResolvedValue({
        packageName: 'com.example.foo',
        version: '1.2.3',
        state: 'building',
        reason: 'none',
        signed: false,
      }),
    };

    const result = await waitForPublishedVersion({
      client,
      now: () => now,
      packageName: 'com.example.foo',
      pollIntervalMs: 1000,
      sleep: async (ms) => {
        now += ms;
      },
      timeoutMs: 1000,
      version: '1.2.3',
    });

    expect(result.state).toBe('timeout');
  });
});

describe('validatePositiveNumber', () => {
  it('accepts positive numbers and rejects invalid values', () => {
    expect(validatePositiveNumber('timeout-minutes', '15')).toBe(15);
    expect(() => validatePositiveNumber('timeout-minutes', '0')).toThrow(
      'timeout-minutes must be a positive number.',
    );
  });
});

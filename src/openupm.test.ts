import { describe, expect, it, vi } from 'vitest';

import {
  OpenUpmApiError,
  OpenUpmClient,
  isRetryableStatusError,
  triggerRefreshWithRetry,
  validatePositiveNumber,
  validateRequiredString,
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
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(202, {
        accepted: true,
        deduped: false,
        packageName: 'com.example.foo',
        version: '1.2.3',
        tag: 'upm/1.2.3',
        statusUrl:
          'https://api.openupm.com/packages/com.example.foo/releases/1.2.3/status',
      }),
    );
    const client = new OpenUpmClient({
      apiUrl: 'https://api.openupm.com/',
      fetchImpl,
    });

    const response = await client.triggerRefresh({
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
    expect(response.statusUrl).toBe(
      'https://api.openupm.com/packages/com.example.foo/releases/1.2.3/status',
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

describe('triggerRefreshWithRetry', () => {
  it('retries transient trigger errors', async () => {
    const sleepDurations: number[] = [];
    const client = {
      triggerRefresh: vi
        .fn()
        .mockRejectedValueOnce(new OpenUpmApiError(502, 'bad gateway'))
        .mockResolvedValueOnce({
          accepted: true,
          deduped: false,
          packageName: 'com.example.foo',
          version: '1.2.3',
          statusUrl:
            'https://api.openupm.com/packages/com.example.foo/releases/1.2.3/status',
        }),
    };

    const response = await triggerRefreshWithRetry({
      attempts: 3,
      client,
      delayMs: 5_000,
      refresh: {
        oidcToken: 'token',
        packageName: 'com.example.foo',
        version: '1.2.3',
      },
      sleep: async (ms) => {
        sleepDurations.push(ms);
      },
    });

    expect(client.triggerRefresh).toHaveBeenCalledTimes(2);
    expect(sleepDurations).toEqual([5_000]);
    expect(response.statusUrl).toContain('/releases/1.2.3/status');
  });

  it('fails fast on non-retryable trigger errors', async () => {
    const client = {
      triggerRefresh: vi
        .fn()
        .mockRejectedValue(new OpenUpmApiError(403, 'forbidden')),
    };

    await expect(
      triggerRefreshWithRetry({
        attempts: 3,
        client,
        delayMs: 5_000,
        refresh: {
          oidcToken: 'token',
          packageName: 'com.example.foo',
          version: '1.2.3',
        },
        sleep: async () => {},
      }),
    ).rejects.toMatchObject(new OpenUpmApiError(403, 'forbidden'));
    expect(client.triggerRefresh).toHaveBeenCalledTimes(1);
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

  it('caps the final sleep to the remaining timeout', async () => {
    let now = 0;
    const sleepDurations: number[] = [];
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
      pollIntervalMs: 10_000,
      sleep: async (ms) => {
        sleepDurations.push(ms);
        now += ms;
      },
      timeoutMs: 3_000,
      version: '1.2.3',
    });

    expect(result.state).toBe('timeout');
    expect(sleepDurations).toEqual([3_000]);
  });

  it('retries transient status API errors until success', async () => {
    let now = 0;
    const client = {
      getReleaseStatus: vi
        .fn()
        .mockRejectedValueOnce(new OpenUpmApiError(503, 'unavailable'))
        .mockResolvedValueOnce({
          packageName: 'com.example.foo',
          version: '1.2.3',
          state: 'succeeded',
          reason: 'none',
          signed: false,
          publishedVersion: '1.2.3',
        }),
    };

    const result = await waitForPublishedVersion({
      client,
      now: () => now,
      packageName: 'com.example.foo',
      pollIntervalMs: 1_000,
      sleep: async (ms) => {
        now += ms;
      },
      timeoutMs: 5_000,
      version: '1.2.3',
    });

    expect(result.state).toBe('succeeded');
    expect(client.getReleaseStatus).toHaveBeenCalledTimes(2);
  });

  it('fails fast on non-retryable status API errors', async () => {
    const client = {
      getReleaseStatus: vi
        .fn()
        .mockRejectedValue(new OpenUpmApiError(404, 'not found')),
    };

    await expect(
      waitForPublishedVersion({
        client,
        now: () => 0,
        packageName: 'com.example.foo',
        pollIntervalMs: 1_000,
        sleep: async () => {},
        timeoutMs: 5_000,
        version: '1.2.3',
      }),
    ).rejects.toMatchObject(new OpenUpmApiError(404, 'not found'));
  });
});

describe('isRetryableStatusError', () => {
  it('classifies transient polling errors', () => {
    expect(isRetryableStatusError(new OpenUpmApiError(408, 'timeout'))).toBe(
      true,
    );
    expect(
      isRetryableStatusError(new OpenUpmApiError(429, 'rate limited')),
    ).toBe(true);
    expect(isRetryableStatusError(new OpenUpmApiError(503, 'down'))).toBe(
      true,
    );
    expect(isRetryableStatusError(new TypeError('network'))).toBe(true);
    expect(isRetryableStatusError(new OpenUpmApiError(404, 'missing'))).toBe(
      false,
    );
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

describe('validateRequiredString', () => {
  it('trims non-empty strings and rejects blank values', () => {
    expect(validateRequiredString('package', ' com.example.foo ')).toBe(
      'com.example.foo',
    );
    expect(() => validateRequiredString('package', '   ')).toThrow(
      'package must not be empty.',
    );
  });
});

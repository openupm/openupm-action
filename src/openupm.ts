export type ReleaseState =
  | 'unknown'
  | 'pending'
  | 'building'
  | 'succeeded'
  | 'failed';

export interface ActionInputs {
  apiUrl: string;
  oidcAudience: string;
  packageName: string;
  pollIntervalSeconds: number;
  tag?: string;
  timeoutMinutes: number;
  version: string;
}

export interface ReleaseStatus {
  packageName: string;
  version: string;
  state: ReleaseState;
  reason: string;
  signed: boolean;
  publishedVersion?: string;
  packageUrl?: string;
}

export type WaitResult = Omit<ReleaseStatus, 'state'> & {
  state: 'succeeded' | 'failed' | 'timeout';
};

export interface OpenUpmClientOptions {
  apiUrl: string;
  fetchImpl?: typeof fetch;
}

export class OpenUpmApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export function isRetryableStatusError(error: unknown): boolean {
  if (error instanceof OpenUpmApiError) {
    return (
      error.status === 408 ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599)
    );
  }
  return error instanceof TypeError;
}

function cleanApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/g, '');
}

async function readError(response: Response): Promise<OpenUpmApiError> {
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    return new OpenUpmApiError(
      response.status,
      body.message || response.statusText,
      body.error,
    );
  } catch {
    return new OpenUpmApiError(response.status, response.statusText);
  }
}

export class OpenUpmClient {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenUpmClientOptions) {
    this.apiUrl = cleanApiUrl(options.apiUrl);
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async triggerRefresh(params: {
    oidcToken: string;
    packageName: string;
    tag?: string;
    version: string;
  }): Promise<void> {
    const response = await this.fetchImpl(
      `${this.apiUrl}/packages/${encodeURIComponent(params.packageName)}/refresh`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.oidcToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: params.version,
          ...(params.tag ? { tag: params.tag } : {}),
        }),
      },
    );
    if (!response.ok) throw await readError(response);
  }

  async getReleaseStatus(params: {
    packageName: string;
    version: string;
  }): Promise<ReleaseStatus> {
    const response = await this.fetchImpl(
      `${this.apiUrl}/packages/${encodeURIComponent(
        params.packageName,
      )}/releases/${encodeURIComponent(params.version)}/status`,
      {
        headers: {
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) throw await readError(response);
    return (await response.json()) as ReleaseStatus;
  }
}

export function validatePositiveNumber(
  name: string,
  value: string,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

export async function waitForPublishedVersion(params: {
  client: Pick<OpenUpmClient, 'getReleaseStatus'>;
  now?: () => number;
  packageName: string;
  pollIntervalMs: number;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
  version: string;
}): Promise<WaitResult> {
  const now = params.now || Date.now;
  const deadline = now() + params.timeoutMs;

  while (now() <= deadline) {
    try {
      const status = await params.client.getReleaseStatus({
        packageName: params.packageName,
        version: params.version,
      });

      if (status.state === 'succeeded' || status.state === 'failed') {
        return status as WaitResult;
      }
    } catch (error) {
      if (!isRetryableStatusError(error)) throw error;
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await params.sleep(Math.min(params.pollIntervalMs, remainingMs));
  }

  return {
    packageName: params.packageName,
    version: params.version,
    state: 'timeout',
    reason: 'Timed out waiting for OpenUPM publishing.',
    signed: false,
  };
}

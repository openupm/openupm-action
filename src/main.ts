import * as core from '@actions/core';

import {
  OpenUpmClient,
  OpenUpmApiError,
  triggerRefreshWithRetry,
  validatePositiveNumber,
  validateRequiredString,
  waitForPublishedVersion,
} from './openupm.js';

function getInputs(): {
  apiUrl: string;
  oidcAudience: string;
  packageName: string;
  pollIntervalMs: number;
  tag?: string;
  timeoutMs: number;
  version?: string;
} {
  const timeoutMinutes = validatePositiveNumber(
    'timeout-minutes',
    core.getInput('timeout-minutes'),
  );
  const pollIntervalSeconds = validatePositiveNumber(
    'poll-interval-seconds',
    core.getInput('poll-interval-seconds'),
  );
  const tag = core.getInput('tag').trim();
  return {
    apiUrl: validateRequiredString(
      'api-url',
      core.getInput('api-url', { required: true }),
    ),
    oidcAudience: validateRequiredString(
      'oidc-audience',
      core.getInput('oidc-audience', { required: true }),
    ),
    packageName: validateRequiredString(
      'package',
      core.getInput('package', { required: true }),
    ),
    pollIntervalMs: pollIntervalSeconds * 1000,
    tag: tag || undefined,
    timeoutMs: timeoutMinutes * 60 * 1000,
    version: core.getInput('version').trim() || undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setOutputs(status: {
  state: string;
  reason?: string;
  publishedVersion?: string;
  signed?: boolean;
  packageUrl?: string;
  statusUrl?: string;
}): void {
  core.setOutput('state', status.state);
  core.setOutput('reason', status.reason || '');
  core.setOutput('published-version', status.publishedVersion || '');
  core.setOutput('signed', String(status.signed ?? false));
  core.setOutput('package-url', status.packageUrl || '');
  core.setOutput('status-url', status.statusUrl || '');
}

export async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const client = new OpenUpmClient({ apiUrl: inputs.apiUrl });
    const oidcToken = await core.getIDToken(inputs.oidcAudience);

    core.info(`Triggering OpenUPM refresh for ${inputs.packageName}.`);
    const trigger = await triggerRefreshWithRetry({
      attempts: 3,
      client,
      delayMs: 5_000,
      refresh: {
        oidcToken,
        packageName: inputs.packageName,
        tag: inputs.tag,
        version: inputs.version,
      },
      sleep,
    });
    const version = trigger.version;

    core.info(`Waiting for ${inputs.packageName}@${version} to publish.`);
    const status = await waitForPublishedVersion({
      client,
      packageName: inputs.packageName,
      pollIntervalMs: inputs.pollIntervalMs,
      sleep,
      timeoutMs: inputs.timeoutMs,
      version,
    });

    setOutputs({ ...status, statusUrl: trigger.statusUrl });

    if (status.state === 'succeeded') {
      core.info(
        `OpenUPM published ${inputs.packageName}@${status.publishedVersion || version}.`,
      );
      return;
    }

    if (status.state === 'failed') {
      core.setFailed(
        `OpenUPM publishing failed for ${inputs.packageName}@${version}: ${status.reason}`,
      );
      return;
    }

    core.setFailed(
      `Timed out waiting for OpenUPM to publish ${inputs.packageName}@${version}.`,
    );
  } catch (error) {
    if (error instanceof OpenUpmApiError) {
      core.setFailed(
        `OpenUPM API request failed with ${error.status}${error.code ? ` ${error.code}` : ''}: ${error.message}`,
      );
      return;
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

await run();

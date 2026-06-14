# OpenUPM Publish Wait Action

Trigger an OpenUPM package refresh from GitHub Actions and wait until the
tagged package version is published or fails.

This action uses GitHub Actions OIDC. It does not require an OpenUPM account,
personal access token, or repository secret.

## Requirements

- The package is already registered on OpenUPM.
- The OpenUPM package `repoUrl` points to the same public GitHub repository
  that runs this workflow.
- The workflow grants `id-token: write` so GitHub can issue the short-lived
  OIDC token that OpenUPM verifies.

## Tag Push Workflow

Only send tags that contain a parseable semver package version to this action,
for example `1.2.3`, `v1.2.3`, `upm/1.2.3`, or
`com.example.package@v1.2.3`. Other tags are rejected before the action
contacts OpenUPM.

```yaml
name: Publish to OpenUPM

on:
  push:
    tags:
      - '**'

permissions:
  id-token: write
  contents: read

jobs:
  openupm:
    runs-on: ubuntu-latest
    steps:
      - uses: openupm/openupm-action@v1
        with:
          package: com.example.openupm-action
          tag: ${{ github.ref_name }}
```

The action requests an OIDC token for the fixed `openupm` audience, asks
OpenUPM to scan the registered package repository, then polls the release
status endpoint for the version parsed from the tag.

## GitHub Release Workflow

You can also run the action after a GitHub Release is published:

```yaml
name: Publish release to OpenUPM

on:
  release:
    types: [published]

permissions:
  id-token: write
  contents: read

jobs:
  openupm:
    runs-on: ubuntu-latest
    steps:
      - uses: openupm/openupm-action@v1
        with:
          package: com.example.openupm-action
          tag: ${{ github.event.release.tag_name }}
```

If the tag does not contain a parseable package version, the action fails
before contacting OpenUPM.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `package` | required | OpenUPM package name. |
| `tag` | required | Git tag that triggered the workflow. OpenUPM verifies it against the OIDC token ref. |
| `timeout-minutes` | `15` | Maximum time to wait before failing the action. |
| `poll-interval-seconds` | `15` | Delay between status checks. |

## Outputs

| Output | Description |
| --- | --- |
| `state` | Final observed state: `succeeded`, `failed`, or `timeout`. |
| `reason` | OpenUPM release reason when available. |
| `published-version` | Version published to the registry when available. |
| `signed` | Whether OpenUPM reports the package as signed. |
| `package-url` | OpenUPM package page URL. |
| `status-url` | OpenUPM release status API URL. |

## Versioning

Use `openupm/openupm-action@v1` for normal workflows. The `v1` tag is updated
only for compatible fixes and improvements. Pin to a full release tag such as
`openupm/openupm-action@v1.0.0` when you need an immutable action revision.

## Notes

The OpenUPM API remains non-blocking. This action provides blocking workflow
behavior by polling until the version becomes installable, fails, or the
configured timeout is reached. Transient status polling errors, such as
temporary server errors or rate-limit responses, are retried until the timeout.
Transient errors while sending the initial trigger request are retried with a
small fixed retry budget.

A successful action run means the requested package version is available from
the OpenUPM registry. The OpenUPM package page and website search may update on
their own refresh cycle after the registry publish finishes.

If the action reports a failed OpenUPM release, check the package page's build
history for the public failure reason, fix the package or tag, then create a new
version tag or re-tag a failed version if your repository policy allows it.

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

```yaml
name: Publish to OpenUPM

on:
  push:
    tags:
      - '*'

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

OpenUPM derives the package version from common tag shapes such as `1.2.3`,
`v1.2.3`, `upm/1.2.3`, and `com.example.package@v1.2.3`. The action requests
an OIDC token for the `openupm` audience, asks OpenUPM to scan the registered
package repository, then polls the release status endpoint for the derived
version.

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

If your repository uses a tag shape that OpenUPM cannot parse, pass `version`
as an explicit override. The value must match the `version` field in the
package's `package.json` at that tag.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `package` | required | OpenUPM package name. |
| `version` | empty | Optional package version override. Only needed when OpenUPM cannot derive the version from `tag`. |
| `tag` | empty | Git tag that triggered the workflow. When set, OpenUPM verifies it against the OIDC token ref. |
| `timeout-minutes` | `15` | Maximum time to wait before failing the action. |
| `poll-interval-seconds` | `15` | Delay between status checks. |
| `api-url` | `https://api.openupm.com` | OpenUPM API base URL. |
| `oidc-audience` | `openupm` | OIDC audience requested from GitHub. |

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

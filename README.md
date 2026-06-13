# OpenUPM Publish Wait Action

Trigger an OpenUPM package refresh from GitHub Actions and wait until the
requested version is published or fails.

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
          version: ${{ github.ref_name }}
          tag: ${{ github.ref_name }}
```

For prefixed tags such as `upm/1.2.3`, pass `version: 1.2.3` and
`tag: upm/1.2.3`. The action requests an OIDC token for the `openupm`
audience, asks OpenUPM to scan the registered package repository, then polls the
release status endpoint. The `version` input must match the `version` field in
the package's `package.json` at that tag.

## GitHub Release Workflow

You can also run the action after a GitHub Release is published. This example
accepts release tags such as `v1.2.3` and passes `1.2.3` as the OpenUPM package
version:

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
      - id: version
        env:
          TAG_NAME: ${{ github.event.release.tag_name }}
        run: echo "value=${TAG_NAME#v}" >> "$GITHUB_OUTPUT"

      - uses: openupm/openupm-action@v1
        with:
          package: com.example.openupm-action
          version: ${{ steps.version.outputs.value }}
          tag: ${{ github.event.release.tag_name }}
```

If your release tags already match `package.json.version`, use the tag value
directly for both `version` and `tag`. Otherwise, pass the package version as
`version` and the original release tag as `tag`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `package` | required | OpenUPM package name. |
| `version` | required | Package version to wait for. This must match `package.json.version` at the tag. |
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
only for compatible fixes and improvements. Pin to a full release tag when you
need an immutable action revision.

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

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
release status endpoint.

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
directly for both `version` and `tag`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `package` | required | OpenUPM package name. |
| `version` | required | Package version to wait for. |
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

## Notes

The OpenUPM API remains non-blocking. This action provides blocking workflow
behavior by polling until the version becomes installable, fails, or the
configured timeout is reached. Transient status polling errors, such as
temporary server errors or rate-limit responses, are retried until the timeout.

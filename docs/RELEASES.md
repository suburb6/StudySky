# Releases and verification

Official releases are immutable `vMAJOR.MINOR.PATCH` tags. The workflow publishes:

- `ghcr.io/suburb6/studysky:<tag>` for the lightweight base image;
- `ghcr.io/suburb6/studysky:<tag>-ocr` for the optional OCR worker;
- `linux/amd64` and `linux/arm64` manifests;
- source archives and SHA-256 checksums;
- SPDX JSON SBOMs, provenance attestations, and keyless Cosign signatures.

No `latest` tag is used by Compose.

## Verify an image

Install Cosign, choose a release, and verify the exact workflow identity:

```sh
version=v0.1.0
cosign verify "ghcr.io/suburb6/studysky:${version}" \
  --certificate-identity "https://github.com/suburb6/StudySky/.github/workflows/release.yml@refs/tags/${version}" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"
```

Repeat with `${version}-ocr` when using the OCR image. With GitHub CLI, verify the registry
provenance:

```sh
gh attestation verify "oci://ghcr.io/suburb6/studysky:${version}" --repo suburb6/StudySky
```

Download release assets and run `sha256sum --check SHA256SUMS` from the same directory.

## Maintainer release gate

1. Update version metadata and `CHANGELOG.md` through a pull request.
2. Require formatting, lint, type checks, unit/integration/E2E tests, blank-container smoke,
   Gitleaks, npm audit, CodeQL, and Trivy to pass on `main`.
3. Confirm the full tree and full Git history contain no credentials, personal data, uploads,
   databases, or identifying images.
4. Create and push an annotated tag from the green `main` commit.
5. Wait for the release workflow to rebuild and test, publish both architectures, sign the
   manifests, generate SBOM/provenance, and create the GitHub release.
6. Verify checksums, signatures, attestations, manifests, and a fresh Compose installation from the
   released image.
7. Only then deploy that immutable tag to a private installation.

If any gate fails, delete no evidence and publish no replacement under the same tag; fix the cause
and issue a new version.

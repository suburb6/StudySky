# Security policy

## Supported versions

Only the newest released minor version receives security fixes. Self-hosters should run an immutable
supported tag and subscribe to GitHub security advisories and releases.

## Report privately

Use **Security → Report a vulnerability** in the `suburb6/StudySky` GitHub repository. Do not open a
public Issue or Discussion and do not include real student data, production credentials, private
hostnames, or destructive proof-of-concept material.

Include the affected version, component, deployment assumptions, impact, and the smallest safe
reproduction or source-level explanation. Reports are acknowledged and triaged as maintainer
capacity permits; there is no guaranteed bounty or response SLA.

## Scope

In scope: authentication, authorization/tenant isolation, uploads and file serving, credential
storage, OCR/model delivery, server-side request handling, release workflows, and default Compose
security. Vulnerabilities solely in an unsupported fork, an unpatched host, an intentionally public
deployment, or a third-party service should normally be reported upstream.

## Disclosure

Please allow time to validate, patch, test, and publish an advisory before public disclosure. The
maintainer will credit reporters who request credit and will coordinate a release when the report is
valid. Never test against an installation you do not own or have explicit permission to assess.

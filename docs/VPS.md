# VPS, DNS, and HTTPS

This guide exposes one independent StudySky installation. It does not connect to any maintainer
infrastructure.

## Prepare the host

Use a supported Linux distribution, create a non-root deployment account, install Docker Engine
and Compose from Docker's official instructions, and apply operating-system updates. Allow only
SSH, HTTP, and HTTPS through the firewall. Prefer SSH keys and disable password login after
confirming key access.

Create `/opt/studysky`, place the release files there, and make `.env` readable only by the
deployment account. Follow [INSTALL.md](INSTALL.md), but set:

```dotenv
ORIGIN=https://study.example.com
STUDYSKY_VERSION=v0.1.0
```

The Compose file binds StudySky to `127.0.0.1`, so it is not directly exposed to the internet.

## DNS

Create an `A` record from `study.example.com` to the VPS IPv4 address and, if configured, an
`AAAA` record to its IPv6 address. Wait until public DNS resolves to the host before requesting a
certificate.

## Caddy

Install Caddy from its official package repository. Copy `deploy/Caddyfile.example`, replace the
example domain, and keep the reverse proxy on loopback:

```caddyfile
study.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000
}
```

Validate and reload Caddy. It obtains and renews HTTPS certificates automatically when DNS and
ports 80/443 are correct. Confirm:

```sh
curl --fail https://study.example.com/health/ready
```

Do not put another public proxy in front of StudySky unless its forwarding headers and trusted
proxy depth are understood. The defaults expect one Caddy proxy.

## Operational baseline

- Keep `.env`, backups, and SSH keys outside the web root and out of Git.
- Keep the database and upload volumes on persistent storage.
- Copy encrypted backups to another machine or object store.
- Update only to verified immutable tags; never deploy a floating `latest` tag.
- Monitor disk use, container restarts, certificate renewal, and `/health/ready`.
- Do not publish the administrator email or use this private installation as a public demo.

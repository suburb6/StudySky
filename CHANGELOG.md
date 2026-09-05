# Changelog

All notable changes are documented here. StudySky follows Semantic Versioning.

## [Unreleased]

### Added

- Due and overdue tasks on Today, with completion and shared task editing without leaving the page.
- Search results open the matching task editor and retain a link back to the search and filters.
- Library actions to read, correct, copy, and download saved OCR text and LaTeX without rerunning recognition.

### Changed

- Clarified the privacy-first public-release wording and the administrator-approved OCR provider
  boundary in the README and architecture guide.

## [0.2.0] - 2026-08-10

### Added

- Curated on-device OCR reading modes for English handwriting and Latin-language notes with common
  symbols
- Optional self-hosted formula-to-LaTeX using PP-FormulaNet-S and PP-DocLayout-M, with editable
  review, page-by-page PDF support, and a signed multi-architecture `-formula` image

## [0.1.0] - 2026-08-09

### Added

- First clean-history community self-hosting release
- Modules, chapters, Kanban tasks, timetable, revision, planning, documents, progress, and accounts
- Browser-based local PaddleOCR/ONNX recognition and optional OCRmyPDF/Tesseract worker
- Per-account IANA timezone handling, including DST and fractional offsets
- Versioned multi-architecture images, SBOMs, provenance, checksums, and keyless signatures
- Complete installation, VPS, administration, backup, upgrade, OCR, privacy, and release guides

### Security

- Empty first-run workspace with administrator-only bootstrap
- Tenant-isolated study data and uploads, content validation, quotas, and opaque sessions
- Account-scoped offline queues, session-bound push subscriptions, and restricted push egress
- Pinned GitHub Actions plus Gitleaks, npm audit, CodeQL, and Trivy release gates

[Unreleased]: https://github.com/suburb6/StudySky/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/suburb6/StudySky/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/suburb6/StudySky/releases/tag/v0.1.0

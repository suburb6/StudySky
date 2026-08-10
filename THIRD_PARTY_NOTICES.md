# Third-party notices

StudySky is AGPL-3.0-only. It also uses and distributes third-party components under their own
licences. This file is attribution and inventory information, not legal advice. The exact resolved
JavaScript dependency graph is recorded in `package-lock.json`; release SBOMs include transitive and
container packages.

## Direct runtime dependencies

| Component                                | Licence    | Upstream                                  |
| ---------------------------------------- | ---------- | ----------------------------------------- |
| FullCalendar core, interaction, timegrid | MIT        | https://fullcalendar.io                   |
| Lucide Svelte                            | ISC        | https://lucide.dev                        |
| @node-rs/argon2                          | MIT        | https://github.com/napi-rs/node-rs        |
| @paddleocr/paddleocr-js                  | Apache-2.0 | https://github.com/PaddlePaddle/PaddleOCR |
| Drizzle ORM                              | Apache-2.0 | https://orm.drizzle.team                  |
| file-type                                | MIT        | https://github.com/sindresorhus/file-type |
| ONNX Runtime Web                         | MIT        | https://github.com/microsoft/onnxruntime  |
| PDF.js (`pdfjs-dist`)                    | Apache-2.0 | https://github.com/mozilla/pdf.js         |
| pg-boss                                  | MIT        | https://github.com/timgit/pg-boss         |
| postgres.js                              | Unlicense  | https://github.com/porsager/postgres      |
| qrcode                                   | MIT        | https://github.com/soldair/node-qrcode    |
| Sharp                                    | Apache-2.0 | https://github.com/lovell/sharp           |
| Svelte and SvelteKit                     | MIT        | https://github.com/sveltejs               |
| web-push                                 | MPL-2.0    | https://github.com/web-push-libs/web-push |
| Zod                                      | MIT        | https://github.com/colinhacks/zod         |

Sharp release binaries include libvips, which is LGPL-2.1-or-later, and codecs/libraries carrying
their own licences. See https://github.com/libvips/libvips and the Sharp/libvips notices in the
installed package and release SBOM.

## OCR models and runtimes

The browser OCR feature downloads these PaddleOCR artifacts on demand:

| Artifact                                   | Pinned SHA-256                                                     |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `PP-OCRv5_mobile_det_onnx_infer.tar`       | `781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30` |
| `en_PP-OCRv5_mobile_rec_onnx_infer.tar`    | `4424e851309b291b00aab8191cd4314cefbd2d1b2381ff8994019d262fa95e28` |
| `latin_PP-OCRv5_mobile_rec_onnx_infer.tar` | `0fd8634124d871d25492311da077517ba3b4277ea67a0dec9e46ce537978c7cb` |

PaddleOCR code and published model assets are supplied by PaddlePaddle under Apache-2.0. ONNX
Runtime Web is supplied by Microsoft under MIT. StudySky does not modify the downloaded model
artifacts; it verifies their expected length and digest before serving them to authenticated users.

## Optional OCR image

- OCRmyPDF: MPL-2.0 — https://github.com/ocrmypdf/OCRmyPDF
- Tesseract OCR and standard trained data: Apache-2.0 — https://github.com/tesseract-ocr
- Ghostscript: GNU AGPL-3.0 (or a commercial Artifex licence) —
  https://github.com/ArtifexSoftware/ghostpdl

These programs and their operating-system dependencies are installed from Debian packages in the
optional `-ocr` image. Corresponding package copyright files are available under `/usr/share/doc`
inside that image. StudySky is itself distributed under AGPL-3.0-only; operators remain responsible
for complying with every enabled package and model licence.

## Direct development dependencies

Playwright, TypeScript, and Drizzle ORM are Apache-2.0. Svelte tooling, Vite, Vitest, ESLint,
Prettier, tsx, esbuild, Node type definitions, and related direct development packages are MIT.
The precise versions are in `package.json` and `package-lock.json`.

Full licence texts and copyright notices remain in installed packages, container package metadata,
upstream distributions, and generated SBOMs. If an attribution is missing or inaccurate, open a
licensing issue without including private data.

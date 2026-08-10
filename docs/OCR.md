# OCR and physical notes

StudySky provides three local/self-hosted reading paths. None requires a commercial OCR API.

## Browser handwriting OCR

The default feature uses PaddleOCR with ONNX Runtime Web in a Web Worker. The authenticated server
downloads integrity-pinned PP-OCRv5 mobile model artifacts into its private cache; the browser then
downloads the runtime, the shared detector, and the selected recogniser before performing
recognition on the student's device. First use is roughly 35–40 MB depending on the browser build.
Switching to a recognition model that is not already cached downloads about another 8 MB.

Students choose a reading mode before each run. The last choice is remembered only in that browser:

- **English handwriting** is the recommended default for handwritten and printed English notes.
- **English, French & symbols** uses the Latin recogniser for accented Latin text and a broader set
  of common mathematical symbols.

This is a lightweight, general-purpose recogniser, not a handwriting-specialist language model.
It can help digitise neat handwriting and printed notes, but accuracy falls with cursive writing,
blur, shadows, page curvature, diagrams, unusual symbols, and unsupported languages. The extracted
text is always a draft. StudySky keeps saved corrections and does not replace them automatically
when OCR is run again.

The Latin recogniser may preserve individual symbols, but this OCR pipeline returns plain text
lines. It does not reconstruct complex formula layout as LaTeX. Use the separate formula mode when
the spatial structure of an equation matters.

The document-scanner UI performs local crop, perspective, rotation, and compression work before an
upload. The note is not submitted to a third-party OCR service. Model artifacts are fetched from
the Paddle upstream through the StudySky server and checked against pinned byte sizes and SHA-256
hashes.

## Optional formula-to-LaTeX

An operator can add the optional `-formula` image. It uses PaddleOCR's PP-FormulaNet-S recogniser
with PP-DocLayout-M to locate equations on a page. Paddle describes PP-FormulaNet as supporting
printed and handwritten formulas. StudySky returns editable LaTeX only: it does not explain,
solve, grade, or silently correct the mathematics. See Paddle's
[formula-recognition documentation](https://www.paddleocr.ai/main/en/version3.x/module_usage/formula_recognition.html).

The workflow stays inside the Library's **Digitise notes** dialog:

1. Choose **Formula to LaTeX**.
2. Prepare an image or one PDF page.
3. Find formula regions, or use the close-up fallback when the entire image is one equation.
4. Review the LaTeX, then copy it or append it to the document's saved text.

Only the prepared page is sent over the private Compose network to the installation's own formula
container. It is not sent to Paddle or another OCR API. The service does not persist request
images, include note content in normal logs, or expose a host port. Inference is serialised so one
small host is not flooded by simultaneous model runs.

Formula recognition is disabled by default because it uses substantially more disk, memory, and
CPU than browser text OCR. To enable the released image, generate a private service token and add
it to `.env`:

```sh
openssl rand -hex 32
# Paste the result after FORMULA_OCR_TOKEN= in .env
docker compose -f compose.yml -f compose.formula.yml pull
docker compose -f compose.yml -f compose.formula.yml up -d postgres migrate formula-ocr web worker
```

For a full source build:

```sh
docker compose -f compose.yml -f compose.build.yml -f compose.formula.yml \
  -f compose.formula-build.yml up -d --build postgres migrate formula-ocr web worker
```

The formula image embeds exact, digest-pinned model archives and architecture-specific
PaddlePaddle wheels during its build. It does not download a replacement model at runtime.

### Interpreting the published benchmark

Paddle's official PP-FormulaNet-S table reports **87.00 En-BLEU**, a 224 MB inference model, and
254.39 ms model-inference time in its listed CPU test environment. En-BLEU measures similarity to
reference LaTeX; it is not “87% accuracy,” a StudySky end-to-end result, or a guarantee for an
individual student's handwriting. Page detection, capture quality, notation, and hardware all
affect real results. Always compare the draft with the original.

## Adding another browser model

StudySky intentionally does not accept arbitrary model URLs in the student interface. Model files
are executable inference inputs, and accepting an unverified URL would weaken the supply-chain and
privacy guarantees of the local reader.

A maintainer can add a compatible PaddleOCR ONNX recognition model by adding a curated reading
profile, pinning the official archive URL, exact byte size, and SHA-256 digest in the server model
manifest, updating the third-party notices, and running the release checks. The archive must match
the format required by the pinned PaddleOCR.js version. Formula models are curated in the same
way at build time; the student selector never accepts arbitrary model URLs. New layout or vision
pipelines need a separate resource, privacy, licence, and output-review design rather than
appearing as a drop-in text model.

## Searchable-PDF OCR worker

The optional `-ocr` image adds OCRmyPDF, Tesseract, and Ghostscript. Processing occurs inside the
self-hosted worker and primarily targets printed text in scans. It is larger and needs more CPU,
memory, and temporary disk.

Enable it with `compose.ocr.yml`, set `OCR_ENABLED=true`, and configure installed Tesseract
languages through `OCR_LANGUAGES`. Keep job timeouts and upload limits realistic for the host.
StudySky limits PDF extraction and OCR to 500 pages per document by default so one upload cannot
monopolise the shared worker. Hosts can lower this with `MAX_PDF_PROCESSING_PAGES`; values above
10,000 are capped. Files over the limit keep their original upload but are marked as processing
failed.

## Practical capture guidance

- Use even lighting and avoid shadows from the phone.
- Keep the page flat and fill the frame.
- Write dark text on a plain background.
- Process one page at a time on low-memory devices.
- Review names, equations, code, and numbers manually.
- Keep the original image or PDF; OCR output is not a replacement for the source.

Model and runtime licences are recorded in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

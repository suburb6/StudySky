# OCR and physical notes

StudySky provides two local/self-hosted OCR paths. Neither requires a commercial OCR API.

## Browser handwriting OCR

The default feature uses PaddleOCR with ONNX Runtime Web in a Web Worker. The authenticated server
downloads two integrity-pinned PP-OCRv5 mobile model artifacts into its private cache; the browser
then downloads the runtime and models and performs recognition on the student's device. First use
is roughly 35–40 MB depending on the browser build.

This is a lightweight, general-purpose recogniser, not a handwriting-specialist language model.
It can help digitise neat handwriting and printed notes, but accuracy falls with cursive writing,
blur, shadows, page curvature, diagrams, unusual symbols, and unsupported languages. The extracted
text is always a draft. StudySky keeps saved corrections and does not replace them automatically
when OCR is run again.

The document-scanner UI performs local crop, perspective, rotation, and compression work before an
upload. The note is not submitted to a third-party OCR service. Model artifacts are fetched from
the Paddle upstream through the StudySky server and checked against pinned byte sizes and SHA-256
hashes.

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

#!/usr/bin/env python3
"""Small, private HTTP boundary around StudySky's formula-recognition models."""

from __future__ import annotations

import base64
import binascii
import hmac
import json
import logging
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit


MODEL_NAME = "PP-FormulaNet-S"
LAYOUT_MODEL_NAME = "PP-DocLayout-M"
SERVICE_ENGINE = f"PaddleOCR {MODEL_NAME} + {LAYOUT_MODEL_NAME}"
MAX_FORMULAS = 100
MAX_LATEX_CHARS = 20_000
DEFAULT_MAX_IMAGE_BYTES = 6 * 1024 * 1024
DEFAULT_MAX_PIXELS = 16_000_000
DEFAULT_MAX_REQUEST_BYTES = 9 * 1024 * 1024

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(message)s",
)
LOGGER = logging.getLogger("studysky.formula")


class ClientError(Exception):
    def __init__(self, status: HTTPStatus, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def encoded_request_limit(max_image_bytes: int) -> int:
    return ((max_image_bytes + 2) // 3) * 4 + 1024


def formula_box(value: Any) -> list[float] | None:
    candidate = value
    if isinstance(candidate, list) and len(candidate) == 1 and isinstance(candidate[0], list):
        candidate = candidate[0]
    if not isinstance(candidate, list) or len(candidate) != 4:
        return None
    if not all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in candidate):
        return None
    return [round(float(item), 2) for item in candidate]


def extract_formula_results(value: Any) -> list[dict[str, Any]]:
    """Return a small, stable response from PaddleX's versioned result structure."""

    if not isinstance(value, dict):
        return []
    result = value.get("res", value)
    if not isinstance(result, dict):
        return []
    raw_items = result.get("formula_res_list")
    if not isinstance(raw_items, list):
        return []

    formulas: list[dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            continue
        latex = item.get("rec_formula")
        if not isinstance(latex, str):
            continue
        latex = latex.replace("\x00", "").strip()
        if not latex or len(latex) > MAX_LATEX_CHARS:
            continue
        formulas.append(
            {
                "latex": latex,
                "box": formula_box(item.get("dt_polys")),
                "sourceIndex": index,
            }
        )

    formulas.sort(
        key=lambda item: (
            item["box"][1] if item["box"] else float("inf"),
            item["box"][0] if item["box"] else float("inf"),
            item["sourceIndex"],
        )
    )
    return [
        {"latex": item["latex"], "box": item["box"]}
        for item in formulas[:MAX_FORMULAS]
    ]


def decode_request_payload(payload: Any, max_image_bytes: int) -> tuple[bytes, str]:
    if not isinstance(payload, dict):
        raise ClientError(HTTPStatus.BAD_REQUEST, "The request must be a JSON object.")
    mode = payload.get("mode", "page")
    if mode not in {"page", "formula"}:
        raise ClientError(HTTPStatus.BAD_REQUEST, "Unknown formula recognition mode.")
    encoded = payload.get("image")
    if not isinstance(encoded, str) or not encoded:
        raise ClientError(HTTPStatus.BAD_REQUEST, "A Base64 image is required.")
    if len(encoded) > ((max_image_bytes + 2) // 3) * 4 + 8:
        raise ClientError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The formula image is too large.")
    try:
        image = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError, UnicodeEncodeError) as error:
        raise ClientError(HTTPStatus.BAD_REQUEST, "The formula image is not valid Base64.") from error
    if not image:
        raise ClientError(HTTPStatus.BAD_REQUEST, "The formula image is empty.")
    if len(image) > max_image_bytes:
        raise ClientError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The formula image is too large.")
    return image, mode


class FormulaRecognizer:
    def __init__(self) -> None:
        import cv2
        import numpy
        from paddleocr import FormulaRecognitionPipeline

        self._cv2 = cv2
        self._numpy = numpy
        self._max_pixels = bounded_int(
            "FORMULA_OCR_MAX_PIXELS", DEFAULT_MAX_PIXELS, 1_000_000, 40_000_000
        )
        cpu_threads = bounded_int("FORMULA_OCR_CPU_THREADS", min(4, os.cpu_count() or 1), 1, 32)
        enable_mkldnn = os.getenv("FORMULA_OCR_ENABLE_MKLDNN", "false").lower() == "true"
        formula_model_dir = os.getenv(
            "FORMULA_OCR_MODEL_DIR", "/models/PP-FormulaNet-S_infer"
        )
        layout_model_dir = os.getenv(
            "FORMULA_OCR_LAYOUT_MODEL_DIR", "/models/PP-DocLayout-M_infer"
        )

        LOGGER.info("Loading %s with %s", MODEL_NAME, LAYOUT_MODEL_NAME)
        self._pipeline = FormulaRecognitionPipeline(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            layout_detection_model_name=LAYOUT_MODEL_NAME,
            layout_detection_model_dir=layout_model_dir,
            formula_recognition_model_name=MODEL_NAME,
            formula_recognition_model_dir=formula_model_dir,
            device="cpu",
            enable_mkldnn=enable_mkldnn,
            cpu_threads=cpu_threads,
        )
        LOGGER.info("Formula recognizer ready")

    def predict(self, image_bytes: bytes, mode: str) -> list[dict[str, Any]]:
        encoded = self._numpy.frombuffer(image_bytes, dtype=self._numpy.uint8)
        image = self._cv2.imdecode(encoded, self._cv2.IMREAD_COLOR)
        if image is None or len(image.shape) != 3:
            raise ClientError(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "The formula image is unreadable.")
        height, width = image.shape[:2]
        if width < 8 or height < 8:
            raise ClientError(HTTPStatus.BAD_REQUEST, "The formula image is too small.")
        if width * height > self._max_pixels:
            raise ClientError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "The formula image has too many pixels.")

        output = self._pipeline.predict(
            image,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_layout_detection=mode == "page",
        )
        formulas: list[dict[str, Any]] = []
        for item in output:
            formulas.extend(extract_formula_results(getattr(item, "json", item)))
        return formulas[:MAX_FORMULAS]


class FormulaHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(
        self,
        address: tuple[str, int],
        recognizer: FormulaRecognizer,
        token: str,
        max_image_bytes: int,
    ) -> None:
        super().__init__(address, FormulaRequestHandler)
        self.recognizer = recognizer
        self.token = token
        self.max_image_bytes = max_image_bytes
        minimum_request_bytes = encoded_request_limit(max_image_bytes)
        self.max_request_bytes = bounded_int(
            "FORMULA_OCR_MAX_REQUEST_BYTES",
            max(DEFAULT_MAX_REQUEST_BYTES, minimum_request_bytes),
            minimum_request_bytes,
            20 * 1024 * 1024,
        )
        self.queue_timeout = bounded_int("FORMULA_OCR_QUEUE_TIMEOUT_SECONDS", 60, 1, 180)
        self.inference_lock = threading.Lock()


class FormulaRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "StudySkyFormula/1"

    @property
    def formula_server(self) -> FormulaHTTPServer:
        return self.server  # type: ignore[return-value]

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(15)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if urlsplit(self.path).path != "/health":
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        self._json(
            HTTPStatus.OK,
            {
                "status": "ready",
                "model": MODEL_NAME,
                "layoutModel": LAYOUT_MODEL_NAME,
            },
        )

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if urlsplit(self.path).path != "/v1/formula":
            self._json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        authorization = self.headers.get("authorization", "")
        expected = f"Bearer {self.formula_server.token}"
        if not hmac.compare_digest(authorization, expected):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Authentication required."})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "JSON is required."})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
        except ValueError:
            content_length = 0
        if content_length <= 0:
            self._json(HTTPStatus.LENGTH_REQUIRED, {"error": "Content-Length is required."})
            return
        if content_length > self.formula_server.max_request_bytes:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "The request is too large."})
            return

        try:
            body = self.rfile.read(content_length)
            payload = json.loads(body)
            image, mode = decode_request_payload(payload, self.formula_server.max_image_bytes)
            acquired = self.formula_server.inference_lock.acquire(
                timeout=self.formula_server.queue_timeout
            )
            if not acquired:
                raise ClientError(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    "The formula recognizer is busy. Try again shortly.",
                )
            try:
                formulas = self.formula_server.recognizer.predict(image, mode)
            finally:
                self.formula_server.inference_lock.release()
            self._json(
                HTTPStatus.OK,
                {
                    "model": MODEL_NAME,
                    "layoutModel": LAYOUT_MODEL_NAME,
                    "engine": SERVICE_ENGINE,
                    "formulas": formulas,
                },
            )
        except ClientError as error:
            self._json(error.status, {"error": error.message})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "The request JSON is invalid."})
        except TimeoutError:
            self._json(HTTPStatus.REQUEST_TIMEOUT, {"error": "The request timed out."})
        except Exception:
            LOGGER.exception("Formula inference failed")
            self._json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Formula recognition could not finish."},
            )

    def _json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        self.send_response(status.value)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.send_header("x-content-type-options", "nosniff")
        self.send_header("connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, message: str, *args: Any) -> None:
        LOGGER.info("%s %s", self.address_string(), message % args)


def main() -> None:
    token = os.getenv("FORMULA_OCR_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("FORMULA_OCR_TOKEN must contain at least 32 characters.")
    host = os.getenv("FORMULA_OCR_HOST", "0.0.0.0")
    port = bounded_int("FORMULA_OCR_PORT", 8080, 1, 65_535)
    max_image_bytes = bounded_int(
        "FORMULA_OCR_MAX_IMAGE_BYTES",
        DEFAULT_MAX_IMAGE_BYTES,
        256 * 1024,
        12 * 1024 * 1024,
    )
    recognizer = FormulaRecognizer()
    server = FormulaHTTPServer((host, port), recognizer, token, max_image_bytes)
    LOGGER.info("Listening on %s:%d", host, port)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()

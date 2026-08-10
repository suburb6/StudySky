#!/usr/bin/env bash
set -euo pipefail

: "${FORMULA_OCR_TOKEN:=formula-smoke-token-00000000000000000000000000000000}"
export FORMULA_OCR_TOKEN

compose_files=(-f compose.yml -f compose.formula.yml)
if [[ "${FORMULA_SMOKE_SOURCE_BUILD:-false}" == "true" ]]; then
  compose_files+=(-f compose.formula-build.yml)
fi

docker compose "${compose_files[@]}" up -d formula-ocr

ready=false
for _ in $(seq 1 90); do
  if docker compose "${compose_files[@]}" exec -T formula-ocr \
    python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()" \
    >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "${ready}" != "true" ]]; then
  docker compose "${compose_files[@]}" logs formula-ocr
  exit 1
fi

docker compose "${compose_files[@]}" exec -T formula-ocr python - <<'PY'
import base64
import io
import json
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

image = Image.new("RGB", (1200, 300), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.load_default(size=112)
draw.text((55, 75), "x² + y² = z²", font=font, fill="#111111")
buffer = io.BytesIO()
image.save(buffer, format="PNG")
payload = json.dumps(
    {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "mode": "formula",
    }
).encode("utf-8")
request = urllib.request.Request(
    "http://127.0.0.1:8080/v1/formula",
    data=payload,
    headers={
        "authorization": f"Bearer {os.environ['FORMULA_OCR_TOKEN']}",
        "content-type": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
formulas = result.get("formulas", [])
assert formulas, result
latex = formulas[0].get("latex", "").strip()
assert len(latex) >= 3 and "=" in latex, result
print(f"Formula smoke passed: {latex}")
PY

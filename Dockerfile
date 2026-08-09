# syntax=docker/dockerfile:1.7
FROM node:24.18.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:24.18.0-bookworm-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.18.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --system --gid 10001 studysky \
    && useradd --system --uid 10001 --gid studysky --home-dir /app studysky \
    && mkdir -p /data/uploads \
    && chown -R studysky:studysky /data /app \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=production-dependencies --chown=studysky:studysky /app/node_modules ./node_modules
COPY --from=build --chown=studysky:studysky /app/build ./build
COPY --from=build --chown=studysky:studysky /app/build-worker ./build-worker
COPY --from=build --chown=studysky:studysky /app/drizzle ./drizzle
COPY --chown=studysky:studysky package.json ./
USER studysky
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "build"]

FROM runtime AS ocr-runtime
USER root
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ghostscript \
      ocrmypdf \
      tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*
USER studysky

FROM runtime AS final

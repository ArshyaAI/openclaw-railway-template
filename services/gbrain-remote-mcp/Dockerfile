FROM oven/bun:1.3.13

ARG GBRAIN_UPSTREAM_SHA=9e2093fc9bb6cb46520e58b0c95b807e788d9606

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates patch \
  && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/garrytan/gbrain.git /app \
  && git checkout "$GBRAIN_UPSTREAM_SHA"

COPY apply-remote-http-safety.mjs /tmp/apply-remote-http-safety.mjs
RUN bun /tmp/apply-remote-http-safety.mjs
RUN grep -q "Admin Token: suppressed in Railway logs" /app/src/commands/serve-http.ts \
  && grep -q "origin: false" /app/src/commands/serve-http.ts

RUN bun install --frozen-lockfile

COPY start-gbrain-http.mjs /usr/local/bin/start-gbrain-http.mjs

ENV NODE_ENV=production
ENV GBRAIN_HTTP_CORS_ORIGIN=
ENV GBRAIN_TOKEN_TTL=3600

CMD ["bun", "/usr/local/bin/start-gbrain-http.mjs"]

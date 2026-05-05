FROM oven/bun:1.3.13

ARG GBRAIN_REPO_URL=https://github.com/ArshyaAI/gbrain.git
ARG GBRAIN_UPSTREAM_SHA=de11d4c858b1a880931c008fbee3ceef92a8329a

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates patch \
  && rm -rf /var/lib/apt/lists/*

RUN git clone "$GBRAIN_REPO_URL" /app \
  && git checkout "$GBRAIN_UPSTREAM_SHA"

COPY apply-remote-http-safety.mjs /tmp/apply-remote-http-safety.mjs
RUN bun /tmp/apply-remote-http-safety.mjs
RUN grep -q "Admin Token: suppressed in Railway logs" /app/src/commands/serve-http.ts \
  && grep -q "origin: false" /app/src/commands/serve-http.ts \
  && grep -q "InvalidTokenError" /app/src/core/oauth-provider.ts

RUN bun install --frozen-lockfile --ignore-scripts

COPY start-gbrain-http.mjs /usr/local/bin/start-gbrain-http.mjs

ENV NODE_ENV=production
ENV GBRAIN_HTTP_CORS_ORIGIN=
ENV GBRAIN_TOKEN_TTL=3600

CMD ["bun", "/usr/local/bin/start-gbrain-http.mjs"]

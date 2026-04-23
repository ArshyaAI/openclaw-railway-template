FROM node:22-slim

RUN apt-get update && apt-get install -y git curl procps python3 make g++ cron && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --prefer-online && npm cache clean --force

# Work around openclaw@2026.4.21 lazily installing Telegram plugin deps at
# gateway startup, which can hit npm ENOTEMPTY cleanup races on Railway.
RUN cd node_modules/openclaw/dist/extensions/telegram && \
    npm install --ignore-scripts --legacy-peer-deps --package-lock=false --no-save \
      "@grammyjs/runner@^2.0.3" \
      "@grammyjs/transformer-throttler@^1.2.1" \
      "@sinclair/typebox@0.34.49" \
      "grammy@^1.42.0" \
      "undici@8.1.0" && \
    npm cache clean --force

ENV PATH="/app/node_modules/.bin:$PATH"
ENV ALPHACLAW_ROOT_DIR=/data

RUN mkdir -p /data

EXPOSE 3000

CMD ["alphaclaw", "start"]

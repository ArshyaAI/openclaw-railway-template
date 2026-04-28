FROM node:22-slim

RUN apt-get update && apt-get install -y git curl procps python3 make g++ cron tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci --omit=dev --prefer-online && node patches/patch-alphaclaw-processes.js && npm cache clean --force
RUN chmod +x patches/start-astack.sh

ENV PATH="/app/node_modules/.bin:$PATH"
ENV ALPHACLAW_ROOT_DIR=/data

RUN mkdir -p /data

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["patches/start-astack.sh"]

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /data/media /data/whatsapp-session

ENV PORT=3000 \
    DATA_DIR=/data \
    MEDIA_DIR=/data/media \
    BOT_TIMEZONE=America/Lima

EXPOSE 3000

CMD ["node", "src/server.js"]

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    SESSION_PATH=/data/baileys_auth \
    DATA_DIR=/data/bot-control \
    PORT=10000

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY . .
RUN mkdir -p /data/baileys_auth /data/bot-control/audios && chown -R node:node /app /data
USER node
EXPOSE 10000
CMD ["npm", "start"]

FROM node:22-slim

WORKDIR /app
RUN useradd --create-home --shell /bin/bash appuser

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
COPY migrations ./migrations
COPY public ./public
RUN npm run build && npm prune --omit=dev

USER appuser
ENV TASKFORGE_HOST=0.0.0.0 \
    TASKFORGE_PORT=3100 \
    TASKFORGE_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3100
CMD ["node", "dist/server.js"]

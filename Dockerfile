FROM node:22-alpine

WORKDIR /app

# Copy package manifests and install dependencies for Vite + TypeScript build
COPY package.json package-lock.json ./
RUN npm ci

# Copy TypeScript/Vite config, frontend source, public assets, and backend server
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY server ./server

# Build React + TypeScript frontend into /app/dist and prune devDependencies
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# Create persistent SQLite volume directory
RUN mkdir -p /data && chown -R node:node /data /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/data/kitchen.db
ENV PRINTER_API_URL=http://10.10.20.2:8769/print
ENV TZ=Europe/Warsaw

VOLUME ["/data"]

# Expose plain HTTP only (no reverse proxy)
EXPOSE 3000

USER node

CMD ["node", "--no-warnings", "server/index.js"]

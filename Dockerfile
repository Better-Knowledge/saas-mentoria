# ---- build: instala deps de producao (compila better-sqlite3 nativo) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Ferramentas para compilar modulos nativos (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime: imagem enxuta apenas com o necessario ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Diretorio de dados persistente (SQLite + WAL)
RUN mkdir -p /app/data && chown -R node:node /app
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000
CMD ["node", "server.js"]

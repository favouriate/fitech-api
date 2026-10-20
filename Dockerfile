# Stage 1: install dependencies, generate Prisma Client, and compile TypeScript.
FROM node:24-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci --include=dev
RUN npx --no-install prisma generate

COPY . .

RUN npm run build
RUN npm prune --omit=dev

# Prisma is a devDependency in the application. Keep its pinned migration CLI
# isolated from the pruned application dependencies; startup never downloads it.
RUN npm install --prefix /opt/prisma-cli --no-package-lock --no-audit --no-fund prisma@6.19.3

# Stage 2: production artifacts and the migration CLI only.
FROM node:24-alpine AS production

RUN apk add --no-cache dumb-init openssl

WORKDIR /app

RUN addgroup -S nodejs -g 1001 && \
    adduser -S appuser -u 1001 -G nodejs

COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/prisma ./prisma
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder /opt/prisma-cli /opt/prisma-cli

COPY --chown=appuser:nodejs docker-entrypoint.sh ./
# Git checkouts on Windows may use CRLF. Always execute a POSIX LF script.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]

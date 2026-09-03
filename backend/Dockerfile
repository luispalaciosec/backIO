# Contexto de build: la RAÍZ del monorepo (necesita shared/ y el lockfile).
# Railway: Root Directory = "/" y Dockerfile Path = "backend/Dockerfile".
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
RUN pnpm install --frozen-lockfile --filter @backio/backend... --prod=false

COPY shared ./shared
COPY backend ./backend

ENV NODE_ENV=production
ENV ENABLE_INTERNAL_CRON=1
EXPOSE 4000
WORKDIR /app/backend
CMD ["pnpm", "start"]

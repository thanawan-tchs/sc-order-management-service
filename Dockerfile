# syntax=docker/dockerfile:1

# --- deps: install once, reused by both the build and the production stage --------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN npm ci

# --- build: compile TypeScript -> dist/ ---------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- production: only what's needed to run the compiled app ------------------------------------
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Don't run as root in the container.
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000

CMD ["node", "dist/server.js"]

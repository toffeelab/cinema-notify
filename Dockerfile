# Build stage
FROM node:22-slim AS builder

WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Runtime stage
FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Install Chromium and its system dependencies
RUN npx playwright install --with-deps chromium

COPY --from=builder /app/dist ./dist
COPY config.json ./

CMD ["node", "--max-old-space-size=400", "dist/main.js"]

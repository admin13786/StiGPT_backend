FROM node:20-alpine AS builder

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache openssl libc6-compat python3 make g++

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder?schema=public"

RUN npm ci --legacy-peer-deps
RUN npx prisma generate --schema=./prisma/schema.prisma

COPY . .

RUN if [ -f prisma/seed.ts ]; then \
    npx tsc prisma/seed.ts --outDir prisma --module commonjs --esModuleInterop --resolveJsonModule --skipLibCheck; \
  fi

RUN npm run build

FROM node:20-alpine AS production

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
  && apk add --no-cache openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

# Reuse builder dependencies instead of running a second npm install on the server.
# This avoids slow native dependency rebuilds during remote deployment.
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN npm prune --omit=dev --legacy-peer-deps \
  && npm install prisma@5.7.0 --no-save --legacy-peer-deps \
  && npm cache clean --force

RUN mkdir -p uploads/avatars logs

EXPOSE 21101

CMD ["sh", "-c", "echo 'Running database migrations...' && npx prisma migrate deploy && echo 'Checking seed data...' && (npx prisma db seed || echo 'Seed skipped or failed; continuing startup...') && echo 'Starting backend...' && node dist/main.js"]

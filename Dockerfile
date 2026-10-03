# PICSEAL — 影像档案终端
# 多阶段构建：Next.js standalone 产物 + 精简 runner
# 本地一键启用：docker run -p 3000:3000 zhiweio/picseal

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# standalone 输出仅镜像构建需要，与 next.config.ts 的 BUILD_STANDALONE 开关对应
RUN BUILD_STANDALONE=1 pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S picseal && adduser -S picseal -G picseal

COPY --from=builder /app/public ./public
COPY --from=builder --chown=picseal:picseal /app/.next/standalone ./
COPY --from=builder --chown=picseal:picseal /app/.next/static ./.next/static

USER picseal
EXPOSE 3000

CMD ["node", "server.js"]

# Pulse Attendance — single container, SQLite on a mounted volume.
# Node 24 is required: the database uses the built-in node:sqlite module.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ATTENDANCE_DATA_DIR=/data \
    COOKIE_SECURE=true
RUN addgroup -g 1001 -S nodejs && adduser -S pulse -u 1001 && mkdir -p /data && chown pulse:nodejs /data
COPY --from=builder --chown=pulse:nodejs /app/.next/standalone ./
COPY --from=builder --chown=pulse:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=pulse:nodejs /app/public ./public
USER pulse
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]

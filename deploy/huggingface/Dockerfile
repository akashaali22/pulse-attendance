# Hugging Face Space image: builds the app straight from GitHub, so this Space only holds two files.
# Rebuild the Space (Settings → Factory rebuild) to pick up new commits.
FROM node:24-alpine AS builder
RUN apk add --no-cache git
ARG REPO=https://github.com/akashaali22/pulse-attendance
ARG BRANCH=main
WORKDIR /src
RUN git clone --depth 1 --branch ${BRANCH} ${REPO} .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm ci && npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ATTENDANCE_DATA_DIR=/tmp/pulse-data
# Spaces run the container as uid 1000.
RUN mkdir -p /tmp/pulse-data && chown -R 1000:1000 /tmp/pulse-data /app
COPY --from=builder --chown=1000:1000 /src/.next/standalone ./
COPY --from=builder --chown=1000:1000 /src/.next/static ./.next/static
COPY --from=builder --chown=1000:1000 /src/public ./public
USER 1000
EXPOSE 3000
CMD ["node", "server.js"]

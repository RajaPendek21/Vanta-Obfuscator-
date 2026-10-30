FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @vanta/shared build && pnpm --filter @vanta/engine build && pnpm --filter @vanta/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
RUN useradd --system --uid 10001 --create-home vanta
COPY --from=build --chown=vanta:vanta /app /app
USER vanta
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

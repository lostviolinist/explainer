# Web app + pipeline worker (Next.js serves the Inngest functions; Remotion renders in-process).
FROM node:22-bookworm-slim

# Shared libraries for the headless Chrome that Remotion downloads on first render.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/schemas/package.json packages/schemas/
COPY packages/hedra/package.json packages/hedra/
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/render/package.json packages/render/
RUN pnpm install --frozen-lockfile

# The renderer bundles packages/render/src at runtime, so the whole source stays in the image.
COPY . .
RUN pnpm --filter @explainer/web build

ENV NODE_ENV=production
EXPOSE 3000
# Create/update tables, then serve.
CMD ["sh", "-c", "cd apps/web && npx drizzle-kit push --force && npx next start -p 3000"]

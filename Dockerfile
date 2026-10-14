# Web app + pipeline worker (Next.js serves the Inngest functions; Remotion renders in-process).
FROM node:22-bookworm-slim

# Shared libraries for the headless Chrome that Remotion downloads on first render.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
      fonts-inter \
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
# Remotion's headless Chrome, fetched now. It is cached under the nearest package.json to the
# working directory, so install it from apps/web (the sandbox runs from there too). The animation
# sandbox has no internet, so the build must not continue without it: retry, then fail loudly.
RUN cd apps/web && for i in 1 2 3; do \
      node -e "require('/app/packages/render/node_modules/@remotion/renderer').ensureBrowser({ logLevel: 'error' }).then(() => process.exit(0))" && break; \
      echo "Chrome download failed (attempt $i of 3), retrying…"; sleep 5; \
    done && node -e "require('/app/packages/render/node_modules/@remotion/renderer').ensureBrowser({ logLevel: 'error' }).then((b) => { if (!b || b.type === 'no-browser') process.exit(1); console.log('Remotion browser:', b.path); })" \
    || (echo "ERROR: could not download Remotion's headless Chrome; the animation sandbox needs it and has no internet. Check your connection and run docker compose up --build again." && exit 1)

ENV NODE_ENV=production
EXPOSE 3000
# Create/update tables, then serve.
CMD ["sh", "-c", "cd apps/web && npx drizzle-kit push --force && npx next start -p 3000"]

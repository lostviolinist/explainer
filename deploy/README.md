# Sharing it beyond your laptop

## The free way: a tunnel from your laptop

Keep `docker compose up` running and give it a public address with Cloudflare's tunnel. Nothing to configure in the app, no account needed:

```bash
brew install cloudflared            # or https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/
cloudflared tunnel --url http://localhost:3000
```

It prints an `https://….trycloudflare.com` address. Send that. The catches: the address changes each time you restart the tunnel, your laptop has to stay awake, and videos render on it. For a stable address, a free Cloudflare account and a domain on it let you run a named tunnel (`cloudflared tunnel login`, then `create`, `route dns`, `run`); the app side is the same. Add a login first if the link will travel: Cloudflare Access on a named tunnel, or the `basic_auth` block in `deploy/Caddyfile` with the setup below.

## The always-on way: one server

One machine runs everything: the site, the database, the storage, the worker and the renderer. Rendering is the heavy part, so give it **4 CPUs and 8 GB of RAM** (a $40-a-month VM on Hetzner, DigitalOcean or similar). Ubuntu 24.04 is assumed below.

1. **Point a hostname at the machine.** An `A` record, e.g. `explain.example.com → 203.0.113.7`. HTTPS is automatic once DNS resolves.

2. **Install Docker** on the machine:

   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

3. **Get the code and the keys:**

   ```bash
   git clone https://github.com/lostviolinist/explainer.git && cd explainer
   cp .env.example .env
   nano .env     # HEDRA_API_KEY, OPENAI_API_KEY, EXA_API_KEY, and add:  DOMAIN=explain.example.com
   ```

4. **Start it:**

   ```bash
   docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
   ```

   The first build takes about ten minutes. Then open `https://explain.example.com/?setup`: every row should be a tick.

5. **Keep strangers out** (recommended): uncomment the `basic_auth` block in `deploy/Caddyfile`, put in a name and a password hash, and run step 4 again. Anyone who can reach the site can spend your API credits otherwise.

**Updating:** `git pull`, then step 4 again. The footer of the home page shows which build is running.

**Looking inside:** `docker compose logs -f web inngest` for the app and the worker; `docker compose ps` for what is up. The Inngest run history is not published outside the machine; to see it, `ssh -L 8288:localhost:8288 user@machine` and open http://localhost:8288 on your laptop.

**What is different from running it locally:** only Caddy is reachable from outside (ports 80 and 443). Everything else is the same stack. Pictures and videos are always served by the site itself at `/s3/…`, so they work from any address without configuration.

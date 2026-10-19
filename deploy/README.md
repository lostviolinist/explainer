# Putting it on a server

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

**What is different from running it locally:** only Caddy is reachable from outside (ports 80 and 443); videos and pictures are served through it at `/s3/…` on the same hostname as the site; the share links use the hostname. Everything else is the same stack.

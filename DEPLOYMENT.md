# Deployment & Google Cloud Setup Guide

Domain: `gmail.andrewallkin.cloud`

---

## 1. Google Cloud Platform — OAuth Setup

### 1.1 Create a Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project**
3. Name it (e.g. `gmail-manager`) → **Create**

### 1.2 Enable the Gmail API

1. In your project, go to **APIs & Services → Library**
2. Search for **Gmail API** → Click it → **Enable**

### 1.3 Configure the OAuth Consent Screen

1. Go to **APIs & Services → OAuth consent screen**
2. User Type: **External** → **Create**
3. Fill in:
   - App name: `Gmail Manager`
   - User support email: your Gmail address
   - Developer contact email: your Gmail address
4. Click **Save and Continue**
5. **Scopes** — click **Add or Remove Scopes** and add all of these:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
   - `openid`
   - `email`
   - `profile`
6. Click **Save and Continue**
7. **Test Users** — click **Add Users** and add your Gmail address
8. Click **Save and Continue** → **Back to Dashboard**

> **Note:** Keep the app in **Testing** status. Since this is a single-user personal app, you never need to go through Google's verification process. Your account is already whitelisted as a test user. Tokens expire after 7 days in testing mode but will auto-refresh as long as you stay logged in.

### 1.4 Create OAuth Credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `gmail-manager-web`
5. Under **Authorized redirect URIs**, click **Add URI**:
   ```
   https://gmail.andrewallkin.cloud/api/auth/google/callback
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret** — you'll need these as GitHub secrets

---

## 2. VPS Prerequisites

SSH into your VPS and ensure the following are set up:

### 2.1 Install Docker & Docker Compose

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Docker Compose plugin (comes with modern Docker)
docker compose version
```

### 2.2 Create the app directory

```bash
sudo mkdir -p /srv/apps
sudo chown $USER:$USER /srv/apps
```

### 2.3 Nginx reverse proxy

Install Nginx and create a config for the domain:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/gmail.andrewallkin.cloud`:

```nginx
server {
    listen 80;
    server_name gmail.andrewallkin.cloud;

    # Redirect HTTP → HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name gmail.andrewallkin.cloud;

    ssl_certificate     /etc/letsencrypt/live/gmail.andrewallkin.cloud/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gmail.andrewallkin.cloud/privkey.pem;

    # Frontend (Vite/React — served by Nginx inside Docker on port 3003)
    location / {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8003;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and get an SSL certificate:

```bash
sudo ln -s /etc/nginx/sites-available/gmail.andrewallkin.cloud \
           /etc/nginx/sites-enabled/

# Get SSL cert (HTTP must be reachable first — point DNS before this step)
sudo certbot --nginx -d gmail.andrewallkin.cloud

sudo nginx -t && sudo systemctl reload nginx
```

### 2.4 DNS

Add an **A record** in your DNS provider:

| Type | Name  | Value          |
|------|-------|----------------|
| A    | gmail | `<VPS IP>`     |

Wait for propagation (usually < 5 min with short TTL).

### 2.5 SSH key for GitHub Actions

Generate a dedicated deploy key on your VPS (or locally):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_deploy
```

Add the **public key** to `~/.ssh/authorized_keys` on the VPS:

```bash
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
```

The **private key** (`~/.ssh/github_deploy`) goes into GitHub secrets as `VPS_SSH_KEY`.

---

## 3. GitHub Actions Secrets

Go to your repository → **Settings → Secrets and variables → Actions → New repository secret**

Add every secret in the table below:

| Secret name            | Value                                               |
|------------------------|-----------------------------------------------------|
| `VPS_HOST`             | Your VPS IP address or hostname                     |
| `VPS_PORT`             | SSH port (usually `22`)                             |
| `VPS_USER`             | SSH username (e.g. `ubuntu`, `root`)                |
| `VPS_SSH_KEY`          | Contents of the private deploy key file             |
| `GH_USERNAME`          | Your GitHub username                                |
| `GH_PAT`               | GitHub Personal Access Token (read:repo scope)      |
| `POSTGRES_USER`        | e.g. `gmail_manager`                                |
| `POSTGRES_PASSWORD`    | Strong random password                              |
| `POSTGRES_DB`          | e.g. `gmail_manager`                                |
| `POSTGRES_PORT`        | `5432`                                              |
| `BACKEND_PORT`         | `8003`                                              |
| `FRONTEND_PORT`        | `3003`                                              |
| `APP_ENV`              | `production`                                        |
| `APP_SECRET_KEY`       | 64-char random hex (see generation command below)   |
| `PUBLIC_BASE_URL`      | `https://gmail.andrewallkin.cloud`                  |
| `GOOGLE_CLIENT_ID`     | From GCP step 1.4                                   |
| `GOOGLE_CLIENT_SECRET` | From GCP step 1.4                                   |
| `GOOGLE_ALLOWED_EMAIL` | Your Gmail address                                  |
| `LOG_LEVEL`            | `INFO` (or omit — defaults to INFO)                 |

Generate a secure `APP_SECRET_KEY`:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Generate a GitHub PAT:
Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
Grant **Contents: Read-only** for this repository.

---

## 4. First Deploy

Push to `main` (or trigger manually via **Actions → Deploy to VPS → Run workflow**).

The workflow will:
1. SSH into the VPS
2. Clone/pull the repo into `/srv/apps/gmail_manager_local`
3. Write the `.env` file from secrets
4. `docker compose build && docker compose up -d`
5. Run Alembic migrations
6. Print container status

### 4.1 First-time Google connect

After deploy, visit `https://gmail.andrewallkin.cloud` and click **Connect Google Account**. This redirects to Google OAuth, then back to your app with a session cookie set.

You only need to do this once — the refresh token is stored in the database and auto-refreshed.

---

## 5. Ongoing Operations

| Task | Command |
|------|---------|
| Redeploy | Push to `main` or trigger workflow manually |
| View logs | `docker compose -f /srv/apps/gmail_manager_local/docker-compose.yml logs -f api` |
| Run migration manually | `docker compose exec -T api bash -c "cd /app && ./run_migrations.sh"` |
| Restart containers | `docker compose restart` |
| Check container health | `docker compose ps` |

---

## 6. Optional: OpenAI API Key (for AI classification)

The OpenAI API key is **not** an environment variable — it is stored per-user in the database.

After logging in, go to **Settings → AI Configuration**:
- Enable AI features
- Select provider: **OpenAI**
- Paste your API key (from [platform.openai.com/api-keys](https://platform.openai.com/api-keys))

The app uses `gpt-4o-mini` for email classification.

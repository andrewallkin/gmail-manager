# Gmail Manager - Setup Guide

## 1. Google Cloud Console Setup

### Create a Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it (e.g., "Gmail Manager") and create

### Enable Gmail API
1. Go to "APIs & Services" → "Library"
2. Search for "Gmail API" and click "Enable"

### Configure OAuth Consent Screen
1. Go to "APIs & Services" → "OAuth consent screen"
2. Select "External" user type
3. Fill in app name, user support email, developer contact
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
5. Add your email as a test user (required while app is in "Testing" status)

### Create OAuth 2.0 Credentials
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. Application type: "Web application"
4. Name: "Gmail Manager"
5. Authorized redirect URIs:
   - Development: `http://localhost:8003/api/auth/google/callback`
   - Production: `https://your-domain.com/api/auth/google/callback`
6. Copy the Client ID and Client Secret

## 2. Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth Client ID from step above |
| `GOOGLE_CLIENT_SECRET` | OAuth Client Secret from step above |
| `GOOGLE_ALLOWED_EMAIL` | Your Gmail address (restricts who can log in) |
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `APP_SECRET_KEY` | Random 32+ character string for JWT signing |
| `PUBLIC_BASE_URL` | Your app's public URL (e.g., `https://gmail.yourdomain.com`) |

## 3. Running

```bash
# Start all services
docker compose up --build

# Run database migrations
docker compose exec -T api bash -c "cd /app && ./run_migrations.sh"

# Access the app
open http://localhost:3003
```

## 4. Production Deployment

The app deploys automatically via GitHub Actions on push to `main`. Configure the following GitHub Secrets:

- `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`
- `GH_USERNAME`, `GH_PAT`
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`
- `BACKEND_PORT`, `FRONTEND_PORT`
- `APP_ENV`, `APP_SECRET_KEY`, `PUBLIC_BASE_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_EMAIL`

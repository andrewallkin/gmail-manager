# Gmail Manager Local

## Overview
Web app for managing Gmail via the Gmail API. Uses Google OAuth for authentication. Single-user app.

## Architecture
- **Backend:** FastAPI + SQLAlchemy + PostgreSQL + Alembic + PyJWT + httpx
- **Frontend:** React 18 + TypeScript + Tailwind CSS 4 + Vite + React Router v6
- **Deploy:** Docker Compose (api + frontend + postgres), Nginx reverse proxy
- **Auth:** Google OAuth2 → JWT HttpOnly cookies
- **Ports:** API=8003, Frontend=3003

## Development

### Running locally
```bash
docker compose up --build
```

### Running migrations
```bash
docker compose exec -T api bash -c "cd /app && ./run_migrations.sh"
```

### Creating a new migration
```bash
docker compose exec -T api bash -c "cd /app && alembic revision --autogenerate -m 'description'"
```

### Running tests
```bash
docker compose run --rm api pytest tests/
```

## Key Patterns
- All dependencies installed inside Docker containers only (never on host)
- Google OAuth flow: POST /api/auth/login (re-login) or GET /api/auth/google/connect (OAuth redirect)
- JWT stored in HttpOnly cookie named `gmail_auth`
- Gmail API called directly via httpx (no google-api-python-client)
- Single-user restriction via GOOGLE_ALLOWED_EMAIL env var
- Frontend uses `credentials: "include"` for all API calls

## Environment Variables
See `.env.example` for all required variables. Key ones:
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - from Google Cloud Console
- `GOOGLE_ALLOWED_EMAIL` - restricts which Google account can log in
- `JWT_SECRET` or `APP_SECRET_KEY` - for signing JWT tokens

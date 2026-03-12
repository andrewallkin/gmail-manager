# Gmail Manager

Web app for managing Gmail via the Gmail API. Single-user app with Google OAuth authentication.

## Features

- **Labels:** View, create, delete, and sync Gmail labels
- **Rules:** Create email rules to auto-archive, delete, mark read, or apply labels
- **Cleanup:** Bulk cleanup by date range and label filter
- **AI:** Optional AI-powered email categorization (OpenAI/Anthropic)

## Quick Start

See [SETUP.md](SETUP.md) for Google Cloud Console setup instructions.

```bash
cp .env.example .env
# Fill in your Google OAuth credentials and other settings
docker compose up --build
docker compose exec -T api bash -c "cd /app && ./run_migrations.sh"
```

Visit `http://localhost:3003` to access the app.

## Tech Stack

- **Backend:** FastAPI, SQLAlchemy, PostgreSQL, Alembic, PyJWT, httpx
- **Frontend:** React 18, TypeScript, Tailwind CSS 4, Vite, React Router v6
- **Deploy:** Docker Compose, Nginx, GitHub Actions

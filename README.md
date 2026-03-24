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
make dev-build
make migrate
```

Visit `http://localhost:3003` to access the app.

## Make Commands

**Development:**
- `make dev-up` – Start development environment
- `make dev-build` – Rebuild and start (includes `up`)
- `make dev-down` – Stop development environment
- `make dev-logs` – View all logs
- `make dev-shell` – Open shell in api container

**Database Migrations (Alembic):**
- `make migrate` – Apply pending migrations
- `make migrate-create MSG='description'` – Create new migration (autogenerate from models)
- `make migrate-stamp` – Mark DB as up-to-date without running migrations (for existing DBs)
- `make migrate-history` – Show migration history
- `make migrate-rollback` – Rollback last migration

**Production:**
- `make prod-up` – Start with production config
- `make prod-down` – Stop production config

**Utilities:**
- `make clean` – Remove containers and images

### Creating Your First Migration

For a fresh database, create the initial migration and apply it:

```bash
make dev-build
make migrate-create MSG='initial_schema'
make migrate
```

Migrations are stored in `backend/alembic/versions/`. Never edit applied migrations; create new ones for schema changes.

## Tech Stack

- **Backend:** FastAPI, SQLAlchemy, PostgreSQL, Alembic, PyJWT, httpx
- **Frontend:** React 18, TypeScript, Tailwind CSS 4, Vite, React Router v6
- **Deploy:** Docker Compose, Nginx, GitHub Actions

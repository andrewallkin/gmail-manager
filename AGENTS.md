# Agent Rules

Instructions for AI agents working on this codebase.

## Pull Requests

- **PR titles must always start with** `feat:` or `refactor:` (e.g. `feat: add X`, `refactor: simplify Y`).
- **PR descriptions must always be in-depth**: include a clear summary, detailed breakdown of changes by area, and rationale where relevant. Avoid one-line or minimal descriptions.

## Local Environment

- **Never install anything on the host machine.** Do not run `npm install`, `pip install`, `poetry install`, or any other package manager on the user's local system.
- All dependencies are installed inside Docker containers via the project's Dockerfile(s).

## Database Schema Changes

- **Every change to `backend/app/models.py` must be accompanied by an Alembic migration.** After modifying models, immediately run `make migrate-create MSG='short_description'` to autogenerate the migration file inside Docker. Then run `make migrate` to apply it.
- **Never hand-write migration files or manually set revision IDs.** Always use `make migrate-create` so Alembic resolves the `Revises:` chain automatically.
- **Verify the generated migration** in `backend/alembic/versions/` — confirm `upgrade()` and `downgrade()` match the intended schema change before committing.

## Testing

- **All testing must run inside Docker containers.** Do not run `pytest`, `npm test`, `vitest`, or similar directly on the host.
- Use `docker compose run` or `docker compose exec` to run tests inside the appropriate service container.
- Example: `docker compose run --rm api pytest tests/` for backend tests.

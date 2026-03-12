# Agent Rules

Instructions for AI agents working on this codebase.

## Pull Requests

- **PR titles must always start with** `feat:` or `refactor:` (e.g. `feat: add X`, `refactor: simplify Y`).
- **PR descriptions must always be in-depth**: include a clear summary, detailed breakdown of changes by area, and rationale where relevant. Avoid one-line or minimal descriptions.

## Local Environment

- **Never install anything on the host machine.** Do not run `npm install`, `pip install`, `poetry install`, or any other package manager on the user's local system.
- All dependencies are installed inside Docker containers via the project's Dockerfile(s).

## Testing

- **All testing must run inside Docker containers.** Do not run `pytest`, `npm test`, `vitest`, or similar directly on the host.
- Use `docker compose run` or `docker compose exec` to run tests inside the appropriate service container.
- Example: `docker compose run --rm api pytest tests/` for backend tests.

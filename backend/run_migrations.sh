#!/bin/bash
set -e

echo "==================================="
echo "Database Migration Script"
echo "==================================="

# Wait for database to be ready
echo "Waiting for database to be ready..."
max_attempts=30
attempt=0

while [ $attempt -lt $max_attempts ]; do
    if alembic current &>/dev/null; then
        echo "✓ Database is ready!"
        break
    fi
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$max_attempts: Database not ready yet, waiting..."
    sleep 2
done

if [ $attempt -eq $max_attempts ]; then
    echo "✗ Database failed to become ready after $max_attempts attempts"
    exit 1
fi

# Show current migration status
echo ""
echo "Current database version:"
alembic current

# Run migrations
echo ""
echo "Running migrations..."
alembic upgrade head

# Show final status
echo ""
echo "Migration completed successfully!"
echo "Current database version:"
alembic current

echo "==================================="

#!/usr/bin/env bash
# Applies all migrations to a fresh database in a Postgres container, then runs the RLS checks.
# Usage: supabase/tests/run.sh [container]   (container defaults to pg-wordle-test)
set -euo pipefail
CONTAINER="${1:-pg-wordle-test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB="rls_test_$$"

psql() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done
psql -c "create database $DB"
trap 'psql -c "drop database if exists $DB" >/dev/null' EXIT

psql -d "$DB" < "$ROOT/supabase/tests/auth_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql -d "$DB" < "$f"
done
OUT="$(psql -d "$DB" < "$ROOT/supabase/tests/wordle_rls_test.sql" 2>&1)"
echo "$OUT" | grep -E 'PASS|FAIL|ERROR' | sed 's/^.*NOTICE:  //'
if echo "$OUT" | grep -qE 'FAIL|ERROR'; then exit 1; fi
echo "all checks passed"

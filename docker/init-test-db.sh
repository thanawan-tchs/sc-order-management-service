#!/bin/sh
# Runs once, on first container init (docker-entrypoint-initdb.d), alongside creation of the
# main POSTGRES_DB database. Creates a second, separate database for the integration test suite
# so tests never touch dev data.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE orders_test;
EOSQL

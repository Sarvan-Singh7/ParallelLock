-- Create the application database and the test database.
-- This script runs once when the Docker volume is first initialised.
SELECT 'CREATE DATABASE parallellock'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'parallellock')\gexec

SELECT 'CREATE DATABASE parallellock_test'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'parallellock_test')\gexec

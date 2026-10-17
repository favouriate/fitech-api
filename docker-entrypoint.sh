#!/bin/sh
set -e

echo "Running database migrations..."
node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy

echo "Starting application..."
exec node dist/main.js

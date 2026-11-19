#!/bin/bash
# GenLaTeX Agent - Permission Setup
# Run this script when you need to fix permissions on data/temp directories

set -e

APP_DIR="/var/www/genlatex-agent"
MINIO_TEMP_DIR="/tmp/genlatex-projects"

echo "🔐 Setting up GenLaTeX agent permissions..."

# Agent's own data directory (checkpoints, logs, etc.)
echo "   Setting up agent data directory..."
mkdir -p "$APP_DIR/data"
sudo chown -R www-data:www-data "$APP_DIR/data"
sudo chmod -R 775 "$APP_DIR/data"

sudo chown -R genlatex-agent:genlatex-agent /var/www/genlatex/data
sudo chmod -R 775 /var/www/genlatex/data

# MinIO temp directory (for intermediary compilation)
echo "   Setting up MinIO temp directory: $MINIO_TEMP_DIR"
sudo mkdir -p "$MINIO_TEMP_DIR"
sudo chown www-data:www-data "$MINIO_TEMP_DIR"
sudo chmod 775 "$MINIO_TEMP_DIR"

echo "✅ Permissions set successfully!"

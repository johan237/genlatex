#!/bin/bash
# GenLaTeX Frontend - Permission Setup
# Run this script when you need to fix permissions on the data directory

set -e

APP_DIR="/var/www/genlatex"
DATA_DIR="$APP_DIR/data"
PROJECTS_DIR="$DATA_DIR/projects"

echo "🔐 Setting up GenLaTeX frontend permissions..."

# Ensure directories exist
mkdir -p "$PROJECTS_DIR"

# Set ownership to www-data
echo "   Setting ownership: www-data:www-data on $DATA_DIR"
sudo chown -R www-data:www-data "$DATA_DIR"

# Set permissions (755 for read access, MinIO is source of truth)
echo "   Setting permissions: 755 on $DATA_DIR"
sudo chmod -R 755 "$DATA_DIR"

echo "✅ Permissions set successfully!"

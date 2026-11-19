#!/bin/bash
set -e

echo "🚀 Starting GenLaTeX deployment..."

# -----------------------------
# CONFIG
# -----------------------------
APP_DIR="/var/www/genlatex"
DATA_DIR="$APP_DIR/data"
PROJECTS_DIR="$DATA_DIR/projects"

echo "📥 Fetching latest code from GitHub..."
git fetch origin

echo "🧹 Resetting local code to origin/main..."
git reset --hard origin/main

echo "🗑️  Cleaning untracked files..."
git clean -fd

echo "📥 Copying .env to .env.production..."
cp .env .env.production

echo "📦 Installing dependencies..."
npm install

echo "🏗️  Building application..."
rm -rf .next
npm run build

# -----------------------------
# PERMISSIONS
# -----------------------------
echo "🔐 Setting up directory permissions..."

# Ensure data directories exist
mkdir -p "$PROJECTS_DIR"

# Set ownership to www-data (Node.js process user)
# When USE_MINIO=true, this is just a local cache; MinIO is the source of truth
if [ -d "$DATA_DIR" ]; then
    echo "   Setting ownership: www-data:www-data on $DATA_DIR"
    sudo chown -R www-data:www-data "$DATA_DIR"
    sudo chmod -R 755 "$DATA_DIR"
fi

echo "🔄 Restarting GenLaTeX with PM2..."
pm2 delete genlatex || true  # Don't fail if not running
pm2 start ecosystem.config.cjs
pm2 restart genlatex --update-env

echo "✅ Deployment completed successfully!"
echo ""
echo "📋 Post-deployment checklist:"
echo "   - Verify PM2 is running: pm2 status"
echo "   - Check logs: pm2 logs genlatex"
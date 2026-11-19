#!/bin/bash
set -e

echo "🤖 Deploying genlatex-agent..."


# -----------------------------
# CONFIG
# -----------------------------
APP_DIR="/var/www/genlatex-agent"
VENV_DIR="$APP_DIR/.venv"
SERVICE_NAME="genlatex-agent"
# Temp directory for MinIO syncs (used when USE_MINIO=true)
MINIO_TEMP_DIR="/tmp/genlatex-projects"

# -----------------------------
# 1. Pull latest code
# -----------------------------
cd "$APP_DIR"
echo "📥 Fetching latest agent code..."
git fetch origin
echo "🧹 Resetting local code to origin/main..."
git reset --hard origin/main
echo "🗑️  Cleaning untracked files..."
git clean -fd

# -----------------------------
# 2. Activate virtualenv
# -----------------------------
if [ ! -d "$VENV_DIR" ]; then
  echo "🐍 Creating virtualenv..."
  python3 -m venv "$VENV_DIR"
fi

echo "🐍 Activating virtualenv..."
source "$VENV_DIR/bin/activate"

# -----------------------------
# 3. Install dependencies
# -----------------------------
echo "📚 Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# -----------------------------
# 4. Permissions (CRITICAL)
# -----------------------------
echo "🔐 Fixing filesystem permissions..."

# Agent's own data directory (for checkpoints, logs, etc.)
mkdir -p "$APP_DIR/data"
sudo chown -R www-data:www-data "$APP_DIR/data"
sudo chmod -R 775 "$APP_DIR/data"

# MinIO temp directory (used for intermediary compilation when USE_MINIO=true)
# Files are synced from MinIO -> temp, compiled, then synced back to MinIO
echo "   Setting up MinIO temp directory: $MINIO_TEMP_DIR"
sudo mkdir -p "$MINIO_TEMP_DIR"
sudo chown www-data:www-data "$MINIO_TEMP_DIR"
sudo chmod 775 "$MINIO_TEMP_DIR"

# -----------------------------
# 5. Restart service
# -----------------------------
echo "🔁 Restarting genlatex-agent service..."
sudo systemctl restart "genlatex-agent"

# -----------------------------
# 6. Health check
# -----------------------------
echo "🩺 Health check..."
sleep 2
curl -s http://127.0.0.1:8000/health || echo "⚠️  Health check failed (service may still be starting)"

echo "✅ genlatex-agent deployed successfully"
echo ""
echo "📋 Post-deployment checklist:"
echo "   - Check service status: sudo systemctl status genlatex-agent"
echo "   - Check logs: sudo journalctl -u genlatex-agent -f"
echo "   - Verify MinIO config in .env if using object storage"

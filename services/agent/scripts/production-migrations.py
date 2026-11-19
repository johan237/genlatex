#!/usr/bin/env python3
"""
Production Migrations – GenLaTeX Agent
Orchestrates all setup steps for production deployment.

Usage (from genlatex-agent/):
  python scripts/production-migrations.py

Prerequisites:
  - Copy .env.production to .env and fill in real values, OR
  - Set env vars before running

Steps run:
  1. Load .env.production
  2. Create required directories (template, checkpoints, output, data/projects, logs)
  3. Validate required env vars
  4. Verify dependencies (optional)
"""

import os
import sys
from pathlib import Path

# Add project root to path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

# Load .env.production first, then .env
def load_env():
    from dotenv import load_dotenv
    env_prod = ROOT / ".env.production"
    env_default = ROOT / ".env"
    if env_prod.exists():
        load_dotenv(env_prod)
        print("📋 Loaded .env.production")
    if env_default.exists():
        load_dotenv(env_default, override=False)
        if not env_prod.exists():
            print("📋 Loaded .env")


def create_directories():
    """Create required directories (unified under data/ for easier management)."""
    dirs = [
        "template",
        "data/checkpoints",
        "data/output",
        "data/logs",
        "data/projects",
    ]
    for d in dirs:
        p = ROOT / d
        p.mkdir(parents=True, exist_ok=True)
        print(f"   ✅ {d}")


def validate_env():
    """Validate required environment variables."""
    required = ["OPENROUTER_API_KEY"]
    optional = ["TAVILY_API_KEY", "AGENT_API_TOKEN", "GENLATEX_PROJECTS_PATH"]
    missing = [k for k in required if not os.getenv(k) or os.getenv(k).strip() in ("", "your_", "REPLACE_")]
    if missing:
        print(f"\n❌ Missing required env vars: {', '.join(missing)}")
        print("   Add them to .env or .env.production")
        return False
    for k in optional:
        v = os.getenv(k)
        if not v or (isinstance(v, str) and v.strip() in ("", "your_", "REPLACE_")):
            print(f"   ⚠️  Optional {k} not set")
    return True


def main():
    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("🚀 GenLaTeX Agent Production Migrations")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # 1. Load env
    print("📦 Step 1/3: Loading environment...")
    load_env()
    print()

    # 2. Create directories
    print("📦 Step 2/3: Creating directories...")
    create_directories()
    print()

    # 3. Validate env
    print("📦 Step 3/3: Validating environment...")
    if not validate_env():
        sys.exit(1)
    print("   ✅ Required env vars present")
    print()

    # Verify imports (optional)
    try:
        import api.main  # noqa: F401
        print("   ✅ API module loads OK")
    except Exception as e:
        print(f"   ⚠️  API import warning: {e}")
        print("   Run: pip install -r requirements.txt")

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ Production migrations complete!")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
    print("Next: python run_api.py --production")
    print("\nStorage cleanup: automatic when API runs (no cron). Manual:")
    print("  python scripts/cleanup-storage.py       # Dry run")
    print("  python scripts/cleanup-storage.py --run # Delete old files")


if __name__ == "__main__":
    main()

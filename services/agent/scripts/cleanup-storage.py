#!/usr/bin/env python3
"""
Storage Cleanup – GenLaTeX Agent
Removes old checkpoints, output files, and log backups to avoid disk bloat.

Usage (from genlatex-agent/):
  python scripts/cleanup-storage.py           # Dry run (show what would be deleted)
  python scripts/cleanup-storage.py --run   # Actually delete

Automatic cleanup runs in-process when the API is running (no cron needed).

Retention is controlled by env vars (or defaults):
  CHECKPOINT_RETENTION_DAYS=7   # Keep checkpoints for 7 days
  OUTPUT_RETENTION_DAYS=30      # Keep output dirs for 30 days
  LOG_RETENTION_DAYS=14         # Keep log backups for 14 days
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

from dotenv import load_dotenv
for p in [ROOT / ".env.production", ROOT / ".env"]:
    if p.exists():
        load_dotenv(p)
        break

from utils.storage_cleanup import (
    run_cleanup,
    CHECKPOINT_RETENTION,
    OUTPUT_RETENTION,
    LOG_RETENTION,
)


def main():
    import argparse
    p = argparse.ArgumentParser(description="Clean up old checkpoints, output, and logs")
    p.add_argument("--run", action="store_true", help="Actually delete (default: dry run)")
    args = p.parse_args()
    dry_run = not args.run

    print("\n--- GenLaTeX Agent - Storage Cleanup ---\n")
    if dry_run:
        print("(Dry run - use --run to actually delete)\n")

    total = run_cleanup(dry_run=dry_run, quiet=False)

    print(f"\nTotal: {total} item(s) {'would be removed' if dry_run else 'removed'}\n")


if __name__ == "__main__":
    main()

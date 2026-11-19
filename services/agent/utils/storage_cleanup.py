"""
Storage cleanup – removes old checkpoints, output files, and log backups.
Used by API for automatic in-process cleanup (no cron needed).
Also used by scripts/cleanup-storage.py for manual runs.
"""
import os
import shutil
from pathlib import Path
from datetime import datetime, timedelta

# Paths from env (resolve relative to cwd when module loads)
CHECKPOINT_DIR = Path(os.getenv("CHECKPOINT_DIR", "./data/checkpoints"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./data/output"))
LOG_DIR = Path(os.getenv("LOG_FILE", "./data/logs/api.log")).parent

CHECKPOINT_RETENTION = int(os.getenv("CHECKPOINT_RETENTION_DAYS", "7"))
OUTPUT_RETENTION = int(os.getenv("OUTPUT_RETENTION_DAYS", "30"))
LOG_RETENTION = int(os.getenv("LOG_RETENTION_DAYS", "14"))


def _cleanup_checkpoints(dry_run: bool, quiet: bool) -> int:
    if not CHECKPOINT_DIR.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=CHECKPOINT_RETENTION)
    removed = 0
    for f in CHECKPOINT_DIR.glob("*.json"):
        if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            if not dry_run:
                f.unlink()
            removed += 1
            if not quiet:
                print(f"   {'Would remove' if dry_run else 'Removed'}: {f.name}")
    return removed


def _cleanup_output(dry_run: bool, quiet: bool) -> int:
    if not OUTPUT_DIR.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=OUTPUT_RETENTION)
    removed = 0
    for p in list(OUTPUT_DIR.iterdir()):
        try:
            if datetime.fromtimestamp(p.stat().st_mtime) < cutoff:
                if not dry_run:
                    if p.is_dir():
                        shutil.rmtree(p)
                    else:
                        p.unlink()
                removed += 1
                if not quiet:
                    print(f"   {'Would remove' if dry_run else 'Removed'}: {p.name}{'/' if p.is_dir() else ''}")
        except OSError as e:
            if not quiet:
                print(f"   ⚠️  Skip {p.name}: {e}")
    return removed


def _cleanup_logs(dry_run: bool, quiet: bool) -> int:
    if not LOG_DIR.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=LOG_RETENTION)
    removed = 0
    for f in LOG_DIR.glob("*.log.*"):
        if f.is_file() and datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
            if not dry_run:
                f.unlink()
            removed += 1
            if not quiet:
                print(f"   {'Would remove' if dry_run else 'Removed'}: {f.name}")
    return removed


def run_cleanup(dry_run: bool = False, quiet: bool = True, log=None) -> int:
    """
    Run storage cleanup. Callable from API for automatic in-process cleanup (no cron).
    Returns total number of items removed (or would be removed if dry_run).
    """
    total = 0
    total += _cleanup_checkpoints(dry_run, quiet)
    total += _cleanup_output(dry_run, quiet)
    total += _cleanup_logs(dry_run, quiet)
    if log and total:
        log(f"Storage cleanup: {total} item(s) {'would be removed' if dry_run else 'removed'}")
    return total

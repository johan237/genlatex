"""
MinIO (S3-compatible) storage for genlatex-agent.
When USE_MINIO is set, sync project from MinIO to a local temp dir for compile/agents,
then sync results back. Object key layout matches frontend: {projectId}/{relativePath}.

Design principles:
- Singleton client with lazy initialization
- Thread-safe configuration caching
- Comprehensive error handling with logging
- Path traversal protection
- Graceful degradation on connection failures
- Per-project locking to prevent concurrent write conflicts
"""

import os
import logging
import threading
import asyncio
import time
import urllib3
from pathlib import Path
from typing import Optional, Callable, Tuple, Dict

logger = logging.getLogger(__name__)

# Thread-safe singleton state
_USE_MINIO: Optional[bool] = None
_TEMP_BASE: Optional[Path] = None
_CLIENT = None
_CLIENT_LOCK = threading.Lock()
_BUCKET_ENSURED = False

# Per-project locks to prevent concurrent writes
_PROJECT_LOCKS: Dict[str, threading.RLock] = {}
_PROJECT_LOCKS_LOCK = threading.Lock()

# Configuration
MAX_SYNC_FILES = 10000  # Maximum files to sync per project
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB max per file
LOCK_TIMEOUT = 30  # seconds to wait for project lock


def _env_bool(name: str, default: bool = False) -> bool:
    """Parse boolean environment variable."""
    v = os.getenv(name, "").strip().lower()
    return v in ("1", "true", "yes") if v else default


def is_minio_enabled() -> bool:
    """
    Check if MinIO is enabled and properly configured.
    Returns True if USE_MINIO is true and required env vars are set.
    Result is cached for performance.
    """
    global _USE_MINIO
    if _USE_MINIO is not None:
        return _USE_MINIO
    
    if not _env_bool("USE_MINIO"):
        _USE_MINIO = False
        return False
    
    endpoint = os.getenv("MINIO_ENDPOINT") or os.getenv("MINIO_HOST")
    access = os.getenv("MINIO_ACCESS_KEY")
    secret = os.getenv("MINIO_SECRET_KEY")
    
    ok = bool(endpoint and access and secret)
    _USE_MINIO = ok
    
    if not ok:
        logger.warning(
            "USE_MINIO is true but required environment variables missing. "
            "Required: MINIO_ENDPOINT (or MINIO_HOST), MINIO_ACCESS_KEY, MINIO_SECRET_KEY. "
            "MinIO disabled."
        )
    else:
        logger.info(f"[MinIO] Enabled with endpoint: {endpoint}")
    
    return _USE_MINIO


def get_minio_temp_base() -> Path:
    """
    Get base directory for synced project temp dirs.
    Uses GENLATEX_PROJECTS_TEMP_PATH or defaults to system temp.
    """
    global _TEMP_BASE
    if _TEMP_BASE is not None:
        return _TEMP_BASE
    
    base = os.getenv("GENLATEX_PROJECTS_TEMP_PATH") or os.path.join(
        os.getenv("TMPDIR", os.getenv("TEMP", "/tmp")), 
        "genlatex-projects"
    )
    _TEMP_BASE = Path(base)
    
    # Ensure directory exists
    _TEMP_BASE.mkdir(parents=True, exist_ok=True)
    
    return _TEMP_BASE


def _get_client():
    """
    Get or create MinIO client (thread-safe singleton).
    Raises ValueError if credentials are missing.
    """
    global _CLIENT, _BUCKET_ENSURED
    
    with _CLIENT_LOCK:
        if _CLIENT is not None:
            return _CLIENT
        
        from minio import Minio
        from minio.error import S3Error
        
        endpoint = (os.getenv("MINIO_ENDPOINT") or os.getenv("MINIO_HOST") or "localhost").strip()
        port = int(os.getenv("MINIO_PORT") or "9000")
        use_ssl = _env_bool("MINIO_USE_SSL")
        access = (os.getenv("MINIO_ACCESS_KEY") or "").strip()
        secret = (os.getenv("MINIO_SECRET_KEY") or "").strip()
        
        if not access or not secret:
            raise ValueError(
                "[MinIO] Configuration error: MINIO_ACCESS_KEY and MINIO_SECRET_KEY "
                "are required when USE_MINIO=true"
            )

        # Fast-fail network behavior to avoid long UX stalls when MinIO is down.
        # Override via env vars when needed for production reliability.
        try:
            connect_timeout_sec = float(os.getenv("MINIO_CONNECT_TIMEOUT_SEC", "1.5"))
        except Exception:
            connect_timeout_sec = 1.5
        try:
            read_timeout_sec = float(os.getenv("MINIO_READ_TIMEOUT_SEC", "6.0"))
        except Exception:
            read_timeout_sec = 6.0
        try:
            max_retries = int(os.getenv("MINIO_MAX_RETRIES", "0"))
        except Exception:
            max_retries = 0

        http_client = urllib3.PoolManager(
            timeout=urllib3.Timeout(connect=connect_timeout_sec, read=read_timeout_sec),
            retries=urllib3.Retry(
                total=max_retries,
                connect=max_retries,
                read=max_retries,
                redirect=0,
                status=0,
                backoff_factor=0.0
            )
        )
        
        _CLIENT = Minio(
            f"{endpoint}:{port}",
            access_key=access,
            secret_key=secret,
            secure=use_ssl,
            http_client=http_client,
        )
        
        protocol = "https" if use_ssl else "http"
        logger.info(f"[MinIO] Client initialized: {protocol}://{endpoint}:{port}")
        
        # Ensure bucket exists on first client creation
        if not _BUCKET_ENSURED:
            bucket = get_bucket()
            try:
                if not _CLIENT.bucket_exists(bucket):
                    _CLIENT.make_bucket(bucket)
                    logger.info(f"[MinIO] Bucket '{bucket}' created")
                _BUCKET_ENSURED = True
            except S3Error as e:
                logger.warning(f"[MinIO] Could not ensure bucket '{bucket}': {e}")
                # Don't fail - bucket might already exist
                _BUCKET_ENSURED = True
        
        return _CLIENT


def get_bucket() -> str:
    """Get configured bucket name."""
    return os.getenv("MINIO_BUCKET") or "genlatex-projects"


def _get_project_lock(project_id: str) -> threading.RLock:
    """
    Get or create a per-project lock.
    Uses RLock so the same thread can acquire multiple times (for nested operations).
    """
    with _PROJECT_LOCKS_LOCK:
        if project_id not in _PROJECT_LOCKS:
            _PROJECT_LOCKS[project_id] = threading.RLock()
        return _PROJECT_LOCKS[project_id]


def acquire_project_lock(project_id: str, timeout: float = LOCK_TIMEOUT) -> bool:
    """
    Acquire a project lock with timeout.
    Returns True if lock acquired, False if timeout.
    Use this when you need explicit control over locking.
    """
    lock = _get_project_lock(project_id)
    return lock.acquire(timeout=timeout)


def release_project_lock(project_id: str) -> None:
    """Release a project lock."""
    lock = _get_project_lock(project_id)
    try:
        lock.release()
    except RuntimeError:
        # Lock was not acquired by this thread
        pass


def _sanitize_project_id(project_id: str) -> str:
    """
    Sanitize project ID to prevent path traversal.
    Removes any path separators and validates format.
    """
    if not project_id or not isinstance(project_id, str):
        raise ValueError("[MinIO] Invalid project_id: must be a non-empty string")
    
    # Remove path separators
    sanitized = project_id.replace("/", "").replace("\\", "").replace("..", "")
    
    if sanitized != project_id:
        logger.warning(f"[MinIO] Project ID sanitized: {project_id} -> {sanitized}")
    
    return sanitized


def sync_project_from_minio(project_id: str, local_dir: Path) -> Tuple[int, int]:
    """
    Sync project from MinIO bucket prefix project_id/ to local_dir.
    Object keys: project_id/relativePath -> local_dir/relativePath.
    
    Args:
        project_id: Project identifier
        local_dir: Local directory to sync to
        
    Returns:
        Tuple of (synced_count, error_count)
    """
    project_id = _sanitize_project_id(project_id)
    client = _get_client()
    bucket = get_bucket()
    prefix = f"{project_id}/"
    local_dir = Path(local_dir)
    local_dir.mkdir(parents=True, exist_ok=True)
    
    synced = 0
    errors = 0
    
    try:
        objects = list(client.list_objects(bucket, prefix=prefix, recursive=True))
    except Exception as e:
        logger.warning("[MinIO] list_objects failed for %s (bucket may be empty): %s", project_id, e)
        return (0, 0)
    
    # Limit number of files to prevent DoS
    if len(objects) > MAX_SYNC_FILES:
        logger.warning(
            "[MinIO] Project %s has %d objects, limiting to %d",
            project_id, len(objects), MAX_SYNC_FILES
        )
        objects = objects[:MAX_SYNC_FILES]
    
    for obj in objects:
        key = getattr(obj, "object_name", None) or getattr(obj, "key", None)
        if not key or not key.startswith(prefix):
            continue
        
        rel = key[len(prefix):].lstrip("/")
        if not rel:
            continue
        
        # Security: validate path doesn't escape local directory
        local_path = local_dir / rel.replace("/", os.sep)
        try:
            # Resolve to catch symlink attacks
            resolved = local_path.resolve()
            if not str(resolved).startswith(str(local_dir.resolve())):
                logger.warning("[MinIO] Skipping suspicious path: %s", rel)
                errors += 1
                continue
        except (OSError, ValueError):
            logger.warning("[MinIO] Invalid path: %s", rel)
            errors += 1
            continue
        
        try:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Check file size before downloading
            obj_size = getattr(obj, "size", 0) or 0
            if obj_size > MAX_FILE_SIZE:
                logger.warning("[MinIO] Skipping large file %s (%d bytes)", key, obj_size)
                errors += 1
                continue
            
            resp = client.get_object(bucket, key)
            try:
                data = resp.read()
            finally:
                resp.close()
                resp.release_conn()
            
            local_path.write_bytes(data)
            synced += 1
            
        except Exception as e:
            logger.warning("[MinIO] get_object %s failed: %s", key, e)
            errors += 1
    
    if synced > 0 or errors > 0:
        logger.info(
            "[MinIO] Synced project %s from bucket to %s (%d objects, %d errors)",
            project_id, local_dir, synced, errors
        )
    
    return (synced, errors)


def sync_project_to_minio(project_id: str, local_dir: Path) -> Tuple[int, int]:
    """
    Sync local_dir to MinIO bucket prefix project_id/.
    local_dir/relativePath -> project_id/relativePath.
    
    Args:
        project_id: Project identifier
        local_dir: Local directory to sync from
        
    Returns:
        Tuple of (synced_count, error_count)
    """
    project_id = _sanitize_project_id(project_id)
    client = _get_client()
    bucket = get_bucket()
    local_dir = Path(local_dir)
    
    if not local_dir.exists():
        return (0, 0)
    
    prefix_len = len(str(local_dir)) + 1
    synced = 0
    errors = 0
    file_count = 0
    
    for root, _dirs, files in os.walk(local_dir):
        for name in files:
            # Skip hidden files, temp files, and lock files
            if name.startswith(".") or name.endswith(".tmp") or name.endswith(".lock"):
                continue
            
            file_count += 1
            if file_count > MAX_SYNC_FILES:
                logger.warning(
                    "[MinIO] Project %s has too many files, stopping at %d",
                    project_id, MAX_SYNC_FILES
                )
                break
            
            full = Path(root) / name
            
            try:
                # Check file size
                file_size = full.stat().st_size
                if file_size > MAX_FILE_SIZE:
                    logger.warning("[MinIO] Skipping large file %s (%d bytes)", full, file_size)
                    errors += 1
                    continue
                
                rel = str(full)[prefix_len:].replace("\\", "/")
                key = f"{project_id}/{rel}"
                
                client.fput_object(bucket, key, str(full))
                synced += 1
                
            except Exception as e:
                logger.warning("[MinIO] fput_object %s failed: %s", name, e)
                errors += 1
        
        if file_count > MAX_SYNC_FILES:
            break
    
    if synced > 0 or errors > 0:
        logger.info(
            "[MinIO] Synced project %s from %s to bucket (%d objects, %d errors)",
            project_id, local_dir, synced, errors
        )
    
    return (synced, errors)


def resolve_project_path(
    project_path: Optional[str],
    project_id: Optional[str],
) -> Tuple[Path, Optional[Callable[[], None]]]:
    """
    Resolve project path for use by compile/agents.

    When USE_MINIO=true:
        - ALWAYS sync from MinIO to a temp directory for operations
        - Return cleanup callback that syncs changes back to MinIO
        - Local filesystem paths are ignored; MinIO is the source of truth

    When USE_MINIO=false:
        - Use local filesystem directly
        - No sync operations needed

    Args:
        project_path: Optional path to project directory (used to extract project_id)
        project_id: Optional project identifier

    Returns:
        Tuple of (effective_path, cleanup_callable or None)
        Call cleanup_callable when done (e.g. in finally) to sync temp back to MinIO.

    Raises:
        ValueError: If neither project_path nor project_id is provided
    """
    path_obj = Path(project_path) if project_path else None
    pid = project_id

    # Extract project_id from path if not provided
    # e.g. /var/lib/genlatex/data/projects/abc-123 -> abc-123
    if not pid and path_obj and path_obj.name:
        pid = path_obj.name

    # Sanitize project_id if we have one
    if pid:
        try:
            pid = _sanitize_project_id(pid)
        except ValueError as e:
            logger.warning("Invalid project_id: %s", e)
            pid = None

    # =========================================================================
    # MINIO MODE: Always use temp directory, sync from/to MinIO
    # Uses per-project locking to prevent concurrent request conflicts
    # =========================================================================
    if is_minio_enabled():
        if not pid:
            raise ValueError(
                "[MinIO] project_id is required when USE_MINIO=true. "
                "Cannot resolve project path without project_id."
            )

        temp_base = get_minio_temp_base()
        temp_dir = temp_base / pid

        # Acquire per-project lock to prevent concurrent writes
        project_lock = _get_project_lock(pid)
        lock_acquired = project_lock.acquire(timeout=LOCK_TIMEOUT)

        if not lock_acquired:
            logger.warning("[MinIO] Timeout waiting for project lock: %s", pid)
            raise ValueError(f"[MinIO] Project {pid} is currently being modified. Please try again.")

        try:
            synced, errors = sync_project_from_minio(pid, temp_dir)

            # Create cleanup callback that syncs back to MinIO AND releases lock
            def cleanup() -> None:
                try:
                    sync_project_to_minio(pid, temp_dir)
                    logger.info("[MinIO] Synced project %s back to MinIO", pid)
                except Exception as e:
                    logger.error("[MinIO] Sync back failed for %s: %s", pid, e)
                finally:
                    # Always release the project lock
                    try:
                        project_lock.release()
                        logger.debug("[MinIO] Released project lock for %s", pid)
                    except RuntimeError:
                        pass  # Lock not held

            logger.info(
                "[MinIO] Project %s synced to temp dir %s (%d files, %d errors)",
                pid, temp_dir, synced, errors
            )
            return temp_dir, cleanup

        except Exception as e:
            # Release lock on error
            try:
                project_lock.release()
            except RuntimeError:
                pass
            logger.error("[MinIO] Failed to sync project %s from MinIO: %s", pid, e)
            raise ValueError(f"[MinIO] Could not sync project from MinIO: {e}")

    # =========================================================================
    # LOCAL MODE: Use filesystem directly (USE_MINIO=false)
    # =========================================================================

    # Strategy 1: If local path exists, use it directly
    if path_obj and path_obj.exists():
        logger.debug("[Local] Using existing path: %s", path_obj)
        return path_obj, None

    # Strategy 2: Fallback to GENLATEX_PROJECTS_PATH + project_id
    base = os.getenv("GENLATEX_PROJECTS_PATH", ".")
    if pid:
        fallback = Path(base) / pid
        try:
            fallback.mkdir(parents=True, exist_ok=True)
            logger.debug("[Local] Using fallback path: %s", fallback)
            return fallback, None
        except OSError as e:
            logger.warning("[Local] Could not create fallback directory %s: %s", fallback, e)

    # Strategy 3: Last resort - create at provided path
    if path_obj:
        try:
            path_obj.mkdir(parents=True, exist_ok=True)
            logger.debug("[Local] Created directory at provided path: %s", path_obj)
            return path_obj, None
        except OSError as e:
            logger.error("[Local] Could not create directory %s: %s", path_obj, e)
            raise ValueError(f"Could not create project directory: {e}")

    raise ValueError(
        "project_path or project_id required to resolve project location"
    )


def health_check() -> dict:
    """
    Check MinIO connectivity and configuration.
    Returns a dict with status information for health endpoints.
    
    Returns:
        dict with keys: enabled, connected, bucket, error (if any)
    """
    result = {
        "enabled": is_minio_enabled(),
        "connected": False,
        "bucket": get_bucket() if is_minio_enabled() else None,
        "error": None
    }
    
    if not result["enabled"]:
        return result
    
    try:
        client = _get_client()
        bucket = get_bucket()
        
        # Try to check if bucket exists (lightweight operation)
        result["connected"] = client.bucket_exists(bucket)
        
        if not result["connected"]:
            result["error"] = f"Bucket '{bucket}' does not exist"
            
    except Exception as e:
        result["error"] = str(e)
    
    return result


def reset_client() -> None:
    """
    Reset the MinIO client singleton.
    Useful for testing or when configuration changes.
    """
    global _CLIENT, _BUCKET_ENSURED, _USE_MINIO, _TEMP_BASE
    
    with _CLIENT_LOCK:
        _CLIENT = None
        _BUCKET_ENSURED = False
    
    _USE_MINIO = None
    _TEMP_BASE = None
    
    logger.info("[MinIO] Client reset")

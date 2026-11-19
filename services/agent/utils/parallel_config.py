"""
Central parallelization config. Adaptive sizing: never exceed actual workload.
Use get_effective_concurrent() to ensure we don't over-subdivide when n < env_value.

Env vars: PARALLEL_MAX_CONCURRENT, PARALLEL_SECTION_BATCHES, PARALLEL_SECTION_BATCH_SIZE,
PARALLEL_FIELD_ENFORCEMENT_CONCURRENT, PARALLEL_WRITE_CONCURRENT, PARALLEL_HUMANIZE_CONCURRENT,
PARALLEL_VERIFY_CONCURRENT.
"""
import os


def get_effective_concurrent(env_key: str, default: int, actual_count: int) -> int:
    """Return min(env_value, actual_count). Ensures we don't over-subdivide.
    If actual_count is 0, returns 1 to avoid division issues."""
    val = int(os.getenv(env_key, str(default)))
    return max(1, min(val, actual_count)) if actual_count > 0 else 1


def get_parallel_config() -> dict:
    """Return all parallel config values from environment."""
    return {
        'max_concurrent': int(os.getenv('PARALLEL_MAX_CONCURRENT', '10')),
        'section_batches': int(os.getenv('PARALLEL_SECTION_BATCHES', '2')),
        'section_batch_size': int(os.getenv('PARALLEL_SECTION_BATCH_SIZE', '3')),
        'field_enforcement_concurrent': int(os.getenv('PARALLEL_FIELD_ENFORCEMENT_CONCURRENT', '5')),
        'write_concurrent': int(os.getenv('PARALLEL_WRITE_CONCURRENT', '3')),
        'humanize_concurrent': int(os.getenv('PARALLEL_HUMANIZE_CONCURRENT', '5')),
        'verify_concurrent': int(os.getenv('PARALLEL_VERIFY_CONCURRENT', '2')),
    }

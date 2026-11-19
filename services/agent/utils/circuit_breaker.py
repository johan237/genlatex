"""
Circuit Breaker Pattern Implementation

Prevents cascading failures when external services are down.
Instead of waiting for timeouts on every request, the circuit breaker
"trips" after a threshold of failures and fails fast.

States:
- CLOSED: Normal operation, requests go through
- OPEN: Service is down, requests fail immediately
- HALF_OPEN: Testing if service recovered, allows one request through

Usage:
    breaker = CircuitBreaker("tavily", failure_threshold=5, recovery_timeout=60)

    try:
        result = breaker.call(lambda: requests.get(url, timeout=30))
    except CircuitOpenError:
        # Service is known to be down, use fallback
        result = use_fallback()
"""

import time
import threading
import logging
from typing import Callable, TypeVar, Optional, Dict, Any
from enum import Enum
from dataclasses import dataclass, field
from functools import wraps

logger = logging.getLogger(__name__)

T = TypeVar('T')


class CircuitState(Enum):
    """Circuit breaker states"""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing fast
    HALF_OPEN = "half_open"  # Testing recovery


class CircuitOpenError(Exception):
    """Raised when circuit is open and request is rejected"""
    def __init__(self, service_name: str, time_until_retry: float):
        self.service_name = service_name
        self.time_until_retry = time_until_retry
        super().__init__(
            f"Circuit breaker open for '{service_name}'. "
            f"Retry in {time_until_retry:.1f} seconds."
        )


@dataclass
class CircuitBreakerStats:
    """Statistics for monitoring circuit breaker health"""
    total_calls: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    rejected_calls: int = 0  # Calls rejected due to open circuit
    last_failure_time: Optional[float] = None
    last_success_time: Optional[float] = None
    current_state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    consecutive_successes: int = 0


class CircuitBreaker:
    """
    Circuit breaker for external service calls.

    Args:
        name: Service name for logging
        failure_threshold: Number of failures before opening circuit (default: 5)
        recovery_timeout: Seconds to wait before trying again (default: 60)
        success_threshold: Successes needed in half-open to close (default: 2)
        timeout_counts_as_failure: Whether timeouts count as failures (default: True)
    """

    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        success_threshold: int = 2,
        timeout_counts_as_failure: bool = True
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.success_threshold = success_threshold
        self.timeout_counts_as_failure = timeout_counts_as_failure

        self._state = CircuitState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time: Optional[float] = None
        self._last_state_change_time = time.time()
        self._lock = threading.RLock()

        # Statistics
        self._stats = CircuitBreakerStats()

    @property
    def state(self) -> CircuitState:
        """Get current state, checking for automatic recovery"""
        with self._lock:
            if self._state == CircuitState.OPEN:
                # Check if recovery timeout has passed
                if self._last_failure_time:
                    elapsed = time.time() - self._last_failure_time
                    if elapsed >= self.recovery_timeout:
                        self._transition_to(CircuitState.HALF_OPEN)
            return self._state

    @property
    def stats(self) -> CircuitBreakerStats:
        """Get current statistics"""
        with self._lock:
            self._stats.current_state = self._state
            self._stats.consecutive_failures = self._failure_count
            self._stats.consecutive_successes = self._success_count
            return self._stats

    def _transition_to(self, new_state: CircuitState):
        """Transition to a new state"""
        old_state = self._state
        self._state = new_state
        self._last_state_change_time = time.time()

        if new_state == CircuitState.CLOSED:
            self._failure_count = 0
            self._success_count = 0
        elif new_state == CircuitState.HALF_OPEN:
            self._success_count = 0

        logger.info(
            f"Circuit breaker '{self.name}' transitioned: {old_state.value} -> {new_state.value}"
        )

    def _record_success(self):
        """Record a successful call"""
        with self._lock:
            self._stats.total_calls += 1
            self._stats.successful_calls += 1
            self._stats.last_success_time = time.time()
            self._failure_count = 0
            self._success_count += 1

            if self._state == CircuitState.HALF_OPEN:
                if self._success_count >= self.success_threshold:
                    self._transition_to(CircuitState.CLOSED)
                    logger.info(f"Circuit breaker '{self.name}' recovered - service is healthy")

    def _record_failure(self, error: Exception):
        """Record a failed call"""
        with self._lock:
            self._stats.total_calls += 1
            self._stats.failed_calls += 1
            self._stats.last_failure_time = time.time()
            self._last_failure_time = time.time()
            self._failure_count += 1
            self._success_count = 0

            if self._state == CircuitState.HALF_OPEN:
                # Any failure in half-open goes back to open
                self._transition_to(CircuitState.OPEN)
                logger.warning(
                    f"Circuit breaker '{self.name}' re-opened after failed recovery test: {error}"
                )
            elif self._state == CircuitState.CLOSED:
                if self._failure_count >= self.failure_threshold:
                    self._transition_to(CircuitState.OPEN)
                    logger.warning(
                        f"Circuit breaker '{self.name}' opened after {self._failure_count} failures: {error}"
                    )

    def is_open(self) -> bool:
        """Check if circuit is open (rejecting requests)"""
        return self.state == CircuitState.OPEN

    def is_closed(self) -> bool:
        """Check if circuit is closed (allowing requests)"""
        return self.state == CircuitState.CLOSED

    def time_until_retry(self) -> float:
        """Get seconds until circuit will try again (0 if not open)"""
        with self._lock:
            if self._state != CircuitState.OPEN or not self._last_failure_time:
                return 0.0
            elapsed = time.time() - self._last_failure_time
            remaining = self.recovery_timeout - elapsed
            return max(0.0, remaining)

    def call(self, func: Callable[[], T], *args, **kwargs) -> T:
        """
        Execute function through circuit breaker.

        Args:
            func: Function to execute
            *args, **kwargs: Arguments to pass to function

        Returns:
            Function result

        Raises:
            CircuitOpenError: If circuit is open
            Exception: Any exception from the function
        """
        current_state = self.state

        # Check if we should reject the request
        if current_state == CircuitState.OPEN:
            with self._lock:
                self._stats.rejected_calls += 1
            raise CircuitOpenError(self.name, self.time_until_retry())

        # Execute the function
        try:
            if args or kwargs:
                result = func(*args, **kwargs)
            else:
                result = func()
            self._record_success()
            return result
        except Exception as e:
            # Check if this is a timeout-like error
            is_timeout = (
                'timeout' in str(e).lower() or
                'timed out' in str(e).lower() or
                type(e).__name__ in ('Timeout', 'TimeoutError', 'ReadTimeout', 'ConnectTimeout')
            )

            if is_timeout and not self.timeout_counts_as_failure:
                # Don't count timeouts as circuit-breaking failures
                self._stats.total_calls += 1
                self._stats.failed_calls += 1
            else:
                self._record_failure(e)
            raise

    async def call_async(self, func: Callable[[], T], *args, **kwargs) -> T:
        """
        Execute async function through circuit breaker.

        Args:
            func: Async function to execute
            *args, **kwargs: Arguments to pass to function

        Returns:
            Function result

        Raises:
            CircuitOpenError: If circuit is open
            Exception: Any exception from the function
        """
        current_state = self.state

        if current_state == CircuitState.OPEN:
            with self._lock:
                self._stats.rejected_calls += 1
            raise CircuitOpenError(self.name, self.time_until_retry())

        try:
            if args or kwargs:
                result = await func(*args, **kwargs)
            else:
                result = await func()
            self._record_success()
            return result
        except Exception as e:
            is_timeout = (
                'timeout' in str(e).lower() or
                'timed out' in str(e).lower() or
                type(e).__name__ in ('Timeout', 'TimeoutError', 'ReadTimeout', 'ConnectTimeout')
            )

            if is_timeout and not self.timeout_counts_as_failure:
                self._stats.total_calls += 1
                self._stats.failed_calls += 1
            else:
                self._record_failure(e)
            raise

    def reset(self):
        """Manually reset circuit to closed state"""
        with self._lock:
            self._transition_to(CircuitState.CLOSED)
            self._failure_count = 0
            self._success_count = 0
            self._last_failure_time = None
            logger.info(f"Circuit breaker '{self.name}' manually reset")


class CircuitBreakerRegistry:
    """
    Registry for managing multiple circuit breakers.

    Usage:
        registry = CircuitBreakerRegistry()

        # Get or create a circuit breaker
        breaker = registry.get("tavily", failure_threshold=5)

        # Use it
        result = breaker.call(lambda: api_call())
    """

    _instance: Optional['CircuitBreakerRegistry'] = None
    _lock = threading.Lock()

    def __new__(cls):
        """Singleton pattern"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._breakers: Dict[str, CircuitBreaker] = {}
                    cls._instance._breakers_lock = threading.RLock()
        return cls._instance

    def get(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 60.0,
        success_threshold: int = 2
    ) -> CircuitBreaker:
        """
        Get or create a circuit breaker by name.

        Args:
            name: Service name
            failure_threshold: Failures before opening (only used on creation)
            recovery_timeout: Recovery wait time (only used on creation)
            success_threshold: Successes to close (only used on creation)

        Returns:
            CircuitBreaker instance
        """
        with self._breakers_lock:
            if name not in self._breakers:
                self._breakers[name] = CircuitBreaker(
                    name=name,
                    failure_threshold=failure_threshold,
                    recovery_timeout=recovery_timeout,
                    success_threshold=success_threshold
                )
                logger.info(f"Created circuit breaker for '{name}'")
            return self._breakers[name]

    def get_all_stats(self) -> Dict[str, CircuitBreakerStats]:
        """Get statistics for all circuit breakers"""
        with self._breakers_lock:
            return {name: breaker.stats for name, breaker in self._breakers.items()}

    def reset_all(self):
        """Reset all circuit breakers"""
        with self._breakers_lock:
            for breaker in self._breakers.values():
                breaker.reset()

    def get_status_summary(self) -> Dict[str, Any]:
        """Get a summary of all circuit breaker statuses"""
        with self._breakers_lock:
            summary = {
                "total_breakers": len(self._breakers),
                "open_breakers": [],
                "half_open_breakers": [],
                "closed_breakers": [],
                "breakers": {}
            }

            for name, breaker in self._breakers.items():
                state = breaker.state
                stats = breaker.stats

                breaker_info = {
                    "state": state.value,
                    "total_calls": stats.total_calls,
                    "failed_calls": stats.failed_calls,
                    "rejected_calls": stats.rejected_calls,
                    "success_rate": (
                        stats.successful_calls / stats.total_calls * 100
                        if stats.total_calls > 0 else 100.0
                    ),
                    "time_until_retry": breaker.time_until_retry()
                }

                summary["breakers"][name] = breaker_info

                if state == CircuitState.OPEN:
                    summary["open_breakers"].append(name)
                elif state == CircuitState.HALF_OPEN:
                    summary["half_open_breakers"].append(name)
                else:
                    summary["closed_breakers"].append(name)

            return summary


# Global registry instance
circuit_registry = CircuitBreakerRegistry()


def with_circuit_breaker(
    service_name: str,
    failure_threshold: int = 5,
    recovery_timeout: float = 60.0
):
    """
    Decorator to wrap a function with circuit breaker protection.

    Usage:
        @with_circuit_breaker("tavily", failure_threshold=5, recovery_timeout=60)
        def search_tavily(query):
            return requests.get(f"https://api.tavily.com/search?q={query}")
    """
    def decorator(func: Callable) -> Callable:
        breaker = circuit_registry.get(
            service_name,
            failure_threshold=failure_threshold,
            recovery_timeout=recovery_timeout
        )

        @wraps(func)
        def wrapper(*args, **kwargs):
            return breaker.call(lambda: func(*args, **kwargs))

        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            return await breaker.call_async(lambda: func(*args, **kwargs))

        # Return appropriate wrapper based on function type
        import asyncio
        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return wrapper

    return decorator

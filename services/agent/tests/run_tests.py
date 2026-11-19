#!/usr/bin/env python3
"""
Test runner for GenLaTeX Agent test suite
"""

import sys
import subprocess
import argparse
from pathlib import Path


def run_tests(test_type: str = "all", verbose: bool = False, coverage: bool = True):
    """Run tests with specified options"""
    
    # Base pytest command
    cmd = ["python", "-m", "pytest"]
    
    # Add test type specific options
    if test_type == "unit":
        cmd.extend(["tests/unit", "-m", "unit"])
    elif test_type == "integration":
        cmd.extend(["tests/integration", "-m", "integration"])
    elif test_type == "api":
        cmd.extend(["tests/api", "-m", "api"])
    elif test_type == "performance":
        cmd.extend(["tests/performance", "-m", "performance"])
    else:
        cmd.extend(["tests/"])
    
    # Add common options
    if verbose:
        cmd.append("-v")
    
    if coverage:
        cmd.extend([
            "--cov=.",
            "--cov-report=html:htmlcov",
            "--cov-report=term-missing",
            "--cov-fail-under=80"
        ])
    
    # Add other useful options
    cmd.extend([
        "--tb=short",
        "--strict-markers",
        "--disable-warnings",
        "--color=yes",
        "--durations=10"
    ])
    
    print(f"Running command: {' '.join(cmd)}")
    
    # Run tests
    result = subprocess.run(cmd, cwd=Path(__file__).parent.parent)
    
    return result.returncode


def main():
    """Main test runner"""
    parser = argparse.ArgumentParser(description="Run GenLaTeX Agent tests")
    parser.add_argument(
        "--type", 
        choices=["all", "unit", "integration", "api", "performance"],
        default="all",
        help="Type of tests to run"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )
    parser.add_argument(
        "--no-coverage",
        action="store_true",
        help="Disable coverage reporting"
    )
    
    args = parser.parse_args()
    
    # Run tests
    exit_code = run_tests(
        test_type=args.type,
        verbose=args.verbose,
        coverage=not args.no_coverage
    )
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()

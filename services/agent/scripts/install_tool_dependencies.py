#!/usr/bin/env python3
"""
Install system and Python dependencies required for all public tools:
- Pandoc (Word to LaTeX)
- Python deps: openpyxl (Excel in table-to-latex), pdfplumber, pandas, arxiv, httpx (already in requirements.txt)

Run from genlatex-agent directory: python scripts/install_tool_dependencies.py
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def has_pandoc() -> bool:
    return shutil.which("pandoc") is not None


def install_pandoc_windows() -> bool:
    """Try winget first, then choco."""
    for cmd in [
        ["winget", "install", "--id", "JohnMacFarlane.Pandoc", "-e", "--accept-source-agreements", "--accept-package-agreements"],
        ["choco", "install", "pandoc", "-y"],
    ]:
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=120)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
            continue
    return False


def install_pandoc_mac() -> bool:
    try:
        subprocess.run(["brew", "install", "pandoc"], check=True, capture_output=True, timeout=120)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


def install_pandoc_linux() -> bool:
    try:
        subprocess.run(["apt-get", "update", "-qq"], check=True, capture_output=True, timeout=60)
        subprocess.run(["apt-get", "install", "-y", "pandoc"], check=True, capture_output=True, timeout=120)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    try:
        subprocess.run(["dnf", "install", "-y", "pandoc"], check=True, capture_output=True, timeout=120)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    try:
        subprocess.run(["yum", "install", "-y", "pandoc"], check=True, capture_output=True, timeout=120)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return False


def main():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)

    print("Installing Python dependencies for tools (openpyxl, etc.)...")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "openpyxl", "pdfplumber", "pandas", "arxiv", "httpx"],
            check=True,
            capture_output=False,
        )
    except subprocess.CalledProcessError as e:
        print("pip install failed:", e)
        sys.exit(1)

    if has_pandoc():
        print("Pandoc is already installed.")
        return 0

    print("Pandoc not found. Attempting to install...")
    if sys.platform == "win32":
        ok = install_pandoc_windows()
    elif sys.platform == "darwin":
        ok = install_pandoc_mac()
    else:
        ok = install_pandoc_linux()

    if ok:
        print("Pandoc installed successfully.")
    else:
        print()
        print("Could not install Pandoc automatically. Install it manually:")
        if sys.platform == "win32":
            print("  - winget install JohnMacFarlane.Pandoc")
            print("  - or: choco install pandoc")
            print("  - or download: https://pandoc.org/installing.html")
        elif sys.platform == "darwin":
            print("  - brew install pandoc")
        else:
            print("  - sudo apt-get install pandoc   (Debian/Ubuntu)")
            print("  - sudo dnf install pandoc       (Fedora)")
        print()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

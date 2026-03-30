#!/usr/bin/env bash
set -euo pipefail

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this inside your git repository clone." >&2
  exit 1
fi

if ! command -v python >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
  echo "python is required to install pre-commit" >&2
  exit 1
fi

if ! command -v pre-commit >/dev/null 2>&1; then
  if command -v python >/dev/null 2>&1; then
    python -m pip install pre-commit
  else
    python3 -m pip install pre-commit
  fi
fi

pre-commit install

if [ ! -f .secrets.baseline ]; then
  detect-secrets scan > .secrets.baseline || true
fi

echo "Installed pre-commit hook via .pre-commit-config.yaml"
echo "Run pre-commit run --all-files to validate current tree"

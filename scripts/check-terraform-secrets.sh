#!/usr/bin/env bash
set -euo pipefail

# Blocks Terraform patterns that would persist plaintext credentials in state.
# Scope is intentionally narrow and policy-driven for this repository.

if [ "$#" -eq 0 ]; then
  exit 0
fi

fail=0

for file in "$@"; do
  case "$file" in
    *.tf)
      if [ ! -f "$file" ]; then
        continue
      fi

      if matches=$(grep -nE '^[[:space:]]*password[[:space:]]*=' "$file"); then
        echo "[terraform-secret-safety] blocked: password assignment found in $file"
        echo "  Reason: password values assigned in Terraform are persisted in state."
        echo "  Fix: use AWS-managed credentials (for example manage_master_user_password) and secret references."
        echo "  Offending lines:"
        echo "$matches" | sed 's/^/    /'
        fail=1
      fi

      if matches=$(grep -nE '^[[:space:]]*resource[[:space:]]+"random_password"[[:space:]]+"' "$file"); then
        echo "[terraform-secret-safety] blocked: random_password resource found in $file"
        echo "  Reason: generated secrets from random_password are persisted in state."
        echo "  Fix: prefer cloud-managed secret generation/rotation and reference ARNs at runtime."
        echo "  Offending lines:"
        echo "$matches" | sed 's/^/    /'
        fail=1
      fi
      ;;
  esac
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi

exit 0

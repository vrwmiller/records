# Backend Dependency Patch Runbook

## Purpose

Patch a vulnerable or outdated Python dependency in the FastAPI backend, validate, and redeploy.

## Preconditions

1. **Virtual environment active** — all commands assume the venv is active. Use the repo helper (preferred, sets all required env vars) or activate directly if the venv already exists:

   ```bash
   # Preferred: sources env vars and activates venv/
   source env.sh

   # Or, activate directly if already set up:
   source ./venv/bin/activate
   python --version
   ```

2. **Working tree clean** — confirm no uncommitted changes before starting:

   ```bash
   git status
   ```

3. **Branch** — never patch directly on `main`. Create a fix branch:

   ```bash
   git checkout -b fix/pip-<package-name>-patch
   ```

## Identify Vulnerable Packages

Run pip-audit from the project root (install if not present):

```bash
pip install pip-audit
pip-audit -r requirements.txt
```

This checks all pinned packages against the OSV and PyPI advisory databases. For a summary:

```bash
pip-audit -r requirements.txt --format=json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for dep in data.get('dependencies', []):
    for vuln in dep.get('vulns', []):
        print(dep['name'], dep['version'], vuln['id'], vuln['fix_versions'])
"
```

## Patch

1. Identify the safe target version from the audit output or upstream advisory.
2. Update the pinned version in `requirements.txt`:

   ```
   <package>==<safe-version>
   ```

3. Install the updated dependency:

   ```bash
   pip install -r requirements.txt
   ```

4. Re-run audit to confirm the finding is resolved:

   ```bash
   pip-audit -r requirements.txt
   ```

## Verify

1. Run the test suite:

   ```bash
   pytest
   ```

2. Start the server and confirm it starts cleanly:

   ```bash
   DATABASE_URL=postgresql://x:x@localhost/x \
   COGNITO_USER_POOL_ID=us-east-1_test \
   COGNITO_CLIENT_ID=testclient \
   uvicorn app.main:app --reload
   ```

   The health endpoint should return `{"status": "ok"}`:

   ```bash
   curl http://127.0.0.1:8000/api/health
   ```

## Commit and Deploy

1. Stage the requirements change:

   ```bash
   git add requirements.txt
   git commit -m "fix: patch <package-name> to <safe-version>"
   ```

2. Open a PR following the standard workflow. Include in the PR body:
   - CVE or advisory reference
   - Package and version before → after
   - `pip-audit` output confirming clean
   - Test pass confirmation

3. After merge, redeploy the backend server (deployment target TBD — steps will be added when the hosting target is defined).

## Risks and Notes

- Python packages run live on the server. A vulnerable dependency is exploitable until the server process is restarted with the patched version installed.
- Verify that the patched version does not introduce a breaking API change before deploying to any shared environment.
- `boto3` and `botocore` advisories should also be checked at https://github.com/boto/boto3/security/advisories and https://github.com/boto/botocore/security/advisories.
- `python-jose` (JWT handling) is a high-sensitivity package — treat any advisory against it as urgent.

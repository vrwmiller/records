# Frontend Dependency Patch Runbook

## Purpose

Patch a vulnerable or outdated npm dependency in the React frontend, rebuild the static assets, and redeploy.

## Preconditions

1. **Node via nvm** — nvm must be loaded before running any `npm` commands:

   ```bash
   . ~/.nvm/nvm.sh
   node --version
   ```

2. **Working tree clean** — confirm no uncommitted changes before starting:

   ```bash
   git status
   ```

3. **Branch** — never patch directly on `main`. Create a fix branch:

   ```bash
   git checkout -b fix/npm-<package-name>-patch
   ```

## Identify Vulnerable Packages

Run the npm audit report from the `ui/` directory:

```bash
cd ui
npm audit
```

For a machine-readable summary:

```bash
npm audit --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
for name, v in data.get('vulnerabilities', {}).items():
    print(v['severity'].upper(), name, v.get('fixAvailable'))
"
```

## Patch

### Automatic fix (safe upgrades only)

```bash
npm audit fix
```

This updates `package.json` and `package-lock.json` without breaking semver ranges.

### Manual fix (breaking change or transitive-only vulnerability)

1. Identify the target package and safe version from the audit output or the upstream advisory.
2. Update the pinned version:

   ```bash
   npm install <package>@<safe-version>
   ```

3. If the vulnerability is in a transitive dependency only, add an override in `ui/package.json`:

   ```json
   "overrides": {
     "<transitive-package>": "<safe-version>"
   }
   ```

   Then reinstall:

   ```bash
   npm install
   ```

## Verify

1. Confirm the audit is clean:

   ```bash
   npm audit
   ```

2. Run the TypeScript build to confirm no type errors:

   ```bash
   npm run build
   ```

3. Smoke-test locally:

   ```bash
   npm run dev
   ```

   Verify the login page loads and Amplify Authenticator renders.

## Commit and Deploy

1. Stage lockfile and manifest changes:

   ```bash
   git add package.json package-lock.json
   git commit -m "fix: patch <package-name> to <safe-version>"
   ```

2. Open a PR following the standard workflow. Include in the PR body:
   - CVE or advisory reference
   - Package and version before → after
   - Audit output confirming clean

3. After merge, rebuild the static bundle and redeploy (deployment target TBD — steps will be added when the frontend hosting target is defined).

## Risks and Notes

- `npm audit fix --force` may apply breaking major-version upgrades. Do not use it without reviewing the changelog.
- A vulnerability in a bundled package requires a rebuild and redeploy of `ui/dist/` even if the runtime application is otherwise unchanged.
- Check `@aws-amplify/*` advisories at https://github.com/aws-amplify/amplify-js/security/advisories in addition to npm audit.

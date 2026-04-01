---
agent: agent
description: Review all PR comments for this repository, validate each claim against project docs and changed files, fix valid issues, and post concise replies.
---

Follow these steps exactly.

1. Identify PR context.
- Run gh pr view --json number,headRefName.
- If there is no open PR for the current branch, stop and report that state.

2. Gather authoritative context for this project.
- List changed files from the PR.
- Read each changed file in full.
- Read relevant docs from this repository:
- docs/proposal.md
- docs/design.md
- docs/architecture.md
- docs/runbooks if touched by the PR
- Read relevant instruction files from .github/instructions based on touched files.

3. Fetch all review comments.
- Top-level PR comments: gh pr view <number> --comments
- Inline comments: gh api --paginate repos/<owner>/<repo>/pulls/<number>/comments
- Build comment-id to thread-id mapping using GraphQL reviewThreads pagination.

4. Classify every comment.
- Valid: comment matches code/docs and requires change.
- Rejected: claim contradicts current code or documented project decisions.
- Ambiguous: cannot be resolved from available evidence; pause and ask user.

5. Process valid comments in small batches.
- Apply focused fixes.
- Verify each change in files.
- Commit per batch with clear message.
- If detect-secrets updates .secrets.baseline metadata, stage it and retry commit.
- Reply to each comment with concise factual status.

6. Keep docs in sync.
- If fixes alter contracts, schema, workflow, or security behavior, update docs in same pass.

7. Run quality and security gates.
- Run lint/test checks for touched scope.
- Perform security-focused review for sensitive files.
- Address high-severity issues before push.
- For Terraform files: classify any exposure of plaintext credentials or tokens in Terraform state as a high-severity security finding.
- Block changes that introduce plaintext credential or token material into Terraform state, even if detect-secrets passes.
- If touched changes include executable behavior and a unit test is reasonably possible, require that test in the same PR.
- If such a test is missing, classify as a blocking finding.
- Deferral is allowed only with explicit rationale and a linked follow-up issue.
- Pure docs/process/license-only changes are exempt from this unit test requirement.
- If lint or unit test targets are unavailable for touched scope, record this explicitly as a finding/testing gap (do not silently pass gates).

8. Push and resolve threads.
- Push once all batches and checks are complete.
- Resolve threads for fixed or rejected comments using thread IDs.

9. Request re-review.
- Tell user all threads are resolved and they can trigger a new reviewer pass.

Response style requirements:
- Findings first, ordered by severity.
- Include file references and concise rationale.
- If no findings, state that explicitly and mention residual risks/testing gaps.
- Always include a concise gate status line for touched scope: lint `passed|failed|not-available`; tests `passed|failed|not-available`.

# Copilot Code Review Instructions — Record Ranch (Strict)

## Primary Objective

Report only **high-confidence, reproducible, blocking issues** in:

- Security vulnerabilities
- Deterministic correctness bugs
- Accessibility issues that block core workflow completion

---

## Scope Constraint (Hard)

- Review **only code changed in this PR**
- Or code **directly executed by the changed lines**

Do not review unrelated or pre-existing code.

---

## Mandatory Decision Gate (ALL required)

An issue may be reported **only if all conditions are met**:

1. **Category match**
   - Security, deterministic correctness, or blocking accessibility

2. **Concrete location**
   - Exact file and line number

3. **Reproducible failure**
   Must include:
   - Specific input or state
   - Execution path
   - Observable failure (error, incorrect output, blocked flow)

4. **Deterministic impact**
   - Must occur reliably under stated conditions
   - Not hypothetical or edge-case speculation

5. **Minimal patch fix**
   - Provide a specific code-level fix (diff or snippet)
   - No vague suggestions

6. **High confidence threshold**
   - ≥ 90% certainty
   - If uncertain, do not comment

---

## Explicit Prohibitions

Do NOT comment if the issue involves:

- Hypothetical scenarios (“could”, “might”, “potentially”)
- Edge cases without demonstrated failure
- Missing best practices without a bug
- Style, naming, formatting
- Refactoring suggestions
- Architecture disagreements
- Code outside PR scope
- Pre-existing issues not introduced or modified here

---

## Severity Threshold (ALL must qualify)

Only report if it results in:

- Proven exploit path
- Runtime crash or exception
- Data corruption or loss
- Inability to complete a core user workflow

---

## De-duplication

- Do not repeat prior comments
- Do not re-raise resolved issues
- Do not restate the same root cause across multiple locations

---

## Output Limit

- Report **maximum 5 issues**
- Prioritize highest impact only
- If more exist, report the top 5 only

---

## Output Format (Strict)

For each issue:

- Category  
- Location (file:line)  
- Reproduction (input + execution path)  
- Problem  
- Impact  
- Fix (code-level patch)  

---

## Zero-Issue Condition

If no issues meet ALL criteria:

> No blocking issues found in scope.

---

## Meta Rules

- Silence is preferred over low-confidence feedback  
- Do not iterate or expand on this review unless explicitly requested  
- Do not speculate beyond the provided code and diff

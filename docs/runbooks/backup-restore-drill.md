# Backup and Restore Drill Runbook

## Purpose

Validate that backup and restore procedures are operational for the database tier.

## Cadence

- Perform at least one restore drill per quarter.
- Perform an additional drill after major schema or infrastructure changes.

## Backup Verification Checklist

1. Confirm automated backups are enabled for RDS instance.
2. Confirm retention window matches expected policy.
3. Confirm deletion protection remains enabled in persistent environments.

## Restore Drill Procedure

1. Select a restore point within retention window.
2. Restore to a temporary database instance.
3. Validate connectivity and basic schema presence.
4. Run smoke checks against critical tables (inventory item and transaction history).
5. Record restore duration and issues.
6. Decommission temporary restore resources after verification.

## Evidence to Capture

- Restore request timestamp
- Restore completed timestamp
- Instance identifier used for drill
- Validation outcomes and anomalies

## Failure Handling

- If restore fails, open a blocking issue.
- Do not mark durability controls as satisfied until a successful drill is recorded.

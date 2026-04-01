# Explicitly manage RDS CloudWatch log groups so retention is enforced.
# Without these, AWS auto-creates the groups with infinite retention.
resource "aws_cloudwatch_log_group" "rds_postgresql" {
  name              = "/aws/rds/instance/records-${var.environment}/postgresql"
  retention_in_days = var.db_log_retention_days

  tags = { Name = "records-${var.environment}-rds-postgresql-logs" }
}

resource "aws_cloudwatch_log_group" "rds_upgrade" {
  name              = "/aws/rds/instance/records-${var.environment}/upgrade"
  retention_in_days = var.db_log_retention_days

  tags = { Name = "records-${var.environment}-rds-upgrade-logs" }
}

resource "random_id" "db_final_snapshot_suffix" {
  byte_length = 4

  keepers = {
    db_identifier  = "records-${var.environment}"
    engine_version = var.postgres_major_version
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "records-${var.environment}"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "records-${var.environment}-db-subnet-group" }
}

resource "aws_db_parameter_group" "main" {
  name   = "records-${var.environment}-pg${var.postgres_major_version}"
  family = "postgres${var.postgres_major_version}"

  tags = { Name = "records-${var.environment}-pg${var.postgres_major_version}-params" }

  # Required so the new parameter group (for a bumped major version) is created
  # before the old one is destroyed, avoiding a brief window where the DB instance
  # references a non-existent parameter group.
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "records-${var.environment}"
  engine         = "postgres"
  engine_version = var.postgres_major_version
  instance_class = var.db_instance_class

  db_name                     = var.db_name
  username                    = var.db_username
  manage_master_user_password = true

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  # Backup and durability — mandatory per design
  backup_retention_period   = 7
  backup_window             = "03:00-04:00"
  maintenance_window        = "Mon:04:00-Mon:05:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "records-${var.environment}-final-${random_id.db_final_snapshot_suffix.hex}"

  # Performance insights for query visibility
  performance_insights_enabled = true

  # Emit PostgreSQL and upgrade logs to CloudWatch
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  allow_major_version_upgrade = var.allow_major_version_upgrade

  # Low HA tolerance: single-AZ per design decision
  multi_az = false

  tags = { Name = "records-${var.environment}-db" }

  # Ensure log groups exist before the DB instance is created. RDS auto-creates
  # these groups when enabled_cloudwatch_logs_exports is set; if Terraform races
  # to create them at the same time, the apply fails with ResourceAlreadyExistsException.
  depends_on = [
    aws_cloudwatch_log_group.rds_postgresql,
    aws_cloudwatch_log_group.rds_upgrade,
  ]

  # AWS resolves engine_version to a minor version on first apply (e.g. "16" -> "16.8").
  # This block suppresses minor-version drift noise in subsequent plans.
  #
  # For major version upgrades (e.g. postgres_major_version = "16" -> "17"):
  #   1. Set var.allow_major_version_upgrade = true in tfvars.
  #   2. Bump var.postgres_major_version.
  #   3. Temporarily remove this lifecycle block.
  #   4. Apply (parameter group recreates via create_before_destroy; engine upgrades).
  #   5. Restore this lifecycle block and set allow_major_version_upgrade = false.
  lifecycle {
    ignore_changes = [engine_version]
  }
}

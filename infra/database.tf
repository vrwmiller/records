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

  # Low HA tolerance: single-AZ per design decision
  multi_az = false

  tags = { Name = "records-${var.environment}-db" }

  # AWS resolves engine_version to a minor version on first apply (e.g. "16" -> "16.8").
  # Ignore subsequent minor-version drift; upgrades are applied through maintenance windows.
  lifecycle {
    ignore_changes = [engine_version]
  }
}

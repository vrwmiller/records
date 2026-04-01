resource "aws_secretsmanager_secret" "db_connection_info" {
  name                    = "records/${var.environment}/db-connection-info"
  description             = "RDS connection metadata and managed master secret reference"
  recovery_window_in_days = var.environment == "prod" ? 7 : 0

  tags = { Name = "records-${var.environment}-db-connection-info" }
}

resource "aws_secretsmanager_secret_version" "db_connection_info" {
  secret_id = aws_secretsmanager_secret.db_connection_info.id
  secret_string = jsonencode({
    username               = var.db_username
    host                   = aws_db_instance.main.address
    port                   = aws_db_instance.main.port
    dbname                 = aws_db_instance.main.db_name
    master_user_secret_arn = aws_db_instance.main.master_user_secret[0].secret_arn
  })
}

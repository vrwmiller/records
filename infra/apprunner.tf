# ---------------------------------------------------------------------------
# IAM — App Runner access role (service pulls image from ECR)
# ---------------------------------------------------------------------------
resource "aws_iam_role" "apprunner_access" {
  name = "records-${var.environment}-apprunner-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "records-${var.environment}-apprunner-access-role" }
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr" {
  role       = aws_iam_role.apprunner_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

# ---------------------------------------------------------------------------
# IAM — App Runner instance role (runtime permissions for the container)
# ---------------------------------------------------------------------------
resource "aws_iam_role" "apprunner_instance" {
  name = "records-${var.environment}-apprunner-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "tasks.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "records-${var.environment}-apprunner-instance-role" }
}

resource "aws_iam_role_policy" "apprunner_instance" {
  name = "records-${var.environment}-apprunner-instance"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Allow the entrypoint script to fetch DB connection info and the
        # RDS-managed master password. The managed master secret ARN starts
        # with "rds!" and is not known at Terraform plan time.
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          aws_secretsmanager_secret.db_connection_info.arn,
          aws_db_instance.main.master_user_secret[0].secret_arn
        ]
      },
      {
        Sid    = "S3Images"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.images.arn,
          "${aws_s3_bucket.images.arn}/*"
        ]
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# VPC connector — routes App Runner egress through the private subnets
# so the container can reach the private RDS instance.
# ---------------------------------------------------------------------------
resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "records-${var.environment}"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.app.id]

  tags = { Name = "records-${var.environment}-vpc-connector" }
}

# ---------------------------------------------------------------------------
# CloudWatch log group for App Runner service logs
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "apprunner" {
  name              = "/aws/apprunner/records-${var.environment}/application"
  retention_in_days = var.app_log_retention_days

  tags = { Name = "records-${var.environment}-apprunner-logs" }
}

# ---------------------------------------------------------------------------
# App Runner service
#
# IMPORTANT — first-deploy order:
#   1. terraform apply         (provisions all infra; App Runner will fail — expected)
#   2. docker build + push to ECR  (image must exist)
#   3. terraform apply         (App Runner retries and succeeds)
#
# auto_deployments_enabled is false; redeploy by pushing a new image then
# triggering a manual deployment from the console or CLI.
# ---------------------------------------------------------------------------
resource "aws_apprunner_service" "app" {
  service_name = "records-${var.environment}"

  # Ensure the log group is managed by Terraform (with the desired retention
  # policy) before App Runner starts and auto-creates it with default settings.
  # Also waits for the ECR access role policy to be attached before service
  # creation so image pulls succeed immediately.
  depends_on = [
    aws_cloudwatch_log_group.apprunner,
    aws_iam_role_policy_attachment.apprunner_ecr,
  ]

  source_configuration {
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_access.arn
    }

    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:latest"
      image_repository_type = "ECR"

      image_configuration {
        port = "8000"

        runtime_environment_variables = {
          AWS_REGION           = var.aws_region
          COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
          COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.app.id
          DB_SECRET_ID         = aws_secretsmanager_secret.db_connection_info.name
          S3_IMAGE_BUCKET      = aws_s3_bucket.images.bucket
          # Empty string overrides the app default (localhost origins) so no
          # cross-origin requests are allowed in production. The React UI is
          # served from the same App Runner origin and does not need CORS.
          CORS_ORIGINS = ""
        }
      }
    }

    auto_deployments_enabled = false
  }

  instance_configuration {
    instance_role_arn = aws_iam_role.apprunner_instance.arn
    cpu               = "512"
    memory            = "1024"
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 20
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  tags = { Name = "records-${var.environment}-app-runner" }
}

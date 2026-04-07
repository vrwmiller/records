# ---------------------------------------------------------------------------
# IAM — Lambda execution role
# ---------------------------------------------------------------------------
resource "aws_iam_role" "lambda" {
  name = "records-${var.environment}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = { Name = "records-${var.environment}-lambda-role" }
}

# Grants CloudWatch Logs access and the EC2 permissions needed to attach the
# function to the VPC (create/delete ENIs in the private subnets).
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda" {
  name = "records-${var.environment}-lambda"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Allow the handler to fetch DB connection info and the RDS-managed
        # master password at cold start. The managed master secret ARN starts
        # with "rds!" and is not known until the DB instance is created.
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
      },
      {
        # Allow the handler to resolve the Discogs API token from SSM at
        # runtime. The token value is stored as a SecureString and is never
        # passed through Terraform. Omitted when discogs_token_ssm_name is
        # empty (the condition keeps the policy valid in that case).
        Sid    = "SSMDiscogsToken"
        Effect = "Allow"
        Action = "ssm:GetParameter"
        Resource = var.discogs_token_ssm_name != "" ? [
          "arn:aws:ssm:${var.aws_region}:*:parameter${var.discogs_token_ssm_name}"
        ] : []
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# CloudWatch log group for Lambda
#
# Manage explicitly so retention is enforced. Without this, Lambda auto-creates
# the group with infinite retention on first invocation.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/records-${var.environment}"
  retention_in_days = var.app_log_retention_days

  tags = { Name = "records-${var.environment}-lambda-logs" }
}

# ---------------------------------------------------------------------------
# Lambda function (zip package, Python 3.13 managed runtime)
#
# IMPORTANT — first-deploy order:
#   1. Build the zip package (see deploy-from-scratch.md step 2)
#   2. terraform apply   (zip must exist at ../lambda.zip before apply)
#
# To redeploy after a code or dependency change:
#   aws lambda update-function-code \
#     --function-name records-<environment> \
#     --zip-file fileb://lambda.zip \
#     --profile records --region us-east-1
# ---------------------------------------------------------------------------
resource "aws_lambda_function" "app" {
  function_name = "records-${var.environment}"
  package_type  = "Zip"
  runtime       = "python3.13"
  handler       = "app.handler.handler"
  filename      = "${path.module}/../lambda.zip"
  # Guard the hash calculation so validate/plan succeed before lambda.zip exists.
  # Build lambda.zip before running terraform apply (see deploy-from-scratch.md).
  source_code_hash = fileexists("${path.module}/../lambda.zip") ? filebase64sha256("${path.module}/../lambda.zip") : null
  role             = aws_iam_role.lambda.arn

  timeout     = 30
  memory_size = 512

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.app.id]
  }

  environment {
    variables = {
      # AWS_REGION is a reserved Lambda env var set automatically by the runtime;
      # it must not be set explicitly here.
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID    = aws_cognito_user_pool_client.app.id
      DB_SECRET_ID         = aws_secretsmanager_secret.db_connection_info.name
      S3_IMAGE_BUCKET      = aws_s3_bucket.images.bucket
      # Empty string overrides the app default (localhost origins) so no
      # cross-origin requests are allowed in production. The React UI is
      # served from the same API Gateway origin and does not need CORS.
      CORS_ORIGINS           = ""
      DISCOGS_TOKEN_SSM_NAME = var.discogs_token_ssm_name
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.lambda_vpc,
    aws_iam_role_policy.lambda,
  ]

  tags = { Name = "records-${var.environment}-lambda" }
}



output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of the public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of the private subnets"
  value       = aws_subnet.private[*].id
}

output "db_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "db_secret_arn" {
  description = "ARN of the Secrets Manager secret for DB connection metadata"
  value       = aws_secretsmanager_secret.db_connection_info.arn
  sensitive   = true
}

output "cognito_user_pool_id" {
  description = "Cognito user pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Cognito app client ID"
  value       = aws_cognito_user_pool_client.app.id
}

output "image_bucket_name" {
  description = "S3 bucket name for record images"
  value       = aws_s3_bucket.images.bucket
}

output "lambda_function_url" {
  description = "Lambda Function URL (AWS_IAM auth — internal use only; access the app via app_url)"
  value       = try(aws_lambda_function_url.app.function_url, null)
}

output "app_url" {
  description = "Public HTTPS URL for the app via CloudFront"
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}

# ---------------------------------------------------------------------------
# CloudFront distribution in front of the Lambda Function URL
#
# The Lambda Function URL uses AWS_IAM authorization. CloudFront signs every
# request to the origin using Origin Access Control (OAC), so the function
# only accepts traffic from this distribution — never from the raw Lambda
# URL directly.
#
# The distribution forwards all headers, query strings, and cookies to the
# origin so FastAPI and Mangum receive an unmodified request. CloudWatch and
# S3 logging are intentionally omitted for this single-user workload.
# ---------------------------------------------------------------------------

# Strip the trailing slash from the Lambda URL so it can be used as the
# CloudFront origin domain without embedding a fixed path.
locals {
  lambda_url_host = replace(
    replace(aws_lambda_function_url.app.function_url, "https://", ""),
    "/",
    ""
  )
}

resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "records-${var.environment}-lambda-oac"
  description                       = "OAC for records-${var.environment} Lambda Function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "records-${var.environment} app"
  price_class     = "PriceClass_100" # US + Europe only — cheapest tier

  origin {
    domain_name              = local.lambda_url_host
    origin_id                = "lambda-${var.environment}"
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = "lambda-${var.environment}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]

    # Use the AWS-managed CachingDisabled policy — appropriate for an API/app
    # where responses must not be cached by default. Individual static assets
    # (JS/CSS with content-hashed names) could use a caching policy in future.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled

    # Forward all headers/cookies/query strings to the origin so FastAPI
    # receives the full request context.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "records-${var.environment}-cf" }
}

# Allow CloudFront to invoke the Lambda function via OAC (IAM-signed requests).
# The source ARN scopes the grant to this specific distribution only.
resource "aws_lambda_permission" "cloudfront" {
  statement_id  = "AllowCloudFrontInvoke"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.app.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.app.arn
}

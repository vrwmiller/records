# ---------------------------------------------------------------------------
# API Gateway HTTP API — public ingress for the Lambda function
#
# HTTP API (API Gateway v2) is simpler and cheaper than REST API (v1).
# All requests are forwarded to the Lambda function via an AWS_PROXY
# integration using payload format 2.0, which Mangum understands natively.
#
# The $default stage deploys automatically on every route/integration change.
# No explicit Deployment resource is needed for HTTP APIs.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "app" {
  name          = "records-${var.environment}"
  protocol_type = "HTTP"

  tags = { Name = "records-${var.environment}-apigw" }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.app.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

# ---------------------------------------------------------------------------
# CloudWatch log group for API Gateway access logs
#
# Managed explicitly so retention matches the Lambda log group. Without this,
# API Gateway auto-creates a group with infinite retention on first request.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "apigw" {
  name              = "/aws/apigateway/records-${var.environment}"
  retention_in_days = var.app_log_retention_days

  tags = { Name = "records-${var.environment}-apigw-logs" }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.apigw.arn
    # JSON format captures method, path, status, latency, and request ID —
    # sufficient for diagnosing routing and integration failures.
    # routeKey is always "$default" for this stage; path carries the actual
    # request path (e.g. /api/health) needed to identify which URL was hit.
    format = jsonencode({
      requestId          = "$context.requestId"
      ip                 = "$context.identity.sourceIp"
      requestTime        = "$context.requestTime"
      httpMethod         = "$context.httpMethod"
      path               = "$context.path"
      routeKey           = "$context.routeKey"
      status             = "$context.status"
      protocol           = "$context.protocol"
      responseLength     = "$context.responseLength"
      integrationLatency = "$context.integrationLatency"
    })
  }

  # Throttle at the stage level to bound cost and block trivial abuse.
  # Burst: max concurrent requests spike; rate: sustained requests/second.
  # Values are conservative for a single-user dev workload and can be raised
  # via a tfvar override when traffic warrants it.
  default_route_settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
  }

  tags = { Name = "records-${var.environment}-apigw-stage" }
}

# Allow API Gateway to invoke the Lambda function.
# source_arn scopes the grant to this API only (all stages and routes).
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
}

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

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true

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

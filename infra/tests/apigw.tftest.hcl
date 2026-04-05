# ---------------------------------------------------------------------------
# Terraform tests for API Gateway HTTP API configuration (apigw.tf)
#
# Run with: terraform -chdir=infra test
#
# Uses mock providers so no AWS credentials are required and no real resources
# are created. mock_resource defaults supply valid computed attributes (ARNs,
# IDs) so plan-phase assertions can evaluate them. Covers permission scope,
# payload format version, throttle limits, and access logging configuration.
# ---------------------------------------------------------------------------

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b"]
    }
  }

  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:testapi123"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:123456789012:log-group:test"
    }
  }

  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id = "us-east-1_TestPool0"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      address = "test.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [
        {
          secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:test" # pragma: allowlist secret
          secret_status = "active"                                                      # pragma: allowlist secret
          kms_key_id    = "arn:aws:kms:us-east-1:123456789012:key/test"
        }
      ]
    }
  }

  mock_resource "aws_lambda_function" {
    defaults = {
      arn        = "arn:aws:lambda:us-east-1:123456789012:function:records-dev"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:records-dev/invocations"
    }
  }
}
mock_provider "random" {}

variables {
  environment            = "dev"
  aws_region             = "us-east-1"
  app_log_retention_days = 30
}

run "apigw_lambda_permission_source_arn_scoped_to_api" {
  command = plan

  # override_resource makes execution_arn known at plan time so that
  # source_arn (an interpolation of execution_arn + "/*/*") is evaluable.
  override_resource {
    target          = aws_apigatewayv2_api.app
    override_during = plan
    values = {
      execution_arn = "arn:aws:execute-api:us-east-1:123456789012:testapi123"
    }
  }

  override_resource {
    target          = aws_lambda_function.app
    override_during = plan
    values = {
      arn        = "arn:aws:lambda:us-east-1:123456789012:function:records-dev"
      invoke_arn = "arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:123456789012:function:records-dev/invocations"
    }
  }

  assert {
    condition     = endswith(aws_lambda_permission.apigw.source_arn, "/*/*")
    error_message = "Lambda permission source_arn must end with /*/* to scope it to all routes and stages of this API only"
  }

  assert {
    condition     = aws_lambda_permission.apigw.principal == "apigateway.amazonaws.com"
    error_message = "Lambda permission principal must be apigateway.amazonaws.com"
  }

  assert {
    condition     = aws_lambda_permission.apigw.action == "lambda:InvokeFunction"
    error_message = "Lambda permission action must be lambda:InvokeFunction"
  }
}

run "apigw_integration_payload_format" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_integration.lambda.payload_format_version == "2.0"
    error_message = "Integration payload_format_version must be 2.0 (Mangum requires this for HTTP API proxy events)"
  }

  assert {
    condition     = aws_apigatewayv2_integration.lambda.integration_type == "AWS_PROXY"
    error_message = "Integration type must be AWS_PROXY"
  }
}

run "apigw_stage_throttle_limits_set" {
  command = plan

  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit > 0
    error_message = "Stage must have a non-zero throttling burst limit to bound cost and abuse risk"
  }

  assert {
    condition     = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit > 0
    error_message = "Stage must have a non-zero throttling rate limit"
  }
}

run "apigw_stage_access_logging_configured" {
  command = plan

  assert {
    condition     = length(aws_apigatewayv2_stage.default.access_log_settings) > 0
    error_message = "Stage must have access_log_settings configured for auditability"
  }
}

run "apigw_log_group_retention_matches_variable" {
  command = plan

  assert {
    condition     = aws_cloudwatch_log_group.apigw.retention_in_days == var.app_log_retention_days
    error_message = "API Gateway log group retention must match the app_log_retention_days variable"
  }
}

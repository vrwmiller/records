variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "aws_region must be us-east-1 to match the current remote state backend"
  }
}

variable "aws_profile" {
  description = "AWS CLI profile to use"
  type        = string
  default     = null
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment must be dev or prod"
  }
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition = (
      can(cidrsubnet(var.vpc_cidr, 4, 0)) &&
      can(tonumber(split(var.vpc_cidr, "/")[1])) &&
      tonumber(split(var.vpc_cidr, "/")[1]) <= 24
    )
    error_message = "vpc_cidr must be a valid CIDR with prefix length <= /24 so derived /+4 subnets are no smaller than /28 (for example /24, /20, or /16)"
  }
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "recordranch"
}

variable "db_username" {
  description = "PostgreSQL master username"
  type        = string
  default     = "recordranch"
}

variable "db_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Initial allocated storage in GB for RDS"
  type        = number
  default     = 20
}

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket       = "records-tfstate-920835814440-us-east-1"
    key          = "records/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
    # IMPORTANT: The backend key is static and cannot use var.environment.
    # Each environment (dev, prod) MUST use a distinct key to avoid sharing state.
    # Override at init time: terraform init -backend-config="key=records/prod/terraform.tfstate"
    # The default key above is for the dev environment.
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "records"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# OpenTofu state for production, kept in the backup account's R2 (S3 API). Credentials from AWS_* env.
bucket                      = "selecta-tofu-state"
key                         = "cloudflare/production.tfstate"
region                      = "auto"
skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
skip_s3_checksum            = true
use_path_style              = true

# Selecta Cloud on Cloudflare: DNS, WAF rate limits, Pages and R2 (EU jurisdiction). ADR-0409.
# OpenTofu. One state per environment:
#   tofu init -backend-config=env/<env>.backend.hcl
#   tofu apply -var-file=env/<env>.tfvars
# The backup bucket lives in a separate Cloudflare account with its own token (provider
# "backup"), so a compromised production key cannot delete the backups (ADR-0409, §13.5).
# Checked by tests/test_cloud_infra.py.

terraform {
  required_version = ">= 1.8.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.12"
    }
  }
  backend "s3" {}
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "cloudflare" {
  alias     = "backup"
  api_token = var.backup_api_token
}

locals {
  prefix  = "selecta-${var.environment}"
  buckets = ["originals", "derived", "exports", "staging", "deletion-ledger"]
}

# --- Object storage ------------------------------------------------------------------------

resource "cloudflare_r2_bucket" "data" {
  for_each      = toset(local.buckets)
  account_id    = var.account_id
  name          = "${local.prefix}-${each.key}"
  jurisdiction  = "eu"
  storage_class = "Standard"
}

# Abandoned multipart uploads and staging objects never linger.
resource "cloudflare_r2_bucket_lifecycle" "staging" {
  account_id   = var.account_id
  bucket_name  = cloudflare_r2_bucket.data["staging"].name
  jurisdiction = "eu"
  rules = [{
    id      = "expire-staging"
    enabled = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 86400 * 2 }
    }
    abort_multipart_uploads_transition = {
      condition = { type = "Age", max_age = 86400 }
    }
  }]
}

resource "cloudflare_r2_bucket" "backup" {
  provider      = cloudflare.backup
  account_id    = var.backup_account_id
  name          = "${local.prefix}-originals-backup"
  jurisdiction  = "eu"
  storage_class = "InfrequentAccess"
}

# Database dumps sit beside the originals' copy in the backup account (nightly, 35 days kept).
resource "cloudflare_r2_bucket" "db_dumps" {
  provider      = cloudflare.backup
  account_id    = var.backup_account_id
  name          = "${local.prefix}-db-dumps"
  jurisdiction  = "eu"
  storage_class = "InfrequentAccess"
}

resource "cloudflare_r2_bucket_lifecycle" "db_dumps" {
  provider     = cloudflare.backup
  account_id   = var.backup_account_id
  bucket_name  = cloudflare_r2_bucket.db_dumps.name
  jurisdiction = "eu"
  rules = [{
    id      = "keep-35-days"
    enabled = true
    conditions = { prefix = "" }
    delete_objects_transition = {
      condition = { type = "Age", max_age = 86400 * 35 }
    }
  }]
}

# --- Static site ---------------------------------------------------------------------------

resource "cloudflare_pages_project" "web" {
  account_id        = var.account_id
  name              = local.prefix
  production_branch = "main"
}

# --- DNS -----------------------------------------------------------------------------------

resource "cloudflare_dns_record" "api" {
  zone_id = var.zone_id
  name    = var.api_hostname
  type    = "CNAME"
  content = var.render_api_target
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "gateway" {
  zone_id = var.zone_id
  name    = var.gateway_hostname
  type    = "CNAME"
  content = var.render_gateway_target
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "web" {
  zone_id = var.zone_id
  name    = var.web_hostname
  type    = "CNAME"
  content = "${cloudflare_pages_project.web.name}.pages.dev"
  proxied = true
  ttl     = 1
}

# --- WAF rate limits -----------------------------------------------------------------------

resource "cloudflare_ruleset" "rate_limits" {
  zone_id = var.zone_id
  name    = "${local.prefix} rate limits"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules = [
    {
      description = "API: per-IP burst limit"
      expression  = "(http.host eq \"${var.api_hostname}\")"
      action      = "block"
      enabled     = true
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 10
        requests_per_period = var.api_requests_per_10s
        mitigation_timeout  = 60
      }
    },
    {
      description = "Room joins: brute-force protection"
      expression  = "(http.host eq \"${var.api_hostname}\" and http.request.uri.path eq \"/api/guest/join\")"
      action      = "block"
      enabled     = true
      ratelimit = {
        characteristics     = ["ip.src", "cf.colo.id"]
        period              = 60
        requests_per_period = 20
        mitigation_timeout  = 600
      }
    },
  ]
}

output "buckets" {
  value = { for key, bucket in cloudflare_r2_bucket.data : key => bucket.name }
}

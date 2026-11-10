variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "backup_api_token" {
  type        = string
  sensitive   = true
  description = "A token for the separate backup account; never the production account's."
}

variable "account_id" {
  type = string
}

variable "backup_account_id" {
  type = string
}

variable "zone_id" {
  type = string
}

variable "api_hostname" {
  type = string
}

variable "gateway_hostname" {
  type = string
}

variable "web_hostname" {
  type = string
}

variable "render_api_target" {
  type = string
}

variable "render_gateway_target" {
  type = string
}

variable "api_requests_per_10s" {
  type    = number
  default = 200
}

# Non-secret settings for staging. Account, zone and token ids come from TF_VAR_* in the deploy job.
# selecta.app is a placeholder until the owner names the real domain.
environment           = "staging"
api_hostname          = "api.staging.selecta.app"
gateway_hostname      = "gateway.staging.selecta.app"
web_hostname          = "staging.selecta.app"
render_api_target     = "selecta-api-staging.onrender.com"
render_gateway_target = "selecta-gateway-staging.onrender.com"
api_requests_per_10s  = 50

# Non-secret settings for production. Account, zone and token ids come from TF_VAR_* in the deploy job.
# selecta.app is a placeholder until the owner names the real domain.
environment           = "production"
api_hostname          = "api.selecta.app"
gateway_hostname      = "gateway.selecta.app"
web_hostname          = "selecta.app"
render_api_target     = "selecta-api-production.onrender.com"
render_gateway_target = "selecta-gateway-production.onrender.com"
api_requests_per_10s  = 200

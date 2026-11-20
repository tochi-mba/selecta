# Non-secret settings for production. Account, zone and token ids come from TF_VAR_* in the deploy job.
# Owned SelectaDJ production domain (registered November 2026).
environment           = "production"
api_hostname          = "api.selectadj.app"
gateway_hostname      = "gateway.selectadj.app"
web_hostname          = "app.selectadj.app"
render_api_target     = "selecta-api-production.onrender.com"
render_gateway_target = "selecta-gateway-production.onrender.com"
api_requests_per_10s  = 200

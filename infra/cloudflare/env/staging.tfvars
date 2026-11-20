# Non-secret settings for staging. Account, zone and token ids come from TF_VAR_* in the deploy job.
# Staging subdomains under the owned SelectaDJ domain.
environment           = "staging"
api_hostname          = "api.staging.selectadj.app"
gateway_hostname      = "gateway.staging.selectadj.app"
web_hostname          = "app.staging.selectadj.app"
render_api_target     = "selecta-api-staging.onrender.com"
render_gateway_target = "selecta-gateway-staging.onrender.com"
api_requests_per_10s  = 50

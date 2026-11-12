"""SelectaDJ Cloud on a developer's own machine (`dev.cmd cloud`). Never part of a deployment.

Everything here stands in for a hosted service so a developer can sign up, verify, sign in, upload,
listen and pay (pretend) with no external accounts or keys:

- `identity`: a local identity provider that speaks AuthKit's browser protocol and the WorkOS
  User Management API the Cloud API calls, with a local inbox at `/dev/mail`;
- `objects`: object storage in a folder on disk, with signed URLs this machine answers;
- `billing`: a pretend Stripe Checkout that succeeds or fails on demand;
- `rooms`: a small synthetic song list so Rooms can be opened;
- `cloud_app`: the real Cloud API (`api_cloud.create_cloud_app`) wired to those stand-ins;
- `worker`: the real job runner and handlers, claiming from the local database;
- `seed`: a ready-made developer account with sample synthetic songs;
- `launcher`: starts and stops all of it.

`guard.require_development()` runs first in every entry point, and production settings refuse the
local identity provider (`api_cloud.CloudSettings.from_environment`), so none of this can serve a
real user.
"""

"""The dev identity stand-in mints tokens the Cloud API's real verifier accepts, so
`dev.cmd cloud` can sign in. It broke once when the API began checking `client_id`."""

from __future__ import annotations

from selecta.devstack.identity import IdentityConfig, LocalIdentity
from selecta.identity.tokens import authkit_verifier


def test_a_dev_token_passes_the_api_verifier(tmp_path):
    config = IdentityConfig(
        folder=tmp_path / "identity",
        base_url="http://127.0.0.1:8742",
        client_id="client_selecta_local_dev",
        site_origins=("http://127.0.0.1:5173",),
        echo_mail=False,
    )
    provider = LocalIdentity(config)
    person = provider.sign_up("dev@selectadj.test", "selectadj-dev-password", verified=True)
    session_id, _refresh = provider.store.start_session(person.id, "password")
    token = provider.access_token(person, session_id)

    # The same settings the dev Cloud API uses (devstack/cloud_app.py `cloud_settings`).
    verifier = authkit_verifier(
        config.client_id,
        issuer=config.issuer,
        audience=config.client_id,
        api_base=config.base_url,
        fetcher=lambda _url: provider.jwks(),
    )
    assert verifier.verify(token).subject == person.id

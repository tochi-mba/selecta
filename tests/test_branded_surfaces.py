"""Branded surfaces (docs/engineering/branded-surfaces.md): Stripe's pages in our words, our own
portal from code, our emails and error pages in the brand, and the brand kit complete."""

from __future__ import annotations

from pathlib import Path

from selecta.billing import branding
from selecta.notify import billing_mail

ROOT = Path(__file__).resolve().parents[1]


def test_checkout_speaks_our_words_and_waits_for_terms_before_asking_for_them():
    plain = branding.checkout_extras({})
    assert plain["locale"] == "auto"
    assert plain["custom_text[submit][message]"] == branding.SUBMIT_WORDS
    assert "consent_collection[terms_of_service]" not in plain
    # a terms address alone is not enough: Stripe needs it in Public details first
    assert "consent_collection[terms_of_service]" not in branding.checkout_extras(
        {"SELECTA_TERMS_URL": "https://selectadj.app/terms"}
    )
    ready = branding.checkout_extras({"SELECTA_TERMS_URL": "https://selectadj.app/terms",
                                      "SELECTA_STRIPE_TERMS_CONSENT": "1"})
    assert ready["consent_collection[terms_of_service]"] == "required"
    assert "(https://selectadj.app/terms)" in ready[
        "custom_text[terms_of_service_acceptance][message]"
    ]
    for words in plain.values():
        assert "—" not in words and len(words) <= 1200


def test_the_portal_configuration_cancels_at_period_end_and_switches_only_our_prices():
    data = branding.portal_configuration(
        {"prod_standard": ["price_standard_month", "price_standard_year"]},
        {"SELECTA_EMAIL_SITE_URL": "https://app.selectadj.app"},
    )
    assert data["features[subscription_cancel][mode]"] == "at_period_end"
    assert data["default_return_url"] == "https://app.selectadj.app/account/billing"
    assert data["features[subscription_update][products][0][product]"] == "prod_standard"
    assert data["features[subscription_update][products][0][prices][1]"] == "price_standard_year"
    assert data["metadata[selectadj]"] == branding.PORTAL_MARK
    assert "business_profile[terms_of_service_url]" not in data


def test_portal_setup_updates_the_one_it_made_instead_of_making_another():
    class Fake:
        def __init__(self):
            self.posts = []

        def _get(self, path, params):
            if path.startswith("/v1/prices/"):
                return {"product": "prod_1"}
            return {"data": [{"id": "bpc_ours", "metadata": {"selectadj": branding.PORTAL_MARK}}]}

        def _post(self, path, data, key):
            self.posts.append(path)
            return {"id": "bpc_new"}

    fake = Fake()
    assert branding.set_up_portal(fake, ["price_1"], {}) == ("bpc_ours", False)
    assert fake.posts == ["/v1/billing_portal/configurations/bpc_ours"]


def test_a_custom_stripe_domain_is_trusted_only_when_set():
    assert branding.hosted_hosts("checkout.stripe.com", {}) == {"checkout.stripe.com"}
    assert "pay.selectadj.app" in branding.hosted_hosts(
        "checkout.stripe.com", {"SELECTA_STRIPE_CUSTOM_DOMAIN": "pay.selectadj.app"}
    )


def test_our_emails_carry_the_brand_and_a_text_version():
    message = billing_mail.plan_now(to="a@example.com", key="k", plan="Premium",
                                    site_url="https://app.selectadj.app")
    assert 'content="light dark"' in message.html
    assert "https://app.selectadj.app/brand/png/email-logo-96.png" in message.html
    assert "#e8ff3a" in message.html and "REX Technologies" in message.html
    assert "Premium" in message.text and "<" not in message.text


def test_error_pages_stand_alone_and_offer_a_way_out():
    folder = ROOT / "infra" / "cloudflare" / "error-pages"
    pages = sorted(folder.glob("*.html"))
    assert {page.name for page in pages} >= {"5xx.html", "1xxx.html", "blocked.html",
                                             "rate-limited.html", "challenge.html"}
    for page in pages:
        html = page.read_text(encoding="utf-8")
        assert "support@selectadj.app" in html and 'id="ref"' in html
        assert "src=\"http" not in html and "href=\"http" not in html  # nothing from outside
        assert len(html.encode()) < 1_500_000
        assert (ROOT / "web" / "public" / "errors" / page.name).read_text(encoding="utf-8") == html
    assert "::CF_WIDGET_BOX::" in (folder / "challenge.html").read_text(encoding="utf-8")


def test_the_brand_kit_has_every_file_brand_md_names():
    brand = ROOT / "web" / "public" / "brand"
    listed = (brand / "BRAND.md").read_text(encoding="utf-8")
    for name in ("mark.svg", "png/stripe-icon-512.png", "png/stripe-logo-1280x320.png",
                 "png/workos-logo-icon-512.png", "png/google-consent-120.png",
                 "png/social-card-1200x630.png", "png/room-card-1200x630.png"):
        assert name in listed
        assert (brand / name).is_file(), name
    assert (brand / "png" / "stripe-icon-512.png").stat().st_size < 512 * 1024

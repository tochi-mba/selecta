"""Where the local Cloud stack keeps its data and how its processes find each other.

The launcher writes these into each child's environment; every process reads them back with
`DevSettings.from_environment()`. All addresses are on 127.0.0.1.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path

CLIENT_ID = "client_selecta_local_dev"


@dataclass(frozen=True)
class DevSettings:
    data: Path
    database_url: str
    site_url: str
    api_url: str
    identity_url: str

    @classmethod
    def from_environment(cls) -> DevSettings:
        data = Path(os.environ["SELECTA_DEV_DATA"]).resolve()
        return cls(
            data=data,
            database_url=os.environ.get("SELECTA_DEV_DATABASE_URL")
            or f"sqlite:///{(data / 'cloud.sqlite').as_posix()}",
            site_url=os.environ["SELECTA_DEV_SITE_URL"].rstrip("/"),
            api_url=os.environ["SELECTA_DEV_API_URL"].rstrip("/"),
            identity_url=os.environ["SELECTA_DEV_IDENTITY_URL"].rstrip("/"),
        )

    def environment(self) -> dict[str, str]:
        return {
            "SELECTA_ENV": "development",
            "SELECTA_DEV_DATA": str(self.data),
            "SELECTA_DEV_DATABASE_URL": self.database_url,
            "SELECTA_DEV_SITE_URL": self.site_url,
            "SELECTA_DEV_API_URL": self.api_url,
            "SELECTA_DEV_IDENTITY_URL": self.identity_url,
        }

    @property
    def site_origins(self) -> tuple[str, ...]:
        """The site's address, and the same port on `localhost`, which browsers treat apart."""
        alias = self.site_url.replace("://127.0.0.1:", "://localhost:")
        return (self.site_url, alias) if alias != self.site_url else (self.site_url,)

    @property
    def objects(self) -> Path:
        return self.data / "objects"

    @property
    def identity_folder(self) -> Path:
        return self.data / "identity"

    def secret(self, name: str, size: int = 32) -> str:
        """A random secret made once per data folder (webhook secret, room-code pepper...)."""
        folder = self.data / "secrets"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / name
        if not path.exists():
            path.write_text(secrets.token_urlsafe(size), encoding="ascii")
        return path.read_text(encoding="ascii").strip()


__all__ = ["CLIENT_ID", "DevSettings"]

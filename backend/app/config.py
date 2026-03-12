from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    log_level: str = "INFO"

    postgres_db: str = "gmail_manager"
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    postgres_host: str = "postgres"
    postgres_port: int = 5432

    google_client_id: str = ""
    google_client_secret: str = ""
    google_allowed_email: str = ""
    google_scopes: str = "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.labels"

    app_secret_key: str = ""
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_exp_minutes: int = 30
    jwt_cookie_name: str = "gmail_auth"
    jwt_cookie_secure: bool = True
    jwt_cookie_samesite: str = "lax"
    jwt_cookie_domain: str = ""

    public_base_url: str = ""
    frontend_base_url: str = ""

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()

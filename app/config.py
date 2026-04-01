from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # AWS
    aws_region: str = "us-east-1"
    db_secret_id: str = ""
    s3_image_bucket: str = ""

    # CORS (comma-separated list of allowed origins)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Cognito
    cognito_user_pool_id: str
    cognito_client_id: str


settings = Settings()

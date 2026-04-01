from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # AWS
    aws_region: str = "us-east-1"
    db_secret_id: str = ""
    s3_image_bucket: str = ""

    # Cognito
    cognito_user_pool_id: str
    cognito_client_id: str


settings = Settings()

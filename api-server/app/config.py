import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 数据库
    DATABASE_URL: str = "sqlite+aiosqlite:///./card_game.db"

    # JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24小时

    # OCR
    OCR_LANGUAGES: list[str] = ["ch_sim", "en"]

    class Config:
        env_file = ".env"


settings = Settings()

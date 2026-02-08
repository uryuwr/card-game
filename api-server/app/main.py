from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os

from app.routers import auth, decks, ocr, cards
from app.database import init_db
from app.seed import seed_mock_cards

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_mock_cards()
    yield


app = FastAPI(title="ONE PIECE CARD GAME API", version="0.2.0", lifespan=lifespan)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件 - 卡牌图片
cards_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "asserts", "cards")
os.makedirs(cards_dir, exist_ok=True)
app.mount("/static/cards", StaticFiles(directory=cards_dir), name="card_images")

# 注册路由
app.include_router(auth.router, prefix="/api/auth", tags=["认证"])
app.include_router(decks.router, prefix="/api/decks", tags=["卡组"])
app.include_router(ocr.router, prefix="/api/ocr", tags=["OCR"])
app.include_router(cards.router, prefix="/api/cards", tags=["卡牌"])


@app.get("/")
async def root():
    return {"message": "ONE PIECE CARD GAME API", "version": "0.2.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}
    return {"status": "ok"}

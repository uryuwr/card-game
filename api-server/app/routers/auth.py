from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta

from app.config import settings

router = APIRouter()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 简易内存存储（后续可换数据库）
users_db: dict[str, dict] = {}


class AuthRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: dict


def create_token(user_id: str, username: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "username": username, "exp": expire},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


@router.post("/register", response_model=AuthResponse)
async def register(req: AuthRequest):
    if req.username in users_db:
        raise HTTPException(status_code=400, detail="用户名已存在")

    import uuid
    user_id = str(uuid.uuid4())
    users_db[req.username] = {
        "id": user_id,
        "username": req.username,
        "hashed_password": pwd_context.hash(req.password),
    }
    token = create_token(user_id, req.username)
    return {"token": token, "user": {"id": user_id, "username": req.username}}


@router.post("/login", response_model=AuthResponse)
async def login(req: AuthRequest):
    user = users_db.get(req.username)
    if not user or not pwd_context.verify(req.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    token = create_token(user["id"], user["username"])
    return {"token": token, "user": {"id": user["id"], "username": user["username"]}}

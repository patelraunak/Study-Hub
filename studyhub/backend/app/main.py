from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
import os
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import models
from app.database import init_db
from app.routers import auth, categories, notes

_ = models

BACKEND_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
UPLOAD_DIR = BACKEND_ROOT / os.getenv("UPLOAD_DIR", "uploads")

load_dotenv(BACKEND_ROOT / ".env")
load_dotenv()

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
init_db()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Study Hub API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(notes.router)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

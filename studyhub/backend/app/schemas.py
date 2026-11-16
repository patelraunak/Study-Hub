from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=128)
    role: str = Field(default="student")


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class UserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class CategoryCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=120)


class CategoryResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class NoteResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    file_path: str
    uploader_id: int
    category_id: int
    unit: str
    created_at: datetime
    uploader_name: str
    category_name: str

    model_config = ConfigDict(from_attributes=True)

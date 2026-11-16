from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Category, User
from app.schemas import CategoryCreate, CategoryResponse

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[CategoryResponse])
def list_categories(db: Session = Depends(get_db)) -> list[CategoryResponse]:
    categories = db.query(Category).order_by(Category.name.asc()).all()
    return [CategoryResponse.model_validate(cat) for cat in categories]


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreate,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
) -> CategoryResponse:
    cleaned_name = payload.name.strip()
    if not cleaned_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Category name cannot be empty.",
        )

    existing = (
        db.query(Category)
        .filter(func.lower(Category.name) == cleaned_name.lower())
        .first()
    )
    if existing is not None:
        return CategoryResponse.model_validate(existing)

    category = Category(name=cleaned_name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return CategoryResponse.model_validate(category)

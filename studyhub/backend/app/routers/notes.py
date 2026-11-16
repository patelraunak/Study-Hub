import os
from pathlib import Path
import re
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Category, Note, User
from app.schemas import NoteResponse

router = APIRouter(prefix="/api/notes", tags=["notes"])

BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR_NAME = os.getenv("UPLOAD_DIR", "uploads")
UPLOAD_DIR = BACKEND_ROOT / UPLOAD_DIR_NAME
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "application/x-pdf"}


def serialize_note(note: Note) -> NoteResponse:
    return NoteResponse(
        id=note.id,
        title=note.title,
        description=note.description,
        file_path=note.file_path,
        uploader_id=note.uploader_id,
        category_id=note.category_id,
        unit=note.unit,
        created_at=note.created_at,
        uploader_name=note.uploader.name if note.uploader else "Unknown",
        category_name=note.category.name if note.category else "Uncategorized",
    )


def resolve_disk_path(file_path: str) -> Path:
    filename = Path(file_path).name
    return UPLOAD_DIR / filename


def safe_download_filename(title: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9._-]+", "_", title.strip()).strip("_")
    return f"{sanitized or 'study_note'}.pdf"


@router.get("", response_model=list[NoteResponse])
def list_notes(
    search: Optional[str] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
    unit: Optional[str] = Query(default=None),
    uploader_id: Optional[int] = Query(default=None),
    sort: Optional[str] = Query(default="newest"),
    db: Session = Depends(get_db),
) -> list[NoteResponse]:
    query = db.query(Note).options(joinedload(Note.uploader), joinedload(Note.category))

    if search and search.strip():
        term = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Note.title.ilike(term),
                Note.description.ilike(term),
            )
        )

    if category_id is not None:
        query = query.filter(Note.category_id == category_id)

    if unit and unit.strip():
        query = query.filter(Note.unit.ilike(f"%{unit.strip()}%"))

    if uploader_id is not None:
        query = query.filter(Note.uploader_id == uploader_id)

    if sort == "oldest":
        query = query.order_by(Note.created_at.asc())
    elif sort == "title_asc":
        query = query.order_by(func.lower(Note.title).asc(), Note.created_at.desc())
    else:
        query = query.order_by(Note.created_at.desc())

    notes = query.all()
    return [serialize_note(note) for note in notes]


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(note_id: int, db: Session = Depends(get_db)) -> NoteResponse:
    note = (
        db.query(Note)
        .options(joinedload(Note.uploader), joinedload(Note.category))
        .filter(Note.id == note_id)
        .first()
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")
    return serialize_note(note)


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def upload_note(
    title: str = Form(...),
    description: str = Form(default=""),
    unit: str = Form(...),
    category_id: Optional[int] = Form(default=None),
    category_name: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NoteResponse:
    cleaned_title = title.strip()
    cleaned_unit = unit.strip()
    cleaned_description = description.strip() if description else ""

    if not cleaned_title:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Title is required.",
        )
    if not cleaned_unit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unit is required.",
        )

    original_filename = file.filename or ""
    if not original_filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files (.pdf) are accepted.",
        )
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid content type. Only application/pdf is allowed.",
        )

    content = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded PDF file is empty.",
        )
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds the maximum allowed size of {MAX_UPLOAD_SIZE_MB} MB.",
        )
    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content is not a valid PDF document.",
        )

    category: Optional[Category] = None
    if category_id is not None:
        category = db.query(Category).filter(Category.id == category_id).first()
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected subject category does not exist.",
            )
    elif category_name and category_name.strip():
        cleaned_cat = category_name.strip()
        category = (
            db.query(Category)
            .filter(func.lower(Category.name) == cleaned_cat.lower())
            .first()
        )
        if category is None:
            category = Category(name=cleaned_cat)
            db.add(category)
            db.flush()
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subject category is required.",
        )

    stored_filename = f"{uuid.uuid4().hex}.pdf"
    destination = UPLOAD_DIR / stored_filename
    destination.write_bytes(content)

    note = Note(
        title=cleaned_title,
        description=cleaned_description,
        file_path=f"uploads/{stored_filename}",
        uploader_id=current_user.id,
        category_id=category.id,
        unit=cleaned_unit,
    )
    db.add(note)
    db.commit()
    db.refresh(note)

    loaded_note = (
        db.query(Note)
        .options(joinedload(Note.uploader), joinedload(Note.category))
        .filter(Note.id == note.id)
        .first()
    )
    return serialize_note(loaded_note or note)


@router.get("/{note_id}/view")
def view_note_pdf(note_id: int, db: Session = Depends(get_db)) -> FileResponse:
    note = db.query(Note).filter(Note.id == note_id).first()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")

    disk_path = resolve_disk_path(note.file_path)
    if not disk_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF file not found on disk.",
        )

    filename = safe_download_filename(note.title)
    return FileResponse(
        path=disk_path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/{note_id}/download")
def download_note_pdf(note_id: int, db: Session = Depends(get_db)) -> FileResponse:
    note = db.query(Note).filter(Note.id == note_id).first()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")

    disk_path = resolve_disk_path(note.file_path)
    if not disk_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF file not found on disk.",
        )

    filename = safe_download_filename(note.title)
    return FileResponse(
        path=disk_path,
        media_type="application/pdf",
        filename=filename,
    )


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    note = db.query(Note).filter(Note.id == note_id).first()
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found.")

    if note.uploader_id != current_user.id and current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the uploader or an administrator can delete this note.",
        )

    disk_path = resolve_disk_path(note.file_path)
    if disk_path.is_file():
        disk_path.unlink(missing_ok=True)

    db.delete(note)
    db.commit()
    return {"detail": "Note deleted successfully."}

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from backend.app.core.auth import create_access_token, get_current_user, hash_password, normalize_login_id, verify_password
from backend.app.db.crud import execute_returning, fetch_one
from backend.app.db.session import get_db_connection
from backend.app.schemas.auth import AuthLogin, AuthRegister, AuthToken, UserRead


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthToken)
def register(
    payload: AuthRegister,
    connection: Connection = Depends(get_db_connection),
):
    login_id = normalize_login_id(payload.email)
    existing = fetch_one(connection, "SELECT id FROM users WHERE email = %s", (login_id,))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 가입된 아이디입니다.")

    user = execute_returning(
        connection,
        """
        INSERT INTO users (email, name, password_hash)
        VALUES (%s, %s, %s)
        RETURNING id, email, name, created_at, updated_at
        """,
        (login_id, payload.name or login_id, hash_password(payload.password)),
    )
    return {
        "access_token": create_access_token(user["id"]),
        "token_type": "bearer",
        "user": user,
    }


@router.post("/login", response_model=AuthToken)
def login(
    payload: AuthLogin,
    connection: Connection = Depends(get_db_connection),
):
    login_id = normalize_login_id(payload.email)
    user = fetch_one(
        connection,
        """
        SELECT id, email, name, password_hash, created_at, updated_at
        FROM users
        WHERE email = %s
        """,
        (login_id,),
    )
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="아이디 또는 비밀번호가 올바르지 않습니다.")

    return {
        "access_token": create_access_token(user["id"]),
        "token_type": "bearer",
        "user": user,
    }


@router.get("/me", response_model=UserRead)
def read_me(current_user: dict = Depends(get_current_user)):
    return current_user

from __future__ import annotations
from dotenv import load_dotenv

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from uuid import uuid4
import secrets
import hashlib
import hmac
import smtplib
from email.message import EmailMessage
import json
import urllib.request
import urllib.error


import jwt
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from pydantic import BaseModel, EmailStr, Field, field_validator

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "connect_the_dots.db"
load_dotenv(BASE_DIR/".env")

# Set a long random value in an environment variable before deploying.
SECRET_KEY = os.getenv("CTD_SECRET_KEY", "DEV-ONLY-change-this-secret-before-deployment-please")
ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 12
OTP_MINUTES = 10
OTP_RESEND_SECONDS = 60
OTP_MAX_ATTEMPTS = 5

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", SMTP_USERNAME)
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Connect The Dots")

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)

app = FastAPI(
    title="Connect The Dots API",
    description="Authenticated API for user-owned topics and connections.",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    
     allow_origins=[
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
    "http://127.0.0.1:5502",
    "http://localhost:5502",

    # Production frontend
    "https://dot-universe.pages.dev",
    "https://67197948.dot-universe.pages.dev",
],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS dots (
                id TEXT PRIMARY KEY,
                universe_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                x REAL NOT NULL DEFAULT 0,
                y REAL NOT NULL DEFAULT 0,
                color TEXT NOT NULL DEFAULT '#47775a',
                icon TEXT NOT NULL DEFAULT 'fa-circle-nodes',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        connection.execute("""
            CREATE TABLE IF NOT EXISTS connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                universe_id TEXT NOT NULL,
                from_dot_id TEXT NOT NULL,
                to_dot_id TEXT NOT NULL,
                UNIQUE(universe_id, from_dot_id, to_dot_id)
            )
        """)

        user_columns = {row["name"] for row in connection.execute("PRAGMA table_info(users)")}
        if "email_verified" not in user_columns:
            # Existing accounts are retained as verified; new registrations explicitly use 0.
            connection.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS email_verification_codes (
                user_id TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_sent_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)

        # Safe, repeatable migration for databases created by backend v1.
        dot_columns = {row["name"] for row in connection.execute("PRAGMA table_info(dots)")}
        if "user_id" not in dot_columns:
            connection.execute("ALTER TABLE dots ADD COLUMN user_id TEXT")
        connection_columns = {row["name"] for row in connection.execute("PRAGMA table_info(connections)")}
        if "user_id" not in connection_columns:
            connection.execute("ALTER TABLE connections ADD COLUMN user_id TEXT")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_dots_user_universe ON dots(user_id, universe_id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_connections_user_universe ON connections(user_id, universe_id)")


@app.on_event("startup")
def startup() -> None:
    initialize_database()


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 2 or not any(char.isalpha() for char in value):
            raise ValueError("Enter a valid name with at least 2 characters.")
        if any(ord(char) < 32 for char in value):
            raise ValueError("Name contains unsupported characters.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        if value != value.strip():
            raise ValueError("Password cannot begin or end with spaces.")
        checks = [
            (any(c.islower() for c in value), "one lowercase letter"),
            (any(c.isupper() for c in value), "one uppercase letter"),
            (any(c.isdigit() for c in value), "one number"),
            (any(not c.isalnum() for c in value), "one special character"),
        ]
        missing = [label for passed, label in checks if not passed]
        if missing:
            raise ValueError("Password must contain " + ", ".join(missing) + ".")
        if len(set(value)) < 5:
            raise ValueError("Choose a less predictable password.")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)



class DotCreate(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    universe_id: str = Field(default="root", min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    x: float = 0
    y: float = 0
    color: str = "#47775a"
    icon: str = "fa-circle-nodes"
    created_at: Optional[str] = None


class DotUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    color: Optional[str] = None
    icon: Optional[str] = None


class ConnectionCreate(BaseModel):
    universe_id: str = "root"
    from_dot_id: str
    to_dot_id: str


def create_access_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "email_verified": bool(row["email_verified"]),
        "created_at": row["created_at"],
    }


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise jwt.InvalidTokenError("Missing subject")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Your session has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token.")

    with get_connection() as connection:
        user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        raise HTTPException(status_code=401, detail="Account no longer exists.")
    return public_user(user)


@app.get("/")
def root():
    return {"message": "Connect The Dots API is running", "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "connect-the-dots-api", "database": "sqlite"}


def hash_verification_code(user_id: str, code: str) -> str:
    message = f"{user_id}:{code}".encode("utf-8")
    return hmac.new(SECRET_KEY.encode("utf-8"), message, hashlib.sha256).hexdigest()



def send_verification_email(recipient: str, code: str) -> None:

    resend_api_key = os.getenv("RESEND_API_KEY")
    resend_from_email = os.getenv("RESEND_FROM_EMAIL")

    if not resend_api_key or not resend_from_email:
        raise HTTPException(
            status_code=503,
            detail="Resend email settings are not configured."
        )

    payload = {
        "from": resend_from_email,
        "to": [recipient],
        "subject": "Verify your Connect The Dots email",
        "text": (
            f"Your Connect The Dots verification code is: {code}\n\n"
            f"This code expires in {OTP_MINUTES} minutes. "
            "If you did not create this account, ignore this email."
        )
    }

    request = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
            "User-Agent":"DotUniverse/1.0",
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
            print("Resend email sent:", result.get("id"))

    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", "replace")
        print("Resend API error:", error.code, error_body)

        raise HTTPException(
            status_code=502,
            detail="Resend could not send the verification email."
        )

    except Exception as error:
        print("Email delivery error:", str(error))

        raise HTTPException(
            status_code=502,
            detail="Could not send verification email."
        )

def issue_verification_code(user_id: str, email: str, *, enforce_cooldown: bool = True) -> None:
    now = datetime.now(timezone.utc)
    with get_connection() as connection:
        previous = connection.execute(
            "SELECT last_sent_at FROM email_verification_codes WHERE user_id = ?", (user_id,)
        ).fetchone()
    if previous and enforce_cooldown:
        last_sent = datetime.fromisoformat(previous["last_sent_at"])
        if (now - last_sent).total_seconds() < OTP_RESEND_SECONDS:
            wait = OTP_RESEND_SECONDS - int((now - last_sent).total_seconds())
            raise HTTPException(status_code=429, detail=f"Please wait {wait} seconds before requesting another code.")

    code = f"{secrets.randbelow(1_000_000):06d}"
    # Send first; only replace the existing code after SMTP confirms delivery.
    send_verification_email(email, code)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO email_verification_codes (user_id, code_hash, expires_at, attempts, last_sent_at)
            VALUES (?, ?, ?, 0, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                code_hash=excluded.code_hash,
                expires_at=excluded.expires_at,
                attempts=0,
                last_sent_at=excluded.last_sent_at
            """,
            (
                user_id,
                hash_verification_code(user_id, code),
                (now + timedelta(minutes=OTP_MINUTES)).isoformat(),
                now.isoformat(),
            ),
        )


class VerifyEmailRequest(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class ResendVerificationRequest(BaseModel):
    email: EmailStr


@app.post("/api/auth/register", status_code=201)
def register(data: RegisterRequest):
    email = data.email.strip().lower()
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Please enter your name.")
    user_id = str(uuid4())
    hashed = password_hash.hash(data.password)
    with get_connection() as connection:
        try:
            existing_users = connection.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
            connection.execute(
                "INSERT INTO users (id, name, email, password_hash, role, email_verified) VALUES (?, ?, ?, ?, 'user', 0)",
                (user_id, name, email, hashed),
            )
            if existing_users == 0:
                connection.execute("UPDATE dots SET user_id = ? WHERE user_id IS NULL", (user_id,))
                connection.execute("UPDATE connections SET user_id = ? WHERE user_id IS NULL", (user_id,))
        except sqlite3.IntegrityError:
            existing_user = connection.execute(
                "SELECT email_verified FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone()
            if existing_user is not None and not existing_user["email_verified"]:
                detail = "An unverified account with this email already exists. Request a new code."
            else:
                detail = "An account with this email already exists. Please sign in."
            raise HTTPException(status_code=409, detail=detail)
    try:
        issue_verification_code(user_id, email, enforce_cooldown=False)
    except HTTPException:
        with get_connection() as connection:
            connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        raise
    return {"verification_required": True, "email": email, "message": "A verification code has been sent to your email."}


@app.post("/api/auth/verify-email")
def verify_email(data: VerifyEmailRequest):
    email = data.email.strip().lower()
    failure = None
    verified_user = None
    with get_connection() as connection:
        user = connection.execute("SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)).fetchone()
        if user is None:
            failure = (400, "Invalid email or verification code.")
        elif user["email_verified"]:
            failure = (400, "This email is already verified. Please sign in.")
        else:
            record = connection.execute(
                "SELECT * FROM email_verification_codes WHERE user_id = ?", (user["id"],)
            ).fetchone()
            if record is None:
                failure = (400, "No active verification code. Request a new one.")
            elif datetime.now(timezone.utc) > datetime.fromisoformat(record["expires_at"]):
                connection.execute("DELETE FROM email_verification_codes WHERE user_id = ?", (user["id"],))
                failure = (400, "Verification code expired. Request a new one.")
            elif record["attempts"] >= OTP_MAX_ATTEMPTS:
                failure = (429, "Too many incorrect attempts. Request a new code.")
            else:
                expected = hash_verification_code(user["id"], data.code)
                if not hmac.compare_digest(expected, record["code_hash"]):
                    connection.execute(
                        "UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = ?",
                        (user["id"],),
                    )
                    failure = (400, "Incorrect verification code.")
                else:
                    connection.execute("UPDATE users SET email_verified = 1 WHERE id = ?", (user["id"],))
                    connection.execute("DELETE FROM email_verification_codes WHERE user_id = ?", (user["id"],))
                    verified_user = connection.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
    if failure:
        raise HTTPException(status_code=failure[0], detail=failure[1])
    token = create_access_token(verified_user["id"], verified_user["role"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(verified_user)}


@app.post("/api/auth/resend-verification")
def resend_verification(data: ResendVerificationRequest):
    email = data.email.strip().lower()
    with get_connection() as connection:
        user = connection.execute("SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)).fetchone()
    if user is None or user["email_verified"]:
        # Avoid revealing whether an address has an account.
        return {"message": "If an unverified account exists, a new code will be sent."}
    issue_verification_code(user["id"], user["email"])
    return {"message": "A new verification code has been sent."}



@app.post("/api/auth/login")
def login(data: LoginRequest):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM users WHERE email = ? COLLATE NOCASE",
            (data.email.strip().lower(),),
        ).fetchone()
    if row is None or not password_hash.verify(data.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    if not row["email_verified"]:
        raise HTTPException(status_code=403, detail="Please verify your email before signing in.")
    token = create_access_token(row["id"], row["role"])
    return {"access_token": token, "token_type": "bearer", "user": public_user(row)}



@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return user


@app.get("/api/dots")
def list_dots(universe_id: str = "root", user: dict = Depends(get_current_user)):
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM dots WHERE user_id = ? AND universe_id = ? ORDER BY created_at, id",
            (user["id"], universe_id),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/dots", status_code=201)
def create_dot(dot: DotCreate, user: dict = Depends(get_current_user)):
    with get_connection() as connection:
        try:
            connection.execute(
                """
                INSERT INTO dots
                (id, universe_id, name, description, x, y, color, icon, created_at, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?)
                """,
                (
                    dot.id, dot.universe_id, dot.name.strip(), dot.description,
                    dot.x, dot.y, dot.color, dot.icon, dot.created_at, user["id"],
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="This dot ID already exists.")
        row = connection.execute(
            "SELECT * FROM dots WHERE id = ? AND user_id = ?", (dot.id, user["id"])
        ).fetchone()
    return dict(row)


@app.patch("/api/dots/{dot_id}")
def update_dot(dot_id: str, update: DotUpdate, user: dict = Depends(get_current_user)):
    fields = update.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields supplied.")
    allowed = {"name", "description", "x", "y", "color", "icon"}
    if any(field not in allowed for field in fields):
        raise HTTPException(status_code=400, detail="Unsupported field.")
    assignments = ", ".join(f"{field} = ?" for field in fields)
    values = list(fields.values()) + [dot_id, user["id"]]
    with get_connection() as connection:
        cursor = connection.execute(
            f"UPDATE dots SET {assignments} WHERE id = ? AND user_id = ?", values
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dot not found.")
        row = connection.execute(
            "SELECT * FROM dots WHERE id = ? AND user_id = ?", (dot_id, user["id"])
        ).fetchone()
    return dict(row)


@app.delete("/api/dots/{dot_id}")
def delete_dot(dot_id: str, user: dict = Depends(get_current_user)):
    with get_connection() as connection:
        cursor = connection.execute(
            "DELETE FROM dots WHERE id = ? AND user_id = ?", (dot_id, user["id"])
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Dot not found.")
        connection.execute(
            "DELETE FROM connections WHERE user_id = ? AND (from_dot_id = ? OR to_dot_id = ?)",
            (user["id"], dot_id, dot_id),
        )
    return {"deleted": True, "id": dot_id}


@app.get("/api/connections")
def list_connections(universe_id: str = "root", user: dict = Depends(get_current_user)):
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT from_dot_id, to_dot_id FROM connections
            WHERE user_id = ? AND universe_id = ?
            """,
            (user["id"], universe_id),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/connections", status_code=201)
def create_connection(item: ConnectionCreate, user: dict = Depends(get_current_user)):
    if item.from_dot_id == item.to_dot_id:
        raise HTTPException(status_code=400, detail="A dot cannot connect to itself.")
    with get_connection() as connection:
        dot_ids = {
            row["id"] for row in connection.execute(
                "SELECT id FROM dots WHERE user_id = ? AND universe_id = ?",
                (user["id"], item.universe_id),
            ).fetchall()
        }
        if item.from_dot_id not in dot_ids or item.to_dot_id not in dot_ids:
            raise HTTPException(status_code=404, detail="Both dots must belong to your universe.")
        try:
            connection.execute(
                """
                INSERT INTO connections (universe_id, from_dot_id, to_dot_id, user_id)
                VALUES (?, ?, ?, ?)
                """,
                (item.universe_id, item.from_dot_id, item.to_dot_id, user["id"]),
            )
        except sqlite3.IntegrityError:
            pass
    return {
        "universe_id": item.universe_id,
        "from_dot_id": item.from_dot_id,
        "to_dot_id": item.to_dot_id,
    }

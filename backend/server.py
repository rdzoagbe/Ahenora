import os
import io
import json
import base64
import asyncio
import hashlib
import secrets
import tempfile
import html
import urllib.error
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
try:
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:
    AsyncIOMotorClient = None
from google.oauth2 import id_token as google_id_token
from google.auth.transport.requests import Request as GoogleRequest
try:
    import google.generativeai as genai
except ImportError:
    genai = None
import PIL.Image


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "")
DB_NAME = os.environ.get("DB_NAME", "household_coo")
GOOGLE_WEB_CLIENT_ID = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
GOOGLE_ANDROID_CLIENT_ID = os.environ.get("GOOGLE_ANDROID_CLIENT_ID", "")
GOOGLE_CLIENT_IDS_EXTRA = os.environ.get("GOOGLE_CLIENT_IDS", "")
# Fallback web client ID — must match the app's hardcoded fallback in
# frontend/app/index.tsx so Google sign-in still verifies if the Railway env
# var is ever unset. The token audience is this web client ID.
GOOGLE_WEB_CLIENT_ID_FALLBACK = "243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com"
GOOGLE_CLIENT_IDS = [
    client_id.strip()
    for client_id in [
        GOOGLE_WEB_CLIENT_ID,
        GOOGLE_ANDROID_CLIENT_ID,
        *GOOGLE_CLIENT_IDS_EXTRA.split(","),
        GOOGLE_WEB_CLIENT_ID_FALLBACK,
    ]
    if client_id and client_id.strip()
]
# De-duplicate while preserving order.
GOOGLE_CLIENT_IDS = list(dict.fromkeys(GOOGLE_CLIENT_IDS))
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "7"))
INVITE_DAYS = int(os.environ.get("INVITE_DAYS", "14"))
INVITE_BASE_URL = os.environ.get("INVITE_BASE_URL", "householdcoo:///")

# Email delivery. Resend is used through the standard-library urllib client,
# so no extra Python package is required.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
INVITE_FROM_EMAIL = os.environ.get("INVITE_FROM_EMAIL", "")
INVITE_REPLY_TO = os.environ.get("INVITE_REPLY_TO", "")
APP_NAME = os.environ.get("APP_NAME", "Household COO")
MAX_VOICE_AUDIO_BYTES = int(os.environ.get("MAX_VOICE_AUDIO_BYTES", str(12 * 1024 * 1024)))
ADMIN_EMAILS_RAW = os.environ.get("ADMIN_EMAILS", "")
ADMIN_EMAILS = {
    email.strip().lower()
    for email in ADMIN_EMAILS_RAW.split(",")
    if email.strip()
}

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
] or [
    "https://household-coo.app",
    "https://www.household-coo.app",
    "householdcoo://",
    "exp://",
]

if GOOGLE_API_KEY and genai:
    genai.configure(api_key=GOOGLE_API_KEY)

mongo = AsyncIOMotorClient(MONGO_URL, serverSelectionTimeoutMS=5000) if MONGO_URL else None
db: Any = mongo[DB_NAME] if mongo else None

import logging
from collections import defaultdict
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

log = logging.getLogger("household_coo")

app = FastAPI(title="Household COO Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Rate limiting (in-memory, per-IP)
# -----------------------------------------------------------------------------
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = int(os.environ.get("RATE_LIMIT_MAX", "120"))
# Auth limit is per IP+path. Kept generous so a cohort of testers sharing one
# egress IP (home/office/school NAT), each with client-side retries, doesn't
# collectively trip a 429 on sign-in. Still low enough to blunt brute force.
RATE_LIMIT_AUTH_MAX = int(os.environ.get("RATE_LIMIT_AUTH_MAX", "60"))

_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(bucket: list[float], now: float) -> list[float]:
    cutoff = now - RATE_LIMIT_WINDOW
    return [t for t in bucket if t > cutoff]


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        import time

        ip = _client_ip(request)
        now = time.time()
        key = f"{ip}:{request.url.path}"

        is_auth = request.url.path.startswith("/api/auth/")
        limit = RATE_LIMIT_AUTH_MAX if is_auth else RATE_LIMIT_MAX

        bucket = _prune(_rate_buckets[key], now)
        if len(bucket) >= limit:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
            )
        bucket.append(now)
        _rate_buckets[key] = bucket

        return await call_next(request)


app.add_middleware(RateLimitMiddleware)


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    return dt.astimezone(timezone.utc).isoformat()


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    value = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def ensure_aware_utc(value):
    if not value:
        return None
    if isinstance(value, str):
        return parse_dt(value)
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return None


def advance_due_date(dt: datetime, recurrence: str) -> datetime:
    """Return the next occurrence for a recurring card's due date."""
    if recurrence == "daily":
        return dt + timedelta(days=1)
    if recurrence == "weekly":
        return dt + timedelta(weeks=1)
    if recurrence == "monthly":
        month = dt.month + 1
        year = dt.year + (month - 1) // 12
        month = (month - 1) % 12 + 1
        # Clamp the day to the last valid day of the target month.
        for day in (dt.day, 30, 29, 28):
            try:
                return dt.replace(year=year, month=month, day=day)
            except ValueError:
                continue
    return dt


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


PASSWORD_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), PASSWORD_ITERATIONS
    )
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt, hexhash = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), int(iterations)
        )
        return secrets.compare_digest(dk.hex(), hexhash)
    except Exception:
        return False


def is_admin_email(email: str) -> bool:
    return bool(email) and email.strip().lower() in ADMIN_EMAILS


def is_admin_user(user: dict) -> bool:
    return is_admin_email(user.get("email", ""))


def apply_admin_subscription(subscription: dict) -> dict:
    # Admin/tester accounts keep their own family data, but plan limits are bypassed
    # so the founder can test every feature without changing customer billing rules.
    admin_sub = dict(subscription)
    admin_sub["plan"] = "family_office"
    admin_sub["billing_cycle"] = admin_sub.get("billing_cycle", "yearly")
    admin_sub["grandfathered"] = True
    admin_sub["admin_unlocked"] = True
    admin_sub["limits"] = {
        "max_members": 999,
        "ai_scans_per_month": 999999,
        "vault_bytes": 50 * 1024 * 1024 * 1024,
        "weekly_brief": True,
        "multi_property": True,
        "meal_planner": True,
        "allowance": True,
        "carpool": True,
        "weekly_report": True,
    }
    admin_sub["price_monthly"] = 0.0
    admin_sub["price_yearly"] = 0.0
    return admin_sub


def get_db() -> Any:
    if db is None:
        raise HTTPException(status_code=500, detail="Database not configured")
    return db


def _gemini(system: str = ""):
    return genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system or None,
    )


async def _gemini_text(prompt: str, system: str = "") -> str:
    model = _gemini(system)
    response = await asyncio.to_thread(model.generate_content, prompt)
    return (response.text or "").strip()


async def _gemini_vision(prompt: str, image_base64: str, system: str = "") -> str:
    model = _gemini(system)
    if "," in image_base64:
        image_base64 = image_base64.split(",")[-1]
    img_bytes = base64.b64decode(image_base64)
    img = PIL.Image.open(io.BytesIO(img_bytes))
    response = await asyncio.to_thread(model.generate_content, [prompt, img])
    return (response.text or "").strip()


PLAN_CATALOG = {
    "village": {
        "price_monthly": 0.0,
        "price_yearly": 0.0,
        "limits": {
            # TESTING WINDOW: caps relaxed so closed-test families can explore
            # freely (a tester hit the 3-member wall adding a 3rd child with no
            # way to upgrade). Role-aware enforcement (parents free, children
            # metered 1/4/10) ships with Play Billing — see docs/ROADMAP.md.
            "max_members": 10,
            "ai_scans_per_month": 5,
            "vault_bytes": 20 * 1024 * 1024,
            "weekly_brief": False,
            "multi_property": False,
            # Premium feature flags (Executive+ only)
            "meal_planner": False,
            "allowance": False,
            "carpool": False,
            "weekly_report": False,
        },
    },
    "executive": {
        "price_monthly": 8.99,
        "price_yearly": 69.99,
        "limits": {
            "max_members": 8,
            "ai_scans_per_month": 100,
            "vault_bytes": 250 * 1024 * 1024,
            "weekly_brief": True,
            "multi_property": False,
            "meal_planner": True,
            "allowance": True,
            "carpool": True,
            "weekly_report": True,
        },
    },
    "family_office": {
        "price_monthly": 19.99,
        "price_yearly": 179.99,
        "limits": {
            "max_members": 20,
            "ai_scans_per_month": 1000,
            "vault_bytes": 2 * 1024 * 1024 * 1024,
            "weekly_brief": True,
            "multi_property": True,
            "meal_planner": True,
            "allowance": True,
            "carpool": True,
            "weekly_report": True,
        },
    },
}

# Features gated behind paid plans. Maps the feature flag to a user-facing
# upgrade message used when a free-tier family hits the gate (HTTP 402).
PREMIUM_FEATURE_MESSAGES = {
    "meal_planner": "Meal Planner is available on Executive and Family Office plans.",
    "allowance": "Allowance Tracker is available on Executive and Family Office plans.",
    "carpool": "Carpool Coordinator is available on Executive and Family Office plans.",
    "weekly_report": "Weekly Report is available on Executive and Family Office plans.",
}


def plan_limit_error(feature: str, current_plan: str, message: str, limit=None, used=None):
    raise HTTPException(
        status_code=402,
        detail={
            "error": "plan_limit",
            "feature": feature,
            "current_plan": current_plan,
            "limit": limit,
            "used": used,
            "message": message,
        },
    )


async def require_feature(user: dict, feature: str):
    """Gate a premium feature: raises HTTP 402 if the family's plan doesn't
    include it. Admin/founder accounts always pass. Returns the subscription."""
    sub = await build_subscription(user["family_id"])
    if is_admin_user(user):
        return apply_admin_subscription(sub)
    if not sub["limits"].get(feature, True):
        plan_limit_error(
            feature=feature,
            current_plan=sub["plan"],
            message=PREMIUM_FEATURE_MESSAGES.get(feature, "Upgrade to use this feature."),
        )
    return sub


AI_SCAN_PERIOD_DAYS = 30


def _coerce_dt(value):
    """Best-effort parse of a stored datetime (datetime or ISO string).

    Always returns a timezone-aware UTC datetime so it can be safely compared
    against utcnow(). PyMongo returns naive datetimes by default, so naive
    values are assumed to be UTC.
    """
    parsed = None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


async def get_family_doc(family_id: str):
    database = get_db()
    family = await database["families"].find_one({"family_id": family_id}, {"_id": 0})
    if not family:
        family = {
            "family_id": family_id,
            "plan": "village",
            "billing_cycle": "monthly",
            "grandfathered": False,
            "updated_at": utcnow(),
            "ai_scans_used": 0,
            "ai_scans_period_start": utcnow(),
            "vault_bytes_used": 0,
        }
        await database["families"].insert_one(family)
        return family

    # Roll the monthly AI-scan counter over once the period has elapsed so the
    # "per month" limit actually behaves monthly instead of being a lifetime cap.
    period_start = _coerce_dt(family.get("ai_scans_period_start"))
    now = utcnow()
    if period_start is None or (now - period_start) >= timedelta(days=AI_SCAN_PERIOD_DAYS):
        await database["families"].update_one(
            {"family_id": family_id},
            {"$set": {"ai_scans_used": 0, "ai_scans_period_start": now}},
        )
        family["ai_scans_used"] = 0
        family["ai_scans_period_start"] = now
    return family


async def build_subscription(family_id: str):
    database = get_db()
    family = await get_family_doc(family_id)
    members_count = await database["family_members"].count_documents({"family_id": family_id})
    catalog = PLAN_CATALOG[family["plan"]]
    return {
        "plan": family["plan"],
        "billing_cycle": family["billing_cycle"],
        "grandfathered": family.get("grandfathered", False),
        "updated_at": iso(family.get("updated_at")),
        "ai_scans_used": family.get("ai_scans_used", 0),
        "ai_scans_period_start": iso(family.get("ai_scans_period_start")),
        "vault_bytes_used": family.get("vault_bytes_used", 0),
        "members_count": members_count,
        "limits": catalog["limits"],
        "price_monthly": catalog["price_monthly"],
        "price_yearly": catalog["price_yearly"],
    }


def public_user(user: dict) -> dict:
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture"),
        "family_id": user["family_id"],
        "language": user.get("language", "en"),
        "is_admin": is_admin_email(user.get("email", "")),
        # Absent field (existing users predating onboarding) reads as True so
        # they never get sent through first-run setup. Only accounts explicitly
        # created with False (new sign-ups) see onboarding.
        "onboarding_completed": bool(user.get("onboarding_completed", True)),
    }


def public_member(member: dict) -> dict:
    return {
        "member_id": member["member_id"],
        "family_id": member["family_id"],
        "name": member["name"],
        "role": member["role"],
        "avatar": member.get("avatar"),
        "stars": member.get("stars", 0),
        "has_pin": bool(member.get("pin_hash")),
        "has_account": bool(member.get("user_id")),
    }


def public_card(card: dict) -> dict:
    return {
        "card_id": card["card_id"],
        "family_id": card["family_id"],
        "type": card["type"],
        "title": card["title"],
        "description": card.get("description"),
        "assignee": card.get("assignee"),
        "due_date": iso(card.get("due_date")),
        "status": card["status"],
        "source": card["source"],
        "image_base64": card.get("image_base64"),
        "recurrence": card.get("recurrence", "none"),
        "reminder_minutes": card.get("reminder_minutes", 60),
        "created_at": iso(card["created_at"]),
        "completed_at": iso(card.get("completed_at")),
        "google_event_id": card.get("google_event_id"),
        "google_ical_uid": card.get("google_ical_uid"),
        "external_source": card.get("external_source"),
    }


def public_reward(reward: dict) -> dict:
    return {
        "reward_id": reward["reward_id"],
        "family_id": reward["family_id"],
        "title": reward["title"],
        "cost_stars": reward["cost_stars"],
        "icon": reward.get("icon"),
        "created_at": iso(reward["created_at"]),
    }



def public_star_transaction(transaction: dict) -> dict:
    return {
        "transaction_id": transaction["transaction_id"],
        "family_id": transaction["family_id"],
        "member_id": transaction["member_id"],
        "delta": transaction["delta"],
        "reason": transaction.get("reason"),
        "created_by_user_id": transaction.get("created_by_user_id"),
        "created_by_name": transaction.get("created_by_name"),
        "created_at": iso(transaction.get("created_at")),
    }


def public_vault_doc(doc: dict) -> dict:
    return {
        "doc_id": doc["doc_id"],
        "family_id": doc["family_id"],
        "title": doc["title"],
        "category": doc["category"],
        "image_base64": doc["image_base64"],
        "mime_type": doc.get("mime_type") or "image/jpeg",
        "file_name": doc.get("file_name"),
        "created_at": iso(doc["created_at"]),
    }


def build_invite_url(token: str) -> str:
    base = INVITE_BASE_URL.strip() or "householdcoo:///"
    if "{token}" in base:
        return base.replace("{token}", token)
    joiner = "&" if "?" in base else "?"
    return f"{base}{joiner}invite={token}"


async def send_invite_email(to_email: str, invite_url: str, inviter_name: str, inviter_email: str = "") -> dict:
    if not RESEND_API_KEY or not INVITE_FROM_EMAIL:
        return {
            "sent": False,
            "error": "Email delivery is not configured. Set RESEND_API_KEY and INVITE_FROM_EMAIL in Railway.",
        }

    safe_app_name = html.escape(APP_NAME)
    safe_inviter = html.escape(inviter_name or "A family member")
    safe_invite_url = html.escape(invite_url)
    safe_to = html.escape(to_email)

    subject = f"{inviter_name or 'A family member'} invited you to {APP_NAME}"

    text = (
        f"{inviter_name or 'A family member'} invited you to join their household in {APP_NAME}.\n\n"
        f"Open this invite link:\n{invite_url}\n\n"
        "If you were not expecting this invitation, you can ignore this email."
    )

    html_body = f"""
<div style="font-family: Arial, sans-serif; background:#080910; padding:32px;">
  <div style="max-width:560px; margin:0 auto; background:#141620; border:1px solid rgba(255,255,255,0.10); border-radius:24px; padding:28px;">
    <div style="font-size:13px; letter-spacing:1.2px; text-transform:uppercase; color:#F59E0B; font-weight:700;">{safe_app_name}</div>
    <h1 style="color:#ffffff; font-size:28px; margin:12px 0 8px;">You have been invited</h1>
    <p style="color:rgba(255,255,255,0.72); line-height:1.55; font-size:15px;">
      <strong style="color:#ffffff;">{safe_inviter}</strong> invited <strong style="color:#ffffff;">{safe_to}</strong>
      to join their household workspace.
    </p>
    <a href="{safe_invite_url}" style="display:inline-block; margin-top:18px; background:#ffffff; color:#080910; text-decoration:none; font-weight:700; padding:13px 18px; border-radius:999px;">
      Join household
    </a>
    <p style="color:rgba(255,255,255,0.45); font-size:12px; line-height:1.5; margin-top:24px;">
      If the button does not open the app, copy and paste this link:<br />
      <span style="word-break:break-all;">{safe_invite_url}</span>
    </p>
  </div>
</div>
""".strip()

    payload = {
        "from": INVITE_FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
        "text": text,
        "html": html_body,
    }

    reply_to = INVITE_REPLY_TO or inviter_email
    if reply_to:
        payload["reply_to"] = reply_to

    def _send():
        req = urllib.request.Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                raw = response.read().decode("utf-8")
                try:
                    parsed = json.loads(raw) if raw else {}
                except Exception:
                    parsed = {"raw": raw}
                return {"sent": True, "provider": "resend", "response": parsed}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return {
                "sent": False,
                "provider": "resend",
                "error": f"Resend HTTP {e.code}: {body}",
            }
        except Exception as e:
            return {"sent": False, "provider": "resend", "error": str(e)}

    return await asyncio.to_thread(_send)



def public_invite(invite: dict) -> dict:
    return {
        "invite_id": invite["invite_id"],
        "family_id": invite["family_id"],
        "email": invite.get("email"),
        "status": invite.get("status", "pending"),
        "token": invite.get("token"),
        "invite_url": build_invite_url(invite["token"]),
        "created_at": iso(invite.get("created_at")),
        "expires_at": iso(invite.get("expires_at")),
        "accepted_at": iso(invite.get("accepted_at")),
        "accepted_by_email": invite.get("accepted_by_email"),
        "created_by_name": invite.get("created_by_name"),
    }


def public_calendar_contact(contact: dict) -> dict:
    return {
        "email": contact.get("email"),
        "name": contact.get("name"),
        "event_count": contact.get("event_count", 0),
        "last_seen_at": iso(contact.get("last_seen_at")),
        "first_seen_at": iso(contact.get("first_seen_at")),
        "last_event_title": contact.get("last_event_title"),
    }


def public_handoff_note(note: dict) -> dict:
    return {
        "note_id": note["note_id"],
        "family_id": note["family_id"],
        "member_id": note.get("member_id"),
        "member_name": note.get("member_name"),
        "text": note["text"],
        "author_name": note.get("author_name", ""),
        "created_at": iso(note["created_at"]),
    }


def public_shopping_item(item: dict) -> dict:
    return {
        "item_id": item["item_id"],
        "family_id": item["family_id"],
        "name": item["name"],
        "category": item.get("category", "Other"),
        "checked": item.get("checked", False),
        "added_by": item.get("added_by", ""),
        "created_at": iso(item["created_at"]),
    }


def public_expense(exp: dict) -> dict:
    return {
        "expense_id": exp["expense_id"],
        "family_id": exp["family_id"],
        "description": exp["description"],
        "amount": exp["amount"],
        "category": exp.get("category", "General"),
        "child_member_id": exp.get("child_member_id"),
        "child_name": exp.get("child_name"),
        "paid_by_name": exp.get("paid_by_name", ""),
        "paid_by_user_id": exp.get("paid_by_user_id"),
        "created_at": iso(exp["created_at"]),
    }


def public_template(tmpl: dict) -> dict:
    return {
        "template_id": tmpl["template_id"],
        "family_id": tmpl["family_id"],
        "title": tmpl["title"],
        "description": tmpl.get("description"),
        "recurrence": tmpl.get("recurrence", "daily"),
        "time_of_day": tmpl.get("time_of_day"),
        "assignee": tmpl.get("assignee"),
        "enabled": tmpl.get("enabled", True),
        "created_at": iso(tmpl["created_at"]),
    }


def public_routine(r: dict) -> dict:
    return {
        "routine_id": r["routine_id"],
        "family_id": r["family_id"],
        "name": r["name"],
        "steps": r.get("steps", []),
        "member_id": r.get("member_id"),
        "created_at": iso(r["created_at"]),
    }


def public_meal(m: dict) -> dict:
    return {
        "meal_id": m["meal_id"],
        "family_id": m["family_id"],
        "day": m["day"],
        "meal_type": m.get("meal_type", "dinner"),
        "title": m["title"],
        "ingredients": m.get("ingredients", []),
        "notes": m.get("notes"),
        "created_at": iso(m["created_at"]),
    }


def public_carpool(c: dict) -> dict:
    return {
        "carpool_id": c["carpool_id"],
        "family_id": c["family_id"],
        "title": c["title"],
        "day_of_week": c["day_of_week"],
        "time": c.get("time", ""),
        "driver_name": c.get("driver_name", ""),
        "pickup_kids": c.get("pickup_kids", []),
        "notes": c.get("notes"),
        "created_at": iso(c["created_at"]),
    }


def public_allowance_config(a: dict) -> dict:
    return {
        "allowance_id": a["allowance_id"],
        "family_id": a["family_id"],
        "member_id": a["member_id"],
        "amount": a["amount"],
        "frequency": a.get("frequency", "weekly"),
        "created_at": iso(a["created_at"]),
    }


def public_allowance_txn(t: dict) -> dict:
    return {
        "txn_id": t["txn_id"],
        "family_id": t["family_id"],
        "member_id": t["member_id"],
        "amount": t["amount"],
        "description": t.get("description", ""),
        "txn_type": t.get("txn_type", "deposit"),
        "created_at": iso(t["created_at"]),
    }


def public_announcement(a: dict) -> dict:
    return {
        "announcement_id": a["announcement_id"],
        "family_id": a["family_id"],
        "text": a["text"],
        "author_name": a.get("author_name", ""),
        "priority": a.get("priority", "normal"),
        "created_at": iso(a["created_at"]),
    }


def public_chore(c: dict) -> dict:
    return {
        "chore_id": c["chore_id"],
        "family_id": c["family_id"],
        "title": c["title"],
        "frequency": c.get("frequency", "daily"),
        "assigned_members": c.get("assigned_members", []),
        "current_assignee": c.get("current_assignee"),
        "rotate": c.get("rotate", True),
        "last_rotated": iso(c.get("last_rotated")),
        "created_at": iso(c["created_at"]),
    }



async def add_user_to_family_if_needed(database: Any, user: dict, family_id: str):
    existing = await database["family_members"].find_one(
        {
            "family_id": family_id,
            "$or": [
                {"user_id": user["user_id"]},
                {"email": user.get("email", "")},
            ],
        },
        {"_id": 0},
    )
    if existing:
        return existing

    member = {
        "member_id": new_id("member"),
        "family_id": family_id,
        "user_id": user["user_id"],
        "email": user.get("email", ""),
        "name": user.get("name") or user.get("email") or "Parent",
        "role": "Parent",
        "avatar": user.get("picture"),
        "stars": 0,
        "pin_hash": None,
        "created_at": utcnow(),
    }
    await database["family_members"].insert_one(member)
    return member


def public_notification_settings(settings: Optional[dict]) -> dict:
    settings = settings or {}
    return {
        "card_reminders": bool(settings.get("card_reminders", False)),
        "new_card_alerts": bool(settings.get("new_card_alerts", False)),
        "updated_at": iso(settings.get("updated_at")),
    }


async def get_notification_settings_doc(user_id: str) -> dict:
    database = get_db()
    settings = await database["notification_settings"].find_one(
        {"user_id": user_id},
        {"_id": 0},
    )
    if settings:
        return settings

    settings = {
        "user_id": user_id,
        "card_reminders": False,
        "new_card_alerts": False,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await database["notification_settings"].insert_one(settings)
    return settings


async def send_expo_push_messages(messages: list[dict]) -> dict:
    if not messages:
        return {"sent": 0, "skipped": True}

    def _send():
        req = urllib.request.Request(
            "https://exp.host/--/api/v2/push/send",
            data=json.dumps(messages).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                raw = response.read().decode("utf-8")
                try:
                    parsed = json.loads(raw) if raw else {}
                except Exception:
                    parsed = {"raw": raw}
                return {"sent": len(messages), "response": parsed}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return {"sent": 0, "error": f"Expo push HTTP {e.code}: {body}"}
        except Exception as e:
            return {"sent": 0, "error": str(e)}

    return await asyncio.to_thread(_send)


STAR_MILESTONE = 50


async def send_star_milestone_alert(family_id: str, member_name: str, old_total: int, new_total: int):
    """Notify the family's devices when a child crosses a 50-star milestone."""
    try:
        if new_total // STAR_MILESTONE <= old_total // STAR_MILESTONE:
            return
        milestone = (new_total // STAR_MILESTONE) * STAR_MILESTONE
        database = get_db()
        messages = []
        cursor = database["notification_tokens"].find(
            {"family_id": family_id, "active": True}, {"_id": 0}
        )
        async for token_doc in cursor:
            token = token_doc.get("token")
            if not token or not token.startswith("ExponentPushToken"):
                continue
            messages.append({
                "to": token,
                "sound": "default",
                "title": f"{member_name} reached {milestone} stars!",
                "body": "Amazing work — time to celebrate with a reward?",
                "data": {"type": "star_milestone", "family_id": family_id},
            })
        if messages:
            await send_expo_push_messages(messages)
    except Exception as e:
        log.warning("star milestone alert failed: %s", e)


async def send_new_card_alert(family_id: str, card: dict, created_by_user_id: Optional[str] = None):
    database = get_db()
    messages = []

    cursor = database["notification_tokens"].find(
        {
            "family_id": family_id,
            "active": True,
        },
        {"_id": 0},
    )

    async for token_doc in cursor:
        if created_by_user_id and token_doc.get("user_id") == created_by_user_id:
            continue

        prefs = await database["notification_settings"].find_one(
            {"user_id": token_doc.get("user_id")},
            {"_id": 0},
        )

        if not prefs or not prefs.get("new_card_alerts"):
            continue

        token = token_doc.get("token")
        if not token or not token.startswith("ExponentPushToken"):
            continue

        messages.append(
            {
                "to": token,
                "sound": "default",
                "title": "New Household COO card",
                "body": card.get("title") or "A new card was added.",
                "data": {
                    "type": "new_card",
                    "card_id": card.get("card_id"),
                    "family_id": family_id,
                },
            }
        )

    if messages:
        await send_expo_push_messages(messages)



async def require_user(authorization: str = Header(default="")):
    database = get_db()

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = authorization.replace("Bearer ", "", 1).strip()
    session = await database["user_sessions"].find_one(
        {"token_hash": sha256(token), "expires_at": {"$gt": utcnow()}},
        {"_id": 0},
    )
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user = await database["users"].find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # Daily-active tracking, throttled to one write per user per day.
    today = utcnow().strftime("%Y-%m-%d")
    if user.get("last_active_day") != today:
        try:
            await database["users"].update_one(
                {"user_id": user["user_id"]},
                {"$set": {"last_active_day": today}},
            )
            await database["metrics_daily"].update_one(
                {"date": today, "name": "active_users"},
                {"$inc": {"count": 1}},
                upsert=True,
            )
        except Exception:
            pass  # metrics must never break auth

    return user


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class SessionIn(BaseModel):
    session_id: str
    invite_token: Optional[str] = None



class EmailRegisterIn(BaseModel):
    name: str
    email: str
    password: str
    invite_token: Optional[str] = None


class EmailLoginIn(BaseModel):
    email: str
    password: str


class InviteIn(BaseModel):
    email: str


class LanguageIn(BaseModel):
    language: str


class PinIn(BaseModel):
    pin: str


class AiAssignIn(BaseModel):
    title: str
    description: str = ""
    type: str = "TASK"


class CardIn(BaseModel):
    type: str = "TASK"
    title: str
    description: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    source: str = "MANUAL"
    image_base64: Optional[str] = None
    recurrence: str = "none"
    reminder_minutes: int = 60


class CardPatchIn(BaseModel):
    type: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    recurrence: Optional[str] = None
    reminder_minutes: Optional[int] = None


class VaultIn(BaseModel):
    title: str
    category: str
    image_base64: str
    mime_type: Optional[str] = None
    file_name: Optional[str] = None


class RewardIn(BaseModel):
    title: str
    cost_stars: int
    icon: Optional[str] = None


class ChildIn(BaseModel):
    name: str
    starting_stars: int = 0
    pin: Optional[str] = None


class StarAdjustmentIn(BaseModel):
    delta: int
    reason: Optional[str] = None


class RewardPatchIn(BaseModel):
    title: Optional[str] = None
    cost_stars: Optional[int] = None
    icon: Optional[str] = None


class RedeemIn(BaseModel):
    member_id: str


class SubscriptionChangeIn(BaseModel):
    plan: str
    billing_cycle: str


class VisionIn(BaseModel):
    image_base64: str

class CalendarImportIn(BaseModel):
    access_token: str
    days: int = 30


class NotificationTokenIn(BaseModel):
    token: str
    platform: Optional[str] = None


class NotificationPrefsIn(BaseModel):
    card_reminders: Optional[bool] = None
    new_card_alerts: Optional[bool] = None


class HandoffNoteIn(BaseModel):
    member_id: Optional[str] = None
    text: str


class ShoppingItemIn(BaseModel):
    name: str
    category: str = "Other"


class ShoppingItemPatchIn(BaseModel):
    checked: Optional[bool] = None
    name: Optional[str] = None
    category: Optional[str] = None


class ExpenseIn(BaseModel):
    description: str
    amount: float
    category: str = "General"
    child_member_id: Optional[str] = None


class TemplateIn(BaseModel):
    title: str
    description: Optional[str] = None
    recurrence: str = "daily"
    time_of_day: Optional[str] = None
    assignee: Optional[str] = None


class RoutineIn(BaseModel):
    name: str
    steps: list  # [{"label": str, "duration_seconds": int}]
    member_id: Optional[str] = None


class RoutinePatchIn(BaseModel):
    name: Optional[str] = None
    steps: Optional[list] = None


class MealPlanIn(BaseModel):
    day: str  # "monday", "tuesday", etc.
    meal_type: str = "dinner"  # breakfast, lunch, dinner, snack
    title: str
    ingredients: list = []  # [str]
    notes: Optional[str] = None


class CarpoolIn(BaseModel):
    title: str
    day_of_week: str  # "monday" etc.
    time: str  # "08:00"
    driver_name: str
    pickup_kids: list = []  # [str] kid names
    notes: Optional[str] = None


class AllowanceIn(BaseModel):
    member_id: str
    amount: float
    frequency: str = "weekly"  # weekly, biweekly, monthly


class AllowanceTxnIn(BaseModel):
    member_id: str
    amount: float
    description: str
    txn_type: str = "deposit"  # deposit, withdrawal


class AnnouncementIn(BaseModel):
    text: str
    priority: str = "normal"  # normal, urgent


class ChoreIn(BaseModel):
    title: str
    frequency: str = "daily"  # daily, weekly
    assigned_members: list = []  # [member_id, ...]
    rotate: bool = True



# -----------------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "Household COO Backend is live",
        "api_configured": bool(GOOGLE_API_KEY),
        "db_configured": bool(MONGO_URL),
        "backend_version": "pricing_gating_v1",
        "invite_routes": True,
        "calendar_sync": True,
        "notifications": True,
        "pricing_gating": True,
        "email_configured": bool(RESEND_API_KEY and INVITE_FROM_EMAIL),
        "admin_access_enabled": bool(ADMIN_EMAILS),
        "voice_configured": bool(GOOGLE_API_KEY and genai),
        "google_web_configured": bool(GOOGLE_WEB_CLIENT_ID),
        "google_android_configured": bool(GOOGLE_ANDROID_CLIENT_ID),
        "google_client_ids_count": len(GOOGLE_CLIENT_IDS),
    }

# -----------------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------------
@app.post("/api/auth/session")
async def exchange_session(payload: SessionIn):
    database = get_db()

    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(status_code=500, detail="Google OAuth client IDs are missing")

    token_info = None
    last_error = None
    for client_id in GOOGLE_CLIENT_IDS:
        try:
            token_info = await asyncio.wait_for(
                asyncio.to_thread(
                    google_id_token.verify_oauth2_token,
                    payload.session_id,
                    GoogleRequest(),
                    client_id,
                ),
                timeout=10,
            )
            break
        except Exception as e:
            last_error = e

    if not token_info:
        if isinstance(last_error, asyncio.TimeoutError):
            raise HTTPException(status_code=504, detail="Timed out reaching Google to verify sign-in")
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {last_error}")

    google_sub = token_info["sub"]
    email = token_info.get("email", "")
    name = token_info.get("name", email.split("@")[0] if email else "Parent")
    picture = token_info.get("picture")

    invite = None
    target_family_id = None

    if payload.invite_token:
        invite = await database["family_invites"].find_one(
            {"token": payload.invite_token},
            {"_id": 0},
        )
        if not invite:
            raise HTTPException(status_code=404, detail="Invite not found")

        if invite.get("expires_at") and invite["expires_at"] < utcnow():
            await database["family_invites"].update_one(
                {"invite_id": invite["invite_id"]},
                {"$set": {"status": "expired", "updated_at": utcnow()}},
            )
            raise HTTPException(status_code=410, detail="Invite has expired")

        if invite.get("status") == "accepted" and invite.get("accepted_by_email") != email:
            raise HTTPException(status_code=409, detail="Invite has already been accepted")

        target_family_id = invite["family_id"]

    user = await database["users"].find_one({"google_sub": google_sub}, {"_id": 0})

    if not user:
        family_id = target_family_id or new_id("family")
        user = {
            "user_id": new_id("user"),
            "google_sub": google_sub,
            "email": email,
            "name": name,
            "picture": picture,
            "family_id": family_id,
            "language": "en",
            "onboarding_completed": False,
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await database["users"].insert_one(user)

        if not target_family_id:
            await database["families"].insert_one(
                {
                    "family_id": family_id,
                    "plan": "village",
                    "billing_cycle": "monthly",
                    "grandfathered": False,
                    "updated_at": utcnow(),
                    "ai_scans_used": 0,
                    "ai_scans_period_start": utcnow(),
                    "vault_bytes_used": 0,
                }
            )

            await database["family_members"].insert_one({
                "member_id": new_id("member"),
                "family_id": family_id,
                "user_id": user["user_id"],
                "email": email,
                "name": name,
                "role": "Parent",
                "avatar": picture,
                "stars": 0,
                "pin_hash": None,
                "created_at": utcnow(),
            })
        else:
            await add_user_to_family_if_needed(database, user, target_family_id)
    else:
        updates = {
            "email": email,
            "name": name,
            "picture": picture,
            "updated_at": utcnow(),
        }
        if target_family_id:
            updates["family_id"] = target_family_id

        await database["users"].update_one(
            {"user_id": user["user_id"]},
            {"$set": updates},
        )
        user = await database["users"].find_one({"user_id": user["user_id"]}, {"_id": 0})

        if target_family_id:
            await add_user_to_family_if_needed(database, user, target_family_id)

    if invite:
        await database["family_invites"].update_one(
            {"invite_id": invite["invite_id"]},
            {
                "$set": {
                    "status": "accepted",
                    "accepted_at": utcnow(),
                    "accepted_by_user_id": user["user_id"],
                    "accepted_by_email": email,
                    "updated_at": utcnow(),
                }
            },
        )

    raw_session = secrets.token_urlsafe(32)
    await database["user_sessions"].insert_one(
        {
            "session_id": new_id("sess"),
            "user_id": user["user_id"],
            "token_hash": sha256(raw_session),
            "expires_at": utcnow() + timedelta(days=SESSION_DAYS),
            "created_at": utcnow(),
        }
    )

    return {"user": public_user(user), "session_token": raw_session}


async def _issue_session(database, user_id: str) -> str:
    raw_session = secrets.token_urlsafe(32)
    await database["user_sessions"].insert_one({
        "session_id": new_id("sess"),
        "user_id": user_id,
        "token_hash": sha256(raw_session),
        "expires_at": utcnow() + timedelta(days=SESSION_DAYS),
        "created_at": utcnow(),
    })
    return raw_session


async def _seed_new_family(database, user: dict, family_id: str, email: str, name: str, picture=None):
    await database["families"].insert_one({
        "family_id": family_id,
        "plan": "village",
        "billing_cycle": "monthly",
        "grandfathered": False,
        "updated_at": utcnow(),
        "ai_scans_used": 0,
        "ai_scans_period_start": utcnow(),
        "vault_bytes_used": 0,
    })
    await database["family_members"].insert_one({
        "member_id": new_id("member"),
        "family_id": family_id,
        "user_id": user["user_id"],
        "email": email,
        "name": name,
        "role": "Parent",
        "avatar": picture,
        "stars": 0,
        "pin_hash": None,
        "created_at": utcnow(),
    })


async def _resolve_invite(database, invite_token: Optional[str], email: str):
    """Validate an invite token and return (invite_doc, target_family_id)."""
    if not invite_token:
        return None, None
    invite = await database["family_invites"].find_one({"token": invite_token}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.get("expires_at") and invite["expires_at"] < utcnow():
        await database["family_invites"].update_one(
            {"invite_id": invite["invite_id"]},
            {"$set": {"status": "expired", "updated_at": utcnow()}},
        )
        raise HTTPException(status_code=410, detail="Invite has expired")
    if invite.get("status") == "accepted" and invite.get("accepted_by_email") != email:
        raise HTTPException(status_code=409, detail="Invite has already been accepted")
    return invite, invite["family_id"]


@app.post("/api/auth/register")
async def register_email(payload: EmailRegisterIn):
    database = get_db()

    email = payload.email.strip().lower()
    name = payload.name.strip() or (email.split("@")[0] if email else "Parent")
    password = payload.password or ""

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    existing = await database["users"].find_one({"email": email}, {"_id": 0})
    if existing:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists. Try signing in instead.",
        )

    invite, target_family_id = await _resolve_invite(database, payload.invite_token, email)

    family_id = target_family_id or new_id("family")
    user = {
        "user_id": new_id("user"),
        "email": email,
        "name": name,
        "picture": None,
        "password_hash": hash_password(password),
        "family_id": family_id,
        "language": "en",
        "onboarding_completed": False,
        "created_at": utcnow(),
        "updated_at": utcnow(),
    }
    await database["users"].insert_one(user)

    if not target_family_id:
        await _seed_new_family(database, user, family_id, email, name)
    else:
        await add_user_to_family_if_needed(database, user, target_family_id)

    if invite:
        await database["family_invites"].update_one(
            {"invite_id": invite["invite_id"]},
            {"$set": {
                "status": "accepted",
                "accepted_at": utcnow(),
                "accepted_by_user_id": user["user_id"],
                "accepted_by_email": email,
                "updated_at": utcnow(),
            }},
        )

    raw_session = await _issue_session(database, user["user_id"])
    return {"user": public_user(user), "session_token": raw_session}


@app.post("/api/auth/login")
async def login_email(payload: EmailLoginIn):
    database = get_db()

    email = payload.email.strip().lower()
    user = await database["users"].find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(
            status_code=401,
            detail="No password account found for this email. Try Google sign-in.",
        )
    if not verify_password(payload.password or "", user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    raw_session = await _issue_session(database, user["user_id"])
    return {"user": public_user(user), "session_token": raw_session}


@app.get("/api/auth/me")
async def me(user=Depends(require_user)):
    return public_user(user)


@app.post("/api/auth/logout")
async def logout(user=Depends(require_user), authorization: str = Header(default="")):
    database = get_db()
    token = authorization.replace("Bearer ", "", 1).strip()
    await database["user_sessions"].delete_many(
        {"user_id": user["user_id"], "token_hash": sha256(token)}
    )
    return {"ok": True}


@app.post("/api/auth/complete-onboarding")
async def complete_onboarding(user=Depends(require_user)):
    database = get_db()
    await database["users"].update_one(
        {"user_id": user["user_id"]},
        {"$set": {"onboarding_completed": True, "updated_at": utcnow()}},
    )
    user = await database["users"].find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(user)


@app.patch("/api/auth/language")
async def set_language(payload: LanguageIn, user=Depends(require_user)):
    database = get_db()
    await database["users"].update_one(
        {"user_id": user["user_id"]},
        {"$set": {"language": payload.language, "updated_at": utcnow()}},
    )
    user = await database["users"].find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(user)


# -----------------------------------------------------------------------------
# Family
# -----------------------------------------------------------------------------
@app.get("/api/family/members")
async def family_members(user=Depends(require_user)):
    database = get_db()
    rows = []
    cursor = database["family_members"].find({"family_id": user["family_id"]}, {"_id": 0})
    async for item in cursor:
        rows.append(public_member(item))
    return rows


@app.post("/api/family/members")
async def create_family_member(payload: ChildIn, user=Depends(require_user)):
    database = get_db()
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Child name is required")

    starting_stars = max(0, int(payload.starting_stars or 0))
    pin = (payload.pin or "").strip()
    if pin and (not pin.isdigit() or len(pin) != 4):
        raise HTTPException(status_code=400, detail="PIN must be 4 digits")

    subscription = await build_subscription(user["family_id"])
    if not is_admin_user(user):
        members_count = await database["family_members"].count_documents({"family_id": user["family_id"]})
        if members_count >= subscription["limits"]["max_members"]:
            plan_limit_error(
                feature="family_members",
                current_plan=subscription["plan"],
                message="Your current plan has reached its member limit.",
                limit=subscription["limits"]["max_members"],
                used=members_count,
            )

    member = {
        "member_id": new_id("member"),
        "family_id": user["family_id"],
        "name": name,
        "role": "Child",
        "avatar": None,
        "stars": starting_stars,
        "pin_hash": sha256(pin) if pin else None,
        "created_at": utcnow(),
    }
    await database["family_members"].insert_one(member)

    if starting_stars:
        transaction = {
            "transaction_id": new_id("star"),
            "family_id": user["family_id"],
            "member_id": member["member_id"],
            "delta": starting_stars,
            "reason": "Starting stars",
            "created_by_user_id": user["user_id"],
            "created_by_name": user.get("name"),
            "created_at": utcnow(),
        }
        await database["star_transactions"].insert_one(transaction)

    return public_member(member)


@app.delete("/api/family/members/{member_id}")
async def delete_family_member(member_id: str, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.get("user_id"):
        raise HTTPException(
            status_code=400,
            detail="This member is a signed-in account and cannot be removed here. Use account deletion instead.",
        )

    await database["family_members"].delete_one({"member_id": member_id})
    await database["star_transactions"].delete_many(
        {"member_id": member_id, "family_id": user["family_id"]}
    )
    return {"ok": True}


@app.post("/api/family/members/{member_id}/stars")
async def adjust_member_stars(member_id: str, payload: StarAdjustmentIn, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Family member not found")

    delta = int(payload.delta or 0)
    if delta == 0:
        raise HTTPException(status_code=400, detail="Star adjustment cannot be zero")

    current_stars = int(member.get("stars", 0))
    new_total = current_stars + delta
    if new_total < 0:
        raise HTTPException(status_code=400, detail="Stars cannot go below zero")

    reason = (payload.reason or "").strip()
    if delta < 0 and not reason:
        raise HTTPException(status_code=400, detail="Reason is required when removing stars")

    transaction = {
        "transaction_id": new_id("star"),
        "family_id": user["family_id"],
        "member_id": member_id,
        "delta": delta,
        "reason": reason or ("Parent added stars" if delta > 0 else "Parent removed stars"),
        "created_by_user_id": user["user_id"],
        "created_by_name": user.get("name"),
        "created_at": utcnow(),
    }

    await database["family_members"].update_one(
        {"member_id": member_id},
        {"$set": {"stars": new_total}},
    )
    await database["star_transactions"].insert_one(transaction)
    updated = await database["family_members"].find_one({"member_id": member_id}, {"_id": 0})

    if delta > 0:
        await send_star_milestone_alert(user["family_id"], member.get("name", "Your child"), current_stars, new_total)

    return {
        "ok": True,
        "member": public_member(updated),
        "transaction": public_star_transaction(transaction),
    }


@app.get("/api/family/members/{member_id}/star-history")
async def member_star_history(member_id: str, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Family member not found")

    cursor = database["star_transactions"].find(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(50)

    return [public_star_transaction(item) async for item in cursor]



@app.put("/api/family/members/{member_id}/pin")
async def set_member_pin(member_id: str, payload: PinIn, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    pin = payload.pin.strip()
    if pin and (len(pin) != 4 or not pin.isdigit()):
        raise HTTPException(status_code=400, detail="PIN must be exactly 4 digits")

    pin_hash = sha256(pin) if pin else None
    await database["family_members"].update_one(
        {"member_id": member_id},
        {"$set": {"pin_hash": pin_hash}},
    )
    return {"ok": True, "has_pin": bool(pin_hash)}




@app.delete("/api/family/members/{member_id}/pin")
async def remove_member_pin(member_id: str, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Family member not found")

    await database["family_members"].update_one(
        {"member_id": member_id},
        {"$set": {"pin_hash": None}},
    )
    return {"ok": True, "has_pin": False}

@app.post("/api/family/members/{member_id}/verify-pin")
async def verify_member_pin(member_id: str, payload: PinIn, user=Depends(require_user)):
    database = get_db()
    member = await database["family_members"].find_one(
        {"member_id": member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")

    if not member.get("pin_hash"):
        return {"ok": True, "has_pin": False}

    if sha256(payload.pin.strip()) != member["pin_hash"]:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    return {"ok": True, "has_pin": True}


async def _enforce_member_slot_limit(database, user) -> None:
    """Raise a plan-limit error when the household (members + pending
    invites) has no free slot. Admins bypass the check."""
    sub = await build_subscription(user["family_id"])
    limit = sub["limits"]["max_members"]
    used = sub["members_count"]
    pending_invites_count = await database["family_invites"].count_documents(
        {
            "family_id": user["family_id"],
            "status": "pending",
            "expires_at": {"$gt": utcnow()},
        }
    )
    used_with_pending = used + pending_invites_count
    if not is_admin_user(user) and used_with_pending >= limit:
        plan_limit_error(
            feature="family_members",
            current_plan=sub["plan"],
            limit=limit,
            used=used_with_pending,
            message=f"Your current plan allows {limit} family member slots including pending invites. Upgrade to add more.",
        )


def _new_invite_doc(user, email=None) -> dict:
    now = utcnow()
    return {
        "invite_id": new_id("invite"),
        "family_id": user["family_id"],
        "email": email,
        "token": secrets.token_urlsafe(24),
        "status": "pending",
        "created_by_user_id": user["user_id"],
        "created_by_name": user.get("name"),
        "created_by_email": user.get("email"),
        "created_at": now,
        "updated_at": now,
        "expires_at": now + timedelta(days=INVITE_DAYS),
        "accepted_at": None,
        "accepted_by_user_id": None,
        "accepted_by_email": None,
    }


@app.post("/api/family/invite/link")
async def family_invite_link(user=Depends(require_user)):
    """Create a shareable invite link with no email attached — used by the
    Phone (SMS) and Share-link options, which deliver the link from the
    inviter's own device."""
    database = get_db()
    await _enforce_member_slot_limit(database, user)
    invite = _new_invite_doc(user, email=None)
    await database["family_invites"].insert_one(invite)
    public = public_invite(invite)
    return {"ok": True, "invite": public, "invite_url": public["invite_url"]}


@app.post("/api/family/invite")
async def family_invite(payload: InviteIn, user=Depends(require_user)):
    database = get_db()
    await _enforce_member_slot_limit(database, user)

    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required")

    existing = await database["family_invites"].find_one(
        {
            "family_id": user["family_id"],
            "email": email,
            "status": "pending",
            "expires_at": {"$gt": utcnow()},
        },
        {"_id": 0},
    )

    if existing:
        invite = existing
    else:
        invite = _new_invite_doc(user, email=email)
        await database["family_invites"].insert_one(invite)

    public = public_invite(invite)
    email_result = await send_invite_email(
        email,
        public["invite_url"],
        user.get("name") or user.get("email") or "A family member",
        user.get("email") or "",
    )

    if email_result.get("sent"):
        message = f"Invitation email sent to {email}."
    else:
        message = "Invitation link created, but email delivery failed. Share the link manually."

    return {
        "ok": True,
        "sent": bool(email_result.get("sent")),
        "status": public["status"],
        "message": message,
        "invite": public,
        "invite_url": public["invite_url"],
        "email_provider": email_result.get("provider"),
        "email_error": email_result.get("error"),
    }


@app.get("/api/family/invites")
async def family_invites(user=Depends(require_user)):
    database = get_db()
    rows = []
    cursor = database["family_invites"].find(
        {"family_id": user["family_id"]},
        {"_id": 0},
    ).sort("created_at", -1)

    async for item in cursor:
        expires_at = ensure_aware_utc(item.get("expires_at"))
        if item.get("status") == "pending" and expires_at and expires_at < utcnow():
            item["expires_at"] = expires_at
            item["status"] = "expired"
            await database["family_invites"].update_one(
                {"invite_id": item["invite_id"]},
                {"$set": {"status": "expired", "updated_at": utcnow()}},
            )
        rows.append(public_invite(item))

    return rows


@app.get("/api/family/invite/{token}")
async def family_invite_lookup(token: str):
    database = get_db()
    invite = await database["family_invites"].find_one({"token": token}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")

    if invite.get("expires_at") and invite["expires_at"] < utcnow():
        raise HTTPException(status_code=410, detail="Invite has expired")

    inviter = await database["users"].find_one(
        {"user_id": invite.get("created_by_user_id")},
        {"_id": 0},
    )

    return {
        "invite_id": invite["invite_id"],
        "status": invite.get("status", "pending"),
        "email": invite.get("email"),
        "inviter_name": (inviter or {}).get("name") or invite.get("created_by_name") or "A family member",
        "expires_at": iso(invite.get("expires_at")),
    }


# -----------------------------------------------------------------------------
# Notifications
# -----------------------------------------------------------------------------
@app.get("/api/notifications/settings")
async def get_notification_settings(user=Depends(require_user)):
    settings = await get_notification_settings_doc(user["user_id"])
    return public_notification_settings(settings)


@app.put("/api/notifications/settings")
async def update_notification_settings(payload: NotificationPrefsIn, user=Depends(require_user)):
    database = get_db()
    current = await get_notification_settings_doc(user["user_id"])

    changes = {"updated_at": utcnow()}
    if payload.card_reminders is not None:
        changes["card_reminders"] = bool(payload.card_reminders)
    if payload.new_card_alerts is not None:
        changes["new_card_alerts"] = bool(payload.new_card_alerts)

    await database["notification_settings"].update_one(
        {"user_id": user["user_id"]},
        {"$set": changes},
        upsert=True,
    )

    current.update(changes)
    return public_notification_settings(current)


@app.post("/api/notifications/register")
async def register_notification_token(payload: NotificationTokenIn, user=Depends(require_user)):
    database = get_db()

    token = payload.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Notification token is required")

    doc = {
        "token": token,
        "user_id": user["user_id"],
        "family_id": user["family_id"],
        "email": user.get("email"),
        "platform": payload.platform,
        "active": True,
        "updated_at": utcnow(),
    }

    await database["notification_tokens"].update_one(
        {"token": token},
        {
            "$set": doc,
            "$setOnInsert": {"created_at": utcnow()},
        },
        upsert=True,
    )

    return {"ok": True}


@app.post("/api/notifications/test")
async def test_notification(user=Depends(require_user)):
    database = get_db()
    messages = []
    cursor = database["notification_tokens"].find(
        {"user_id": user["user_id"], "active": True},
        {"_id": 0},
    )

    async for token_doc in cursor:
        token = token_doc.get("token")
        if token and token.startswith("ExponentPushToken"):
            messages.append(
                {
                    "to": token,
                    "sound": "default",
                    "title": "Household COO notifications are active",
                    "body": "You will receive card alerts and reminder notifications.",
                    "data": {"type": "notification_test"},
                }
            )

    result = await send_expo_push_messages(messages)
    return {"ok": True, "tokens": len(messages), "result": result}



# -----------------------------------------------------------------------------
# AI assign
# -----------------------------------------------------------------------------
@app.post("/api/ai/assign")
async def ai_assign(payload: AiAssignIn, user=Depends(require_user)):
    database = get_db()
    members = []
    async for m in database["family_members"].find({"family_id": user["family_id"]}, {"_id": 0}):
        members.append(m)

    if not members:
        return {"assignee": ""}

    names = [m["name"] for m in members]

    if not GOOGLE_API_KEY:
        parent = next((m for m in members if m["role"].lower() == "parent"), members[0])
        return {"assignee": parent["name"]}

    prompt = f"""
Choose the best assignee from this list only: {", ".join(names)}.
Task title: {payload.title}
Task description: {payload.description}
Return only one exact name from the list, or return an empty string.
""".strip()

    result = await _gemini_text(
        prompt,
        system="You are assigning family tasks. Return only one exact name or empty string.",
    )
    result = result.strip().replace('"', "")
    if result not in names:
        result = ""
    return {"assignee": result}


# -----------------------------------------------------------------------------
# Cards
# -----------------------------------------------------------------------------
@app.get("/api/cards")
async def list_cards(status: Optional[str] = Query(default=None), user=Depends(require_user)):
    database = get_db()
    query = {"family_id": user["family_id"]}
    if status:
        query["status"] = status

    rows = []
    cursor = database["cards"].find(query, {"_id": 0}).sort("created_at", -1)
    async for item in cursor:
        rows.append(public_card(item))
    return rows


@app.post("/api/cards")
async def create_card(payload: CardIn, user=Depends(require_user)):
    database = get_db()
    doc = {
        "card_id": new_id("card"),
        "family_id": user["family_id"],
        "type": payload.type,
        "title": payload.title,
        "description": payload.description,
        "assignee": payload.assignee,
        "due_date": parse_dt(payload.due_date),
        "status": "OPEN",
        "source": payload.source,
        "image_base64": payload.image_base64,
        "recurrence": payload.recurrence,
        "reminder_minutes": payload.reminder_minutes,
        "created_at": utcnow(),
        "completed_at": None,
    }
    await database["cards"].insert_one(doc)

    try:
        await send_new_card_alert(user["family_id"], doc, created_by_user_id=user["user_id"])
    except Exception as e:
        log.warning("new card alert failed: %s", e)

    return public_card(doc)


@app.patch("/api/cards/{card_id}")
async def update_card(card_id: str, payload: CardPatchIn, user=Depends(require_user)):
    database = get_db()
    card = await database["cards"].find_one(
        {"card_id": card_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    changes = {}
    award_child = False

    if payload.status is not None:
        if payload.status not in {"OPEN", "DONE"}:
            raise HTTPException(status_code=400, detail="Invalid card status")
        changes["status"] = payload.status
        changes["completed_at"] = utcnow() if payload.status == "DONE" else None
        award_child = (
            card["status"] != "DONE"
            and payload.status == "DONE"
            and card["type"] == "TASK"
            and bool(card.get("assignee"))
            and not card.get("stars_awarded")
        )
        if award_child:
            changes["stars_awarded"] = True

    if payload.type is not None:
        if payload.type not in {"SIGN_SLIP", "RSVP", "TASK"}:
            raise HTTPException(status_code=400, detail="Invalid card type")
        changes["type"] = payload.type

    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title is required")
        changes["title"] = title

    if payload.description is not None:
        changes["description"] = payload.description.strip() or None

    if payload.assignee is not None:
        changes["assignee"] = payload.assignee.strip() or None

    if payload.due_date is not None:
        changes["due_date"] = parse_dt(payload.due_date) if payload.due_date else None

    if payload.recurrence is not None:
        if payload.recurrence not in {"none", "daily", "weekly", "monthly"}:
            raise HTTPException(status_code=400, detail="Invalid recurrence")
        changes["recurrence"] = payload.recurrence

    if payload.reminder_minutes is not None:
        if payload.reminder_minutes < 0:
            raise HTTPException(status_code=400, detail="Reminder must be zero or positive")
        changes["reminder_minutes"] = payload.reminder_minutes

    if not changes:
        return public_card(card)

    await database["cards"].update_one({"card_id": card_id}, {"$set": changes})
    updated = await database["cards"].find_one({"card_id": card_id}, {"_id": 0})

    # When a recurring card is completed, spawn its next occurrence.
    if (
        changes.get("status") == "DONE"
        and card["status"] != "DONE"
        and card.get("recurrence") in {"daily", "weekly", "monthly"}
    ):
        base_due = ensure_aware_utc(card.get("due_date")) or utcnow()
        next_doc = {
            "card_id": new_id("card"),
            "family_id": user["family_id"],
            "type": card["type"],
            "title": card["title"],
            "description": card.get("description"),
            "assignee": card.get("assignee"),
            "due_date": advance_due_date(base_due, card["recurrence"]),
            "status": "OPEN",
            "source": card.get("source", "MANUAL"),
            "image_base64": card.get("image_base64"),
            "recurrence": card["recurrence"],
            "reminder_minutes": card.get("reminder_minutes", 0),
            "created_at": utcnow(),
            "completed_at": None,
        }
        await database["cards"].insert_one(next_doc)

    if award_child:
        member = await database["family_members"].find_one(
            {
                "family_id": user["family_id"],
                "name": card["assignee"],
                "role": {"$regex": "^child$", "$options": "i"},
            },
            {"_id": 0},
        )
        if member:
            await database["family_members"].update_one(
                {"member_id": member["member_id"]},
                {"$inc": {"stars": 5}},
            )
            old_stars = int(member.get("stars", 0))
            await send_star_milestone_alert(user["family_id"], member.get("name", "Your child"), old_stars, old_stars + 5)

    return public_card(updated)


@app.delete("/api/cards/{card_id}")
async def delete_card(card_id: str, user=Depends(require_user)):
    database = get_db()
    await database["cards"].delete_one({"card_id": card_id, "family_id": user["family_id"]})
    return {"ok": True}


@app.get("/api/cards/conflicts")
async def card_conflicts(
    due_date: str,
    exclude_id: Optional[str] = None,
    user=Depends(require_user),
):
    database = get_db()
    target = parse_dt(due_date)
    if not target:
        return []

    start = target - timedelta(hours=2)
    end = target + timedelta(hours=2)

    query = {
        "family_id": user["family_id"],
        "due_date": {"$gte": start, "$lte": end},
    }
    if exclude_id:
        query["card_id"] = {"$ne": exclude_id}

    rows = []
    async for item in database["cards"].find(query, {"_id": 0}):
        rows.append(public_card(item))
    return rows


# -----------------------------------------------------------------------------
# Vault
# -----------------------------------------------------------------------------
@app.get("/api/vault")
async def list_vault(user=Depends(require_user)):
    database = get_db()
    rows = []
    async for item in database["vault"].find({"family_id": user["family_id"]}, {"_id": 0}).sort("created_at", -1):
        rows.append(public_vault_doc(item))
    return rows


@app.post("/api/vault")
async def create_vault_doc(payload: VaultIn, user=Depends(require_user)):
    database = get_db()
    sub = await build_subscription(user["family_id"])
    family = await get_family_doc(user["family_id"])
    size = len(payload.image_base64.encode("utf-8"))

    if not is_admin_user(user) and family.get("vault_bytes_used", 0) + size > sub["limits"]["vault_bytes"]:
        plan_limit_error(
            feature="vault_storage",
            current_plan=sub["plan"],
            limit=sub["limits"]["vault_bytes"],
            used=family.get("vault_bytes_used", 0),
            message="Vault storage limit reached for your current plan.",
        )

    doc = {
        "doc_id": new_id("doc"),
        "family_id": user["family_id"],
        "title": payload.title,
        "category": payload.category,
        "image_base64": payload.image_base64,
        "mime_type": payload.mime_type or "image/jpeg",
        "file_name": payload.file_name,
        "created_at": utcnow(),
    }
    await database["vault"].insert_one(doc)
    await database["families"].update_one(
        {"family_id": user["family_id"]},
        {"$inc": {"vault_bytes_used": size}, "$set": {"updated_at": utcnow()}},
    )
    return public_vault_doc(doc)


@app.delete("/api/vault/{doc_id}")
async def delete_vault_doc(doc_id: str, user=Depends(require_user)):
    database = get_db()
    doc = await database["vault"].find_one(
        {"doc_id": doc_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if doc:
        size = len(doc["image_base64"].encode("utf-8"))
        await database["vault"].delete_one({"doc_id": doc_id})
        await database["families"].update_one(
            {"family_id": user["family_id"]},
            {"$inc": {"vault_bytes_used": -size}, "$set": {"updated_at": utcnow()}},
        )
    return {"ok": True}


# -----------------------------------------------------------------------------
# Rewards
# -----------------------------------------------------------------------------
@app.get("/api/rewards")
async def list_rewards(user=Depends(require_user)):
    database = get_db()
    rows = []
    async for item in database["rewards"].find({"family_id": user["family_id"]}, {"_id": 0}).sort("created_at", -1):
        rows.append(public_reward(item))
    return rows


@app.post("/api/rewards")
async def create_reward(payload: RewardIn, user=Depends(require_user)):
    database = get_db()
    reward = {
        "reward_id": new_id("reward"),
        "family_id": user["family_id"],
        "title": payload.title,
        "cost_stars": payload.cost_stars,
        "icon": payload.icon,
        "created_at": utcnow(),
    }
    await database["rewards"].insert_one(reward)
    return public_reward(reward)


@app.patch("/api/rewards/{reward_id}")
async def update_reward(reward_id: str, payload: RewardPatchIn, user=Depends(require_user)):
    database = get_db()
    reward = await database["rewards"].find_one(
        {"reward_id": reward_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found")

    changes = {}

    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="Reward title is required")
        changes["title"] = title

    if payload.cost_stars is not None:
        if payload.cost_stars < 1:
            raise HTTPException(status_code=400, detail="Reward cost must be at least 1 star")
        changes["cost_stars"] = payload.cost_stars

    if payload.icon is not None:
        changes["icon"] = payload.icon.strip() or None

    if not changes:
        return public_reward(reward)

    await database["rewards"].update_one(
        {"reward_id": reward_id},
        {"$set": changes},
    )
    updated = await database["rewards"].find_one({"reward_id": reward_id}, {"_id": 0})
    return public_reward(updated)



@app.delete("/api/rewards/{reward_id}")
async def delete_reward(reward_id: str, user=Depends(require_user)):
    database = get_db()
    await database["rewards"].delete_one({"reward_id": reward_id, "family_id": user["family_id"]})
    return {"ok": True}


@app.post("/api/rewards/{reward_id}/redeem")
async def redeem_reward(reward_id: str, payload: RedeemIn, user=Depends(require_user)):
    database = get_db()
    reward = await database["rewards"].find_one(
        {"reward_id": reward_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    member = await database["family_members"].find_one(
        {"member_id": payload.member_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not reward or not member:
        raise HTTPException(status_code=404, detail="Reward or member not found")

    if member.get("stars", 0) < reward["cost_stars"]:
        raise HTTPException(status_code=400, detail="Not enough stars")

    await database["family_members"].update_one(
        {"member_id": member["member_id"]},
        {"$inc": {"stars": -reward["cost_stars"]}},
    )
    member = await database["family_members"].find_one({"member_id": member["member_id"]}, {"_id": 0})
    return {"ok": True, "member": public_member(member)}



# -----------------------------------------------------------------------------
# Google Calendar sync
# -----------------------------------------------------------------------------
def _parse_google_event_start(event: dict) -> Optional[datetime]:
    start = event.get("start") or {}
    raw = start.get("dateTime")

    if raw:
        return parse_dt(raw)

    raw_date = start.get("date")
    if raw_date:
        try:
            return datetime.fromisoformat(raw_date).replace(
                hour=9,
                minute=0,
                second=0,
                microsecond=0,
                tzinfo=timezone.utc,
            )
        except Exception:
            return None

    return None


def _event_attendee_contacts(event: dict) -> list[dict]:
    contacts = []
    seen = set()

    for key in ("organizer", "creator"):
        person = event.get(key) or {}
        email = str(person.get("email") or "").strip().lower()
        if email and email not in seen:
            seen.add(email)
            contacts.append({
                "email": email,
                "name": person.get("displayName") or email.split("@")[0],
            })

    for attendee in event.get("attendees") or []:
        email = str(attendee.get("email") or "").strip().lower()
        if email and email not in seen:
            seen.add(email)
            contacts.append({
                "email": email,
                "name": attendee.get("displayName") or email.split("@")[0],
            })

    return contacts


async def _fetch_google_calendar_events(access_token: str, days: int) -> list[dict]:
    now = utcnow()
    time_min = now.isoformat().replace("+00:00", "Z")
    time_max = (now + timedelta(days=days)).isoformat().replace("+00:00", "Z")

    params = urllib.parse.urlencode(
        {
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "100",
        }
    )

    url = f"https://www.googleapis.com/calendar/v3/calendars/primary/events?{params}"

    def _request():
        req = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            method="GET",
        )

        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            # Never let Google's own 401/403 propagate as OUR 401 — the app
            # treats a 401 as an expired session and signs the user out. Remap
            # an upstream auth failure to a clear, non-session error.
            if e.code in (401, 403):
                raise HTTPException(
                    status_code=400,
                    detail="Google Calendar access was denied or expired. Please reconnect your Google account and try again.",
                )
            raise HTTPException(status_code=502, detail=f"Google Calendar error: {body[:200]}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Google Calendar request failed: {e}")

    data = await asyncio.to_thread(_request)
    return data.get("items") or []


@app.post("/api/calendar/import")
async def import_google_calendar(payload: CalendarImportIn, user=Depends(require_user)):
    database = get_db()

    token = payload.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Google Calendar access token is required")

    days = max(1, min(payload.days or 30, 90))
    events = await _fetch_google_calendar_events(token, days)

    imported = 0
    skipped = 0
    contacts_found: dict[str, dict] = {}

    for event in events:
        if event.get("status") == "cancelled":
            skipped += 1
            continue

        event_id = event.get("id")
        if not event_id:
            skipped += 1
            continue

        start_dt = _parse_google_event_start(event)
        if not start_dt:
            skipped += 1
            continue

        existing = await database["cards"].find_one(
            {
                "family_id": user["family_id"],
                "google_event_id": event_id,
            },
            {"_id": 0},
        )
        if existing:
            skipped += 1
            continue

        title = (event.get("summary") or "Calendar event").strip()
        location = (event.get("location") or "").strip()
        html_link = event.get("htmlLink")
        contacts = _event_attendee_contacts(event)

        for contact in contacts:
            email = contact["email"]
            contacts_found[email] = contact
            await database["calendar_contacts"].update_one(
                {"family_id": user["family_id"], "email": email},
                {
                    "$set": {
                        "name": contact.get("name") or email.split("@")[0],
                        "last_seen_at": utcnow(),
                        "last_event_title": title,
                    },
                    "$setOnInsert": {
                        "family_id": user["family_id"],
                        "email": email,
                        "first_seen_at": utcnow(),
                    },
                    "$inc": {"event_count": 1},
                },
                upsert=True,
            )

        contact_line = ""
        if contacts:
            contact_line = "People: " + ", ".join([c["email"] for c in contacts[:8]])

        description_parts = [
            (event.get("description") or "").strip(),
            f"Location: {location}" if location else "",
            contact_line,
            f"Google Calendar: {html_link}" if html_link else "",
        ]

        card = {
            "card_id": new_id("card"),
            "family_id": user["family_id"],
            "type": "TASK",
            "title": title,
            "description": "\n".join([p for p in description_parts if p]),
            "assignee": user.get("name"),
            "due_date": start_dt,
            "status": "OPEN",
            "source": "CALENDAR",
            "image_base64": None,
            "recurrence": "none",
            "reminder_minutes": 60,
            "google_event_id": event_id,
            "google_ical_uid": event.get("iCalUID"),
            "external_source": "google_calendar",
            "created_at": utcnow(),
            "completed_at": None,
        }

        await database["cards"].insert_one(card)
        imported += 1

    contacts = []
    if contacts_found:
        cursor = database["calendar_contacts"].find(
            {"family_id": user["family_id"], "email": {"$in": list(contacts_found.keys())}},
            {"_id": 0},
        ).sort("last_seen_at", -1)

        async for item in cursor:
            contacts.append(public_calendar_contact(item))

    return {
        "ok": True,
        "imported": imported,
        "skipped": skipped,
        "events_seen": len(events),
        "contacts_found": len(contacts_found),
        "contacts": contacts,
        "days": days,
    }


@app.get("/api/calendar/contacts")
async def calendar_contacts(user=Depends(require_user)):
    database = get_db()
    rows = []
    cursor = database["calendar_contacts"].find(
        {"family_id": user["family_id"]},
        {"_id": 0},
    ).sort("last_seen_at", -1).limit(50)

    async for item in cursor:
        rows.append(public_calendar_contact(item))

    return rows



# -----------------------------------------------------------------------------
# Subscription
# -----------------------------------------------------------------------------
@app.get("/api/subscription")
async def get_subscription(user=Depends(require_user)):
    sub = await build_subscription(user["family_id"])
    if is_admin_user(user):
        return apply_admin_subscription(sub)
    return sub


@app.post("/api/subscription/change")
async def change_subscription(payload: SubscriptionChangeIn, user=Depends(require_user)):
    database = get_db()
    if payload.plan not in PLAN_CATALOG:
        raise HTTPException(status_code=400, detail="Invalid plan")
    if payload.billing_cycle not in ("monthly", "yearly"):
        raise HTTPException(status_code=400, detail="Invalid billing cycle")

    await database["families"].update_one(
        {"family_id": user["family_id"]},
        {
            "$set": {
                "plan": payload.plan,
                "billing_cycle": payload.billing_cycle,
                "grandfathered": False,
                "updated_at": utcnow(),
            }
        },
        upsert=True,
    )
    return await build_subscription(user["family_id"])


# -----------------------------------------------------------------------------
# Entitlements
# -----------------------------------------------------------------------------
@app.get("/api/subscription/entitlements")
async def get_entitlements(user=Depends(require_user)):
    database = get_db()
    sub = await build_subscription(user["family_id"])
    if is_admin_user(user):
        sub = apply_admin_subscription(sub)

    members_count = await database["family_members"].count_documents({"family_id": user["family_id"]})
    pending_invites = await database["family_invites"].count_documents(
        {
            "family_id": user["family_id"],
            "status": "pending",
            "expires_at": {"$gt": utcnow()},
        }
    )

    member_slots_used = members_count + pending_invites
    max_members = sub["limits"]["max_members"]

    return {
        "plan": sub["plan"],
        "admin_unlocked": bool(sub.get("admin_unlocked")),
        "members_count": members_count,
        "pending_invites": pending_invites,
        "member_slots_used": member_slots_used,
        "max_members": max_members,
        "can_invite": bool(sub.get("admin_unlocked")) or member_slots_used < max_members,
        "ai_scans_used": sub.get("ai_scans_used", 0),
        "ai_scans_limit": sub["limits"]["ai_scans_per_month"],
        "vault_bytes_used": sub.get("vault_bytes_used", 0),
        "vault_bytes_limit": sub["limits"]["vault_bytes"],
        "weekly_brief": sub["limits"].get("weekly_brief", False),
        "multi_property": sub["limits"].get("multi_property", False),
        "features": {
            "meal_planner": sub["limits"].get("meal_planner", False),
            "allowance": sub["limits"].get("allowance", False),
            "carpool": sub["limits"].get("carpool", False),
            "weekly_report": sub["limits"].get("weekly_report", False),
        },
    }



# -----------------------------------------------------------------------------
# Weekly brief
# -----------------------------------------------------------------------------
@app.post("/api/brief/weekly")
async def weekly_brief(user=Depends(require_user)):
    database = get_db()
    sub = await build_subscription(user["family_id"])
    if not is_admin_user(user) and not sub["limits"]["weekly_brief"]:
        plan_limit_error(
            feature="weekly_brief",
            current_plan=sub["plan"],
            message="Weekly Brief is available on Executive and Family Office plans.",
        )

    cards = []
    async for item in database["cards"].find({"family_id": user["family_id"], "status": "OPEN"}, {"_id": 0}):
        cards.append(item)

    if not cards:
        brief = "You have a clear runway this week. Use the space to reset routines, confirm calendars, and get ahead on one important family task."
        return {"brief": brief, "generated_at": iso(utcnow())}

    lines = []
    for c in cards[:12]:
        due = iso(c.get("due_date")) or "no due date"
        assignee = c.get("assignee") or "unassigned"
        lines.append(f"- {c['title']} | due: {due} | assignee: {assignee}")

    if not GOOGLE_API_KEY:
        brief = (
            "This week's household priorities are: "
            + "; ".join([c["title"] for c in cards[:5]])
            + ". Focus first on items with dates, assign open tasks clearly, and close one quick win today."
        )
        return {"brief": brief, "generated_at": iso(utcnow())}

    prompt = f"""
Write a warm, premium household chief-of-staff weekly brief in under 180 words.
Summarize priorities, likely bottlenecks, and one concrete action step.
Open items:
{chr(10).join(lines)}
""".strip()

    brief = await _gemini_text(prompt)
    return {"brief": brief, "generated_at": iso(utcnow())}


# -----------------------------------------------------------------------------
# Vision
# -----------------------------------------------------------------------------
@app.post("/api/vision/extract")
async def vision_extract(payload: VisionIn, user=Depends(require_user)):
    database = get_db()
    sub = await build_subscription(user["family_id"])
    family = await get_family_doc(user["family_id"])

    if not is_admin_user(user) and family.get("ai_scans_used", 0) >= sub["limits"]["ai_scans_per_month"]:
        plan_limit_error(
            feature="ai_scans",
            current_plan=sub["plan"],
            limit=sub["limits"]["ai_scans_per_month"],
            used=family.get("ai_scans_used", 0),
            message="AI scan limit reached for this billing period.",
        )

    members = []
    async for m in database["family_members"].find({"family_id": user["family_id"]}, {"_id": 0}):
        members.append(m["name"])

    fallback = {
        "type": "TASK",
        "title": "Review scanned document",
        "description": "Scanned item captured for review.",
        "assignee": members[0] if members else "",
        "due_date": None,
        "vault_category": "School",
        "save_to_vault": True,
    }

    if GOOGLE_API_KEY:
        prompt = f"""
Extract a household action card from this image.
Return JSON only with keys:
type, title, description, assignee, due_date, vault_category, save_to_vault

Rules:
- type must be one of SIGN_SLIP, RSVP, TASK
- assignee must be one of: {", ".join(members) if members else ""}
- due_date must be ISO string or null
- vault_category must be one of Medical, School, Insurance, Legal
- save_to_vault must be true for documents worth keeping
"""
        try:
            text = await _gemini_vision(prompt, payload.image_base64)
            text = text.strip().removeprefix("```json").removesuffix("```").strip()
            parsed = json.loads(text)
            fallback.update(parsed)
        except Exception:
            pass

    if not is_admin_user(user):
        await database["families"].update_one(
            {"family_id": user["family_id"]},
            {"$inc": {"ai_scans_used": 1}, "$set": {"updated_at": utcnow()}},
        )

    return fallback



def _clean_json_text(text: str) -> str:
    value = (text or "").strip()

    if value.startswith("```json"):
        value = value.removeprefix("```json").strip()
    if value.startswith("```"):
        value = value.removeprefix("```").strip()
    if value.endswith("```"):
        value = value.removesuffix("```").strip()

    first = value.find("{")
    last = value.rfind("}")
    if first >= 0 and last > first:
        return value[first : last + 1]

    return value


def _safe_voice_draft(parsed: dict, fallback_transcript: str = "") -> dict:
    transcript = str(parsed.get("transcript") or fallback_transcript or "").strip()
    title = str(parsed.get("title") or "").strip()
    description = str(parsed.get("description") or "").strip()

    if not title:
        title = transcript[:70].strip() or "Voice task"
    if not description:
        description = transcript

    card_type = str(parsed.get("type") or "TASK").strip().upper()
    if card_type not in ("SIGN_SLIP", "RSVP", "TASK"):
        card_type = "TASK"

    due_date = parsed.get("due_date")
    if due_date in ("", "null", "None"):
        due_date = None

    return {
        "transcript": transcript,
        "type": card_type,
        "title": title,
        "description": description,
        "assignee": str(parsed.get("assignee") or "").strip(),
        "due_date": due_date,
    }


async def _voice_to_draft(audio_bytes: bytes, mime_type: str, members: list[str]) -> dict:
    if not GOOGLE_API_KEY or not genai:
        raise HTTPException(
            status_code=501,
            detail="Voice transcription requires GOOGLE_API_KEY in Railway.",
        )

    allowed_members = ", ".join(members) if members else ""

    prompt = f"""
You are Household COO, a premium family chief-of-staff assistant.

Listen to the audio and return JSON only with these keys:
transcript, type, title, description, assignee, due_date

Rules:
- transcript: accurate transcription of the user's speech.
- type: one of SIGN_SLIP, RSVP, TASK.
- title: concise action title, max 70 characters.
- description: practical detail from the audio.
- assignee: one exact name from this list if clearly mentioned or obvious: {allowed_members}
- assignee may be empty string if unclear.
- due_date: ISO 8601 string if the audio clearly mentions a date/time, otherwise null.
- Return valid JSON only. No markdown.
""".strip()

    model = _gemini(
        "You convert spoken household instructions into structured task/card JSON."
    )

    def _generate_inline():
        return model.generate_content(
            [
                prompt,
                {
                    "mime_type": mime_type or "audio/aac",
                    "data": audio_bytes,
                },
            ]
        )

    try:
        response = await asyncio.to_thread(_generate_inline)
        text = (response.text or "").strip()
    except Exception as first_error:
        if not hasattr(genai, "upload_file"):
            raise HTTPException(
                status_code=500,
                detail=f"Voice transcription failed: {first_error}",
            )

        suffix = ".m4a"
        if "ogg" in (mime_type or ""):
            suffix = ".ogg"
        elif "webm" in (mime_type or ""):
            suffix = ".webm"
        elif "mpeg" in (mime_type or "") or "mp3" in (mime_type or ""):
            suffix = ".mp3"
        elif "wav" in (mime_type or ""):
            suffix = ".wav"

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            uploaded = await asyncio.to_thread(
                genai.upload_file,
                tmp_path,
                mime_type=mime_type or None,
            )
            response = await asyncio.to_thread(model.generate_content, [prompt, uploaded])
            text = (response.text or "").strip()
        except Exception as second_error:
            raise HTTPException(
                status_code=500,
                detail=f"Voice transcription failed: {second_error}",
            )
        finally:
            if tmp_path:
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    try:
        parsed = json.loads(_clean_json_text(text))
        if not isinstance(parsed, dict):
            raise ValueError("Model response was not an object")
        return _safe_voice_draft(parsed, fallback_transcript=text)
    except Exception:
        return _safe_voice_draft({"transcript": text, "description": text}, fallback_transcript=text)



# -----------------------------------------------------------------------------
# Voice placeholder
# -----------------------------------------------------------------------------
@app.post("/api/voice/transcribe")
async def voice_transcribe(audio: UploadFile = File(...), user=Depends(require_user)):
    database = get_db()

    audio_bytes = await audio.read()
    if not audio_bytes or len(audio_bytes) < 500:
        raise HTTPException(status_code=400, detail="Recording is too short")

    if len(audio_bytes) > MAX_VOICE_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too large")

    members = []
    async for member in database["family_members"].find(
        {"family_id": user["family_id"]},
        {"_id": 0, "name": 1},
    ):
        if member.get("name"):
            members.append(member["name"])

    mime_type = audio.content_type or "audio/aac"
    return await _voice_to_draft(audio_bytes, mime_type, members)


# -----------------------------------------------------------------------------
# Handoff Notes
# -----------------------------------------------------------------------------

@app.get("/api/handoff-notes")
async def list_handoff_notes(user=Depends(require_user)):
    database = get_db()
    rows = []
    async for note in database["handoff_notes"].find(
        {"family_id": user["family_id"]},
        {"_id": 0},
    ).sort("created_at", -1).limit(50):
        rows.append(public_handoff_note(note))
    return rows


@app.post("/api/handoff-notes")
async def create_handoff_note(payload: HandoffNoteIn, user=Depends(require_user)):
    database = get_db()
    member_name = None
    if payload.member_id:
        member = await database["family_members"].find_one(
            {"family_id": user["family_id"], "member_id": payload.member_id},
            {"_id": 0, "name": 1},
        )
        if member:
            member_name = member["name"]
    doc = {
        "note_id": new_id("note"),
        "family_id": user["family_id"],
        "member_id": payload.member_id,
        "member_name": member_name,
        "text": payload.text.strip(),
        "author_name": user.get("name", ""),
        "author_user_id": user["user_id"],
        "created_at": utcnow(),
    }
    await database["handoff_notes"].insert_one(doc)
    return public_handoff_note(doc)


@app.delete("/api/handoff-notes/{note_id}")
async def delete_handoff_note(note_id: str, user=Depends(require_user)):
    database = get_db()
    result = await database["handoff_notes"].delete_one(
        {"note_id": note_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Note not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Shopping List
# -----------------------------------------------------------------------------

SHOPPING_CATEGORIES = [
    "Produce", "Dairy", "Meat", "Bakery", "Frozen",
    "Pantry", "Drinks", "Snacks", "Baby", "Household",
    "Health", "School", "Other",
]


@app.get("/api/shopping")
async def list_shopping(user=Depends(require_user)):
    database = get_db()
    rows = []
    async for item in database["shopping_list"].find(
        {"family_id": user["family_id"]},
        {"_id": 0},
    ).sort("created_at", -1):
        rows.append(public_shopping_item(item))
    return rows


@app.post("/api/shopping")
async def add_shopping_item(payload: ShoppingItemIn, user=Depends(require_user)):
    database = get_db()
    doc = {
        "item_id": new_id("shop"),
        "family_id": user["family_id"],
        "name": payload.name.strip(),
        "category": payload.category if payload.category in SHOPPING_CATEGORIES else "Other",
        "checked": False,
        "added_by": user.get("name", ""),
        "created_at": utcnow(),
    }
    await database["shopping_list"].insert_one(doc)
    return public_shopping_item(doc)


@app.patch("/api/shopping/{item_id}")
async def update_shopping_item(item_id: str, payload: ShoppingItemPatchIn, user=Depends(require_user)):
    database = get_db()
    updates = {}
    if payload.checked is not None:
        updates["checked"] = payload.checked
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.category is not None:
        updates["category"] = payload.category
    if not updates:
        raise HTTPException(400, "Nothing to update")
    result = await database["shopping_list"].update_one(
        {"item_id": item_id, "family_id": user["family_id"]},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Item not found")
    doc = await database["shopping_list"].find_one({"item_id": item_id}, {"_id": 0})
    return public_shopping_item(doc)


@app.delete("/api/shopping/{item_id}")
async def delete_shopping_item(item_id: str, user=Depends(require_user)):
    database = get_db()
    result = await database["shopping_list"].delete_one(
        {"item_id": item_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Item not found")
    return {"ok": True}


@app.delete("/api/shopping")
async def clear_checked_shopping(user=Depends(require_user)):
    database = get_db()
    result = await database["shopping_list"].delete_many(
        {"family_id": user["family_id"], "checked": True}
    )
    return {"deleted": result.deleted_count}


# -----------------------------------------------------------------------------
# Expense Tracking
# -----------------------------------------------------------------------------

@app.get("/api/expenses")
async def list_expenses(
    user=Depends(require_user),
    days: int = Query(default=30, ge=1, le=365),
):
    database = get_db()
    since = utcnow() - timedelta(days=days)
    rows = []
    async for exp in database["expenses"].find(
        {"family_id": user["family_id"], "created_at": {"$gte": since}},
        {"_id": 0},
    ).sort("created_at", -1):
        rows.append(public_expense(exp))
    return rows


@app.get("/api/expenses/summary")
async def expense_summary(
    user=Depends(require_user),
    days: int = Query(default=30, ge=1, le=365),
):
    database = get_db()
    since = utcnow() - timedelta(days=days)
    by_user: dict[str, float] = {}
    by_category: dict[str, float] = {}
    total = 0.0
    async for exp in database["expenses"].find(
        {"family_id": user["family_id"], "created_at": {"$gte": since}},
        {"_id": 0},
    ):
        amt = exp.get("amount", 0)
        total += amt
        name = exp.get("paid_by_name", "Unknown")
        by_user[name] = by_user.get(name, 0) + amt
        cat = exp.get("category", "General")
        by_category[cat] = by_category.get(cat, 0) + amt
    return {
        "total": round(total, 2),
        "by_person": {k: round(v, 2) for k, v in by_user.items()},
        "by_category": {k: round(v, 2) for k, v in by_category.items()},
        "days": days,
    }


@app.post("/api/expenses")
async def add_expense(payload: ExpenseIn, user=Depends(require_user)):
    database = get_db()
    child_name = None
    if payload.child_member_id:
        member = await database["family_members"].find_one(
            {"family_id": user["family_id"], "member_id": payload.child_member_id},
            {"_id": 0, "name": 1},
        )
        if member:
            child_name = member["name"]
    doc = {
        "expense_id": new_id("exp"),
        "family_id": user["family_id"],
        "description": payload.description.strip(),
        "amount": round(payload.amount, 2),
        "category": payload.category,
        "child_member_id": payload.child_member_id,
        "child_name": child_name,
        "paid_by_name": user.get("name", ""),
        "paid_by_user_id": user["user_id"],
        "created_at": utcnow(),
    }
    await database["expenses"].insert_one(doc)
    return public_expense(doc)


@app.delete("/api/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(require_user)):
    database = get_db()
    result = await database["expenses"].delete_one(
        {"expense_id": expense_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Expense not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Recurring Templates
# -----------------------------------------------------------------------------

@app.get("/api/templates")
async def list_templates(user=Depends(require_user)):
    database = get_db()
    rows = []
    async for tmpl in database["templates"].find(
        {"family_id": user["family_id"]},
        {"_id": 0},
    ).sort("created_at", -1):
        rows.append(public_template(tmpl))
    return rows


@app.post("/api/templates")
async def create_template(payload: TemplateIn, user=Depends(require_user)):
    database = get_db()
    doc = {
        "template_id": new_id("tmpl"),
        "family_id": user["family_id"],
        "title": payload.title.strip(),
        "description": (payload.description or "").strip() or None,
        "recurrence": payload.recurrence if payload.recurrence in ("daily", "weekly", "monthly") else "daily",
        "time_of_day": payload.time_of_day,
        "assignee": payload.assignee,
        "enabled": True,
        "created_at": utcnow(),
    }
    await database["templates"].insert_one(doc)
    return public_template(doc)


@app.patch("/api/templates/{template_id}")
async def update_template(template_id: str, user=Depends(require_user)):
    database = get_db()
    tmpl = await database["templates"].find_one(
        {"template_id": template_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not tmpl:
        raise HTTPException(404, "Template not found")
    new_enabled = not tmpl.get("enabled", True)
    await database["templates"].update_one(
        {"template_id": template_id},
        {"$set": {"enabled": new_enabled}},
    )
    tmpl["enabled"] = new_enabled
    return public_template(tmpl)


@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str, user=Depends(require_user)):
    database = get_db()
    result = await database["templates"].delete_one(
        {"template_id": template_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Template not found")
    return {"ok": True}


@app.post("/api/templates/{template_id}/generate")
async def generate_from_template(template_id: str, user=Depends(require_user)):
    database = get_db()
    tmpl = await database["templates"].find_one(
        {"template_id": template_id, "family_id": user["family_id"]},
        {"_id": 0},
    )
    if not tmpl:
        raise HTTPException(404, "Template not found")
    due = utcnow()
    if tmpl.get("time_of_day"):
        try:
            parts = tmpl["time_of_day"].split(":")
            due = due.replace(hour=int(parts[0]), minute=int(parts[1]) if len(parts) > 1 else 0, second=0, microsecond=0)
        except (ValueError, IndexError):
            pass
    card = {
        "card_id": new_id("card"),
        "family_id": user["family_id"],
        "type": "TASK",
        "title": tmpl["title"],
        "description": tmpl.get("description"),
        "assignee": tmpl.get("assignee"),
        "due_date": due,
        "status": "OPEN",
        "source": "MANUAL",
        "image_base64": None,
        "recurrence": tmpl.get("recurrence", "none"),
        "reminder_minutes": 60,
        "created_at": utcnow(),
        "completed_at": None,
    }
    await database["cards"].insert_one(card)
    return public_card(card)


# -----------------------------------------------------------------------------
# Morning Routines
# -----------------------------------------------------------------------------
@app.get("/api/routines")
async def list_routines(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["routines"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [public_routine(r) for r in rows]


@app.post("/api/routines")
async def create_routine(body: RoutineIn, user: dict = Depends(require_user), database=Depends(get_db)):
    routine = {
        "routine_id": new_id("rtn"),
        "family_id": user["family_id"],
        "name": body.name,
        "steps": body.steps,
        "member_id": body.member_id,
        "created_at": utcnow(),
    }
    await database["routines"].insert_one(routine)
    return public_routine(routine)


@app.patch("/api/routines/{routine_id}")
async def update_routine(routine_id: str, body: RoutinePatchIn, user: dict = Depends(require_user), database=Depends(get_db)):
    updates = {k: v for k, v in body.dict(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No updates provided")
    await database["routines"].update_one(
        {"routine_id": routine_id, "family_id": user["family_id"]},
        {"$set": updates},
    )
    row = await database["routines"].find_one(
        {"routine_id": routine_id, "family_id": user["family_id"]}, {"_id": 0}
    )
    if not row:
        raise HTTPException(404, "Routine not found")
    return public_routine(row)


@app.delete("/api/routines/{routine_id}")
async def delete_routine(routine_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["routines"].delete_one(
        {"routine_id": routine_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Routine not found")
    return {"ok": True}


@app.post("/api/routines/{routine_id}/log")
async def log_routine_completion(routine_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    routine = await database["routines"].find_one(
        {"routine_id": routine_id, "family_id": user["family_id"]}, {"_id": 0}
    )
    if not routine:
        raise HTTPException(404, "Routine not found")
    log_entry = {
        "log_id": new_id("rlog"),
        "routine_id": routine_id,
        "family_id": user["family_id"],
        "member_id": routine.get("member_id"),
        "completed_at": utcnow(),
        "steps_count": len(routine.get("steps", [])),
    }
    await database["routine_logs"].insert_one(log_entry)
    return {"ok": True, "log_id": log_entry["log_id"]}


# -----------------------------------------------------------------------------
# Meal Planner
# -----------------------------------------------------------------------------
DAYS_OF_WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"]


@app.get("/api/meals")
async def list_meals(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["meals"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).to_list(200)
    return [public_meal(m) for m in rows]


@app.post("/api/meals")
async def create_meal(body: MealPlanIn, user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "meal_planner")
    day = body.day.lower()
    if day not in DAYS_OF_WEEK:
        raise HTTPException(400, f"Day must be one of {DAYS_OF_WEEK}")
    meal = {
        "meal_id": new_id("meal"),
        "family_id": user["family_id"],
        "day": day,
        "meal_type": body.meal_type.lower(),
        "title": body.title,
        "ingredients": body.ingredients,
        "notes": body.notes,
        "created_at": utcnow(),
    }
    await database["meals"].insert_one(meal)
    return public_meal(meal)


@app.delete("/api/meals/{meal_id}")
async def delete_meal(meal_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["meals"].delete_one(
        {"meal_id": meal_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Meal not found")
    return {"ok": True}


@app.post("/api/meals/sync-shopping")
async def sync_meals_to_shopping(user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "meal_planner")
    meals = await database["meals"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).to_list(200)
    all_ingredients = []
    for meal in meals:
        all_ingredients.extend(meal.get("ingredients", []))
    unique = list(set(i.strip() for i in all_ingredients if i.strip()))
    added = 0
    for name in unique:
        existing = await database["shopping_list"].find_one(
            {"family_id": user["family_id"], "name": {"$regex": f"^{name}$", "$options": "i"}}
        )
        if not existing:
            item = {
                "item_id": new_id("shop"),
                "family_id": user["family_id"],
                "name": name,
                "category": "Groceries",
                "checked": False,
                "added_by": user.get("name", ""),
                "created_at": utcnow(),
            }
            await database["shopping_list"].insert_one(item)
            added += 1
    return {"ok": True, "added": added, "total_ingredients": len(unique)}


# -----------------------------------------------------------------------------
# Carpool Coordinator
# -----------------------------------------------------------------------------
@app.get("/api/carpools")
async def list_carpools(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["carpools"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [public_carpool(c) for c in rows]


@app.post("/api/carpools")
async def create_carpool(body: CarpoolIn, user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "carpool")
    carpool = {
        "carpool_id": new_id("cpool"),
        "family_id": user["family_id"],
        "title": body.title,
        "day_of_week": body.day_of_week.lower(),
        "time": body.time,
        "driver_name": body.driver_name,
        "pickup_kids": body.pickup_kids,
        "notes": body.notes,
        "created_at": utcnow(),
    }
    await database["carpools"].insert_one(carpool)
    return public_carpool(carpool)


@app.delete("/api/carpools/{carpool_id}")
async def delete_carpool(carpool_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["carpools"].delete_one(
        {"carpool_id": carpool_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Carpool not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Allowance Tracker
# -----------------------------------------------------------------------------
@app.get("/api/allowances")
async def list_allowances(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["allowances"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).to_list(50)
    return [public_allowance_config(a) for a in rows]


@app.post("/api/allowances")
async def set_allowance(body: AllowanceIn, user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "allowance")
    existing = await database["allowances"].find_one(
        {"family_id": user["family_id"], "member_id": body.member_id}
    )
    if existing:
        await database["allowances"].update_one(
            {"allowance_id": existing["allowance_id"]},
            {"$set": {"amount": body.amount, "frequency": body.frequency}},
        )
        existing["amount"] = body.amount
        existing["frequency"] = body.frequency
        return public_allowance_config(existing)
    allowance = {
        "allowance_id": new_id("alw"),
        "family_id": user["family_id"],
        "member_id": body.member_id,
        "amount": body.amount,
        "frequency": body.frequency,
        "created_at": utcnow(),
    }
    await database["allowances"].insert_one(allowance)
    return public_allowance_config(allowance)


@app.delete("/api/allowances/{member_id}")
async def delete_allowance(member_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["allowances"].delete_one(
        {"family_id": user["family_id"], "member_id": member_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Allowance not found")
    return {"ok": True}


@app.get("/api/allowances/{member_id}/transactions")
async def list_allowance_transactions(member_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["allowance_txns"].find(
        {"family_id": user["family_id"], "member_id": member_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [public_allowance_txn(t) for t in rows]


@app.post("/api/allowances/transaction")
async def add_allowance_transaction(body: AllowanceTxnIn, user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "allowance")
    txn = {
        "txn_id": new_id("atxn"),
        "family_id": user["family_id"],
        "member_id": body.member_id,
        "amount": body.amount,
        "description": body.description,
        "txn_type": body.txn_type,
        "created_at": utcnow(),
    }
    await database["allowance_txns"].insert_one(txn)
    return public_allowance_txn(txn)


@app.get("/api/allowances/{member_id}/balance")
async def get_allowance_balance(member_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    txns = await database["allowance_txns"].find(
        {"family_id": user["family_id"], "member_id": member_id}, {"_id": 0}
    ).to_list(1000)
    balance = 0.0
    for t in txns:
        if t.get("txn_type") == "withdrawal":
            balance -= t.get("amount", 0)
        else:
            balance += t.get("amount", 0)
    return {"member_id": member_id, "balance": round(balance, 2)}


# -----------------------------------------------------------------------------
# Family Announcements / Chat
# -----------------------------------------------------------------------------
@app.get("/api/announcements")
async def list_announcements(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["announcements"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return [public_announcement(a) for a in rows]


@app.post("/api/announcements")
async def create_announcement(body: AnnouncementIn, user: dict = Depends(require_user), database=Depends(get_db)):
    announcement = {
        "announcement_id": new_id("ann"),
        "family_id": user["family_id"],
        "text": body.text,
        "author_name": user.get("name", ""),
        "priority": body.priority,
        "created_at": utcnow(),
    }
    await database["announcements"].insert_one(announcement)
    return public_announcement(announcement)


@app.delete("/api/announcements/{announcement_id}")
async def delete_announcement(announcement_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["announcements"].delete_one(
        {"announcement_id": announcement_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Announcement not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Document Expiry Alerts
# -----------------------------------------------------------------------------
@app.get("/api/vault/expiry-alerts")
async def vault_expiry_alerts(user: dict = Depends(require_user), database=Depends(get_db)):
    docs = await database["vault"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).to_list(500)
    alerts = []
    for doc in docs:
        exp = doc.get("expiry_date")
        if exp:
            exp_dt = ensure_aware_utc(exp)
            if exp_dt:
                days_left = (exp_dt - utcnow()).days
                alerts.append({
                    "doc_id": doc["doc_id"],
                    "title": doc.get("title", ""),
                    "category": doc.get("category", ""),
                    "expiry_date": iso(exp_dt),
                    "days_left": days_left,
                    "status": "expired" if days_left < 0 else "urgent" if days_left <= 30 else "upcoming",
                })
    alerts.sort(key=lambda a: a["days_left"])
    return alerts


@app.patch("/api/vault/{doc_id}/expiry")
async def set_vault_expiry(doc_id: str, expiry_date: str = Query(...), user: dict = Depends(require_user), database=Depends(get_db)):
    exp_dt = parse_dt(expiry_date)
    if not exp_dt:
        raise HTTPException(400, "Invalid date format")
    result = await database["vault"].update_one(
        {"doc_id": doc_id, "family_id": user["family_id"]},
        {"$set": {"expiry_date": exp_dt}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Document not found")
    return {"ok": True, "doc_id": doc_id, "expiry_date": iso(exp_dt)}


# -----------------------------------------------------------------------------
# Weekly Report Card
# -----------------------------------------------------------------------------
@app.get("/api/report/weekly")
async def weekly_report(user: dict = Depends(require_user), database=Depends(get_db)):
    await require_feature(user, "weekly_report")
    now = utcnow()
    week_ago = now - timedelta(days=7)
    fid = user["family_id"]

    cards_done = await database["cards"].count_documents(
        {"family_id": fid, "status": "DONE", "completed_at": {"$gte": week_ago}}
    )
    cards_created = await database["cards"].count_documents(
        {"family_id": fid, "created_at": {"$gte": week_ago}}
    )
    cards_overdue = await database["cards"].count_documents(
        {"family_id": fid, "status": "OPEN", "due_date": {"$lt": now}}
    )

    star_txns = await database["star_transactions"].find(
        {"family_id": fid, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).to_list(500)
    stars_given = sum(t.get("delta", 0) for t in star_txns if t.get("delta", 0) > 0)

    expenses = await database["expenses"].find(
        {"family_id": fid, "created_at": {"$gte": week_ago}}, {"_id": 0}
    ).to_list(500)
    total_spent = sum(e.get("amount", 0) for e in expenses)
    expense_categories = {}
    for e in expenses:
        cat = e.get("category", "Other")
        expense_categories[cat] = expense_categories.get(cat, 0) + e.get("amount", 0)

    upcoming_cards = await database["cards"].find(
        {"family_id": fid, "status": "OPEN", "due_date": {"$gte": now, "$lte": now + timedelta(days=7)}},
        {"_id": 0, "title": 1, "due_date": 1, "type": 1, "assignee": 1},
    ).sort("due_date", 1).to_list(10)

    routine_logs = await database["routine_logs"].count_documents(
        {"family_id": fid, "completed_at": {"$gte": week_ago}}
    )

    return {
        "period_start": iso(week_ago),
        "period_end": iso(now),
        "tasks_completed": cards_done,
        "tasks_created": cards_created,
        "tasks_overdue": cards_overdue,
        "stars_earned": stars_given,
        "total_spent": round(total_spent, 2),
        "expense_by_category": expense_categories,
        "routines_completed": routine_logs,
        "upcoming_deadlines": [
            {
                "title": c.get("title", ""),
                "due_date": iso(ensure_aware_utc(c.get("due_date"))),
                "type": c.get("type", "TASK"),
                "assignee": c.get("assignee"),
            }
            for c in upcoming_cards
        ],
    }


# -----------------------------------------------------------------------------
# Chore Wheel
# -----------------------------------------------------------------------------
@app.get("/api/chores")
async def list_chores(user: dict = Depends(require_user), database=Depends(get_db)):
    rows = await database["chores"].find(
        {"family_id": user["family_id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [public_chore(c) for c in rows]


@app.post("/api/chores")
async def create_chore(body: ChoreIn, user: dict = Depends(require_user), database=Depends(get_db)):
    chore = {
        "chore_id": new_id("chore"),
        "family_id": user["family_id"],
        "title": body.title,
        "frequency": body.frequency,
        "assigned_members": body.assigned_members,
        "current_assignee": body.assigned_members[0] if body.assigned_members else None,
        "rotate": body.rotate,
        "last_rotated": utcnow(),
        "created_at": utcnow(),
    }
    await database["chores"].insert_one(chore)
    return public_chore(chore)


@app.post("/api/chores/{chore_id}/rotate")
async def rotate_chore(chore_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    chore = await database["chores"].find_one(
        {"chore_id": chore_id, "family_id": user["family_id"]}, {"_id": 0}
    )
    if not chore:
        raise HTTPException(404, "Chore not found")
    members = chore.get("assigned_members", [])
    if len(members) < 2:
        return public_chore(chore)
    current = chore.get("current_assignee")
    try:
        idx = members.index(current)
        next_idx = (idx + 1) % len(members)
    except ValueError:
        next_idx = 0
    await database["chores"].update_one(
        {"chore_id": chore_id},
        {"$set": {"current_assignee": members[next_idx], "last_rotated": utcnow()}},
    )
    chore["current_assignee"] = members[next_idx]
    chore["last_rotated"] = utcnow()
    return public_chore(chore)


@app.delete("/api/chores/{chore_id}")
async def delete_chore(chore_id: str, user: dict = Depends(require_user), database=Depends(get_db)):
    result = await database["chores"].delete_one(
        {"chore_id": chore_id, "family_id": user["family_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Chore not found")
    return {"ok": True}


# -----------------------------------------------------------------------------
# Support Contact
# -----------------------------------------------------------------------------

class SupportContactIn(BaseModel):
    subject: str
    message: str

# -----------------------------------------------------------------------------
# Metrics (first-party, count-only — no payloads, no third-party SDKs)
# -----------------------------------------------------------------------------
ALLOWED_EVENTS = {
    "feed_open", "scan_used", "card_created", "vault_added", "vault_shared",
    "kids_open", "calendar_open", "onboarding_done",
}


class MetricEventIn(BaseModel):
    name: str


@app.post("/api/metrics/event")
async def log_metric_event(payload: MetricEventIn, user=Depends(require_user)):
    name = (payload.name or "").strip()
    if name not in ALLOWED_EVENTS:
        return {"ok": False}
    database = get_db()
    today = utcnow().strftime("%Y-%m-%d")
    try:
        await database["metrics_daily"].update_one(
            {"date": today, "name": name},
            {"$inc": {"count": 1}},
            upsert=True,
        )
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/metrics/summary")
async def metrics_summary(days: int = 14, user=Depends(require_user)):
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin only")
    database = get_db()
    days = max(1, min(days, 90))
    cutoff = (utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = []
    cursor = database["metrics_daily"].find(
        {"date": {"$gte": cutoff}}, {"_id": 0}
    ).sort("date", -1)
    async for row in cursor:
        rows.append(row)
    return {"days": days, "rows": rows}


@app.post("/api/support/contact")
async def submit_support_contact(
    body: SupportContactIn,
    user: dict = Depends(require_user),
    database=Depends(get_db),
):
    subject = body.subject.strip()[:200]
    message = body.message.strip()[:5000]
    if not subject or not message:
        raise HTTPException(400, "Subject and message are required")
    ticket = {
        "ticket_id": new_id("tkt"),
        "family_id": user["family_id"],
        "user_id": user["user_id"],
        "user_email": user.get("email", ""),
        "user_name": user.get("name", ""),
        "subject": subject,
        "message": message,
        "status": "open",
        "created_at": utcnow(),
    }
    await database["support_tickets"].insert_one(ticket)
    return {"ok": True, "ticket_id": ticket["ticket_id"]}


# -----------------------------------------------------------------------------
# Railway entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)

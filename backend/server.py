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
GOOGLE_CLIENT_IDS = [
    client_id.strip()
    for client_id in [
        GOOGLE_WEB_CLIENT_ID,
        GOOGLE_ANDROID_CLIENT_ID,
        *GOOGLE_CLIENT_IDS_EXTRA.split(","),
    ]
    if client_id and client_id.strip()
]
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

if GOOGLE_API_KEY and genai:
    genai.configure(api_key=GOOGLE_API_KEY)

mongo = AsyncIOMotorClient(MONGO_URL) if MONGO_URL else None
db: Any = mongo[DB_NAME] if mongo else None

app = FastAPI(title="Household COO Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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
            "max_members": 3,
            "ai_scans_per_month": 5,
            "vault_bytes": 20 * 1024 * 1024,
            "weekly_brief": False,
            "multi_property": False,
        },
    },
    "executive": {
        "price_monthly": 14.99,
        "price_yearly": 143.99,
        "limits": {
            "max_members": 8,
            "ai_scans_per_month": 100,
            "vault_bytes": 250 * 1024 * 1024,
            "weekly_brief": True,
            "multi_property": False,
        },
    },
    "family_office": {
        "price_monthly": 49.99,
        "price_yearly": 479.99,
        "limits": {
            "max_members": 20,
            "ai_scans_per_month": 1000,
            "vault_bytes": 2 * 1024 * 1024 * 1024,
            "weekly_brief": True,
            "multi_property": True,
        },
    },
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


async def get_family_doc(family_id: str):
    database = get_db()
    family = await database["families"].find_one({"family_id": family_id}, {"_id": 0})
    if not family:
        family = {
            "family_id": family_id,
            "plan": "executive",
            "billing_cycle": "monthly",
            "grandfathered": True,
            "updated_at": utcnow(),
            "ai_scans_used": 0,
            "ai_scans_period_start": utcnow(),
            "vault_bytes_used": 0,
        }
        await database["families"].insert_one(family)
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


def public_vault_doc(doc: dict) -> dict:
    return {
        "doc_id": doc["doc_id"],
        "family_id": doc["family_id"],
        "title": doc["title"],
        "category": doc["category"],
        "image_base64": doc["image_base64"],
        "created_at": iso(doc["created_at"]),
    }


def build_invite_url(token: str) -> str:
    base = INVITE_BASE_URL.strip() or "householdcoo:///"
    if "{token}" in base:
        return base.replace("{token}", token)
    joiner = "&" if "?" in base else "?"
    return f"{base}{joiner}invite={token}"


async def send_invite_email(to_email: str, invite_url: str, inviter_name: str) -> dict:
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

    if INVITE_REPLY_TO:
        payload["reply_to"] = INVITE_REPLY_TO

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

    return user


# -----------------------------------------------------------------------------
# Schemas
# -----------------------------------------------------------------------------
class SessionIn(BaseModel):
    session_id: str
    invite_token: Optional[str] = None


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
    status: Optional[str] = None


class VaultIn(BaseModel):
    title: str
    category: str
    image_base64: str


class RewardIn(BaseModel):
    title: str
    cost_stars: int
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
            token_info = google_id_token.verify_oauth2_token(
                payload.session_id,
                GoogleRequest(),
                client_id,
            )
            break
        except Exception as e:
            last_error = e

    if not token_info:
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
            "created_at": utcnow(),
            "updated_at": utcnow(),
        }
        await database["users"].insert_one(user)

        if not target_family_id:
            await database["families"].insert_one(
                {
                    "family_id": family_id,
                    "plan": "executive",
                    "billing_cycle": "monthly",
                    "grandfathered": True,
                    "updated_at": utcnow(),
                    "ai_scans_used": 0,
                    "ai_scans_period_start": utcnow(),
                    "vault_bytes_used": 0,
                }
            )

            seed_members = [
                {
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
                },
                {
                    "member_id": new_id("member"),
                    "family_id": family_id,
                    "name": "Emma",
                    "role": "Child",
                    "avatar": None,
                    "stars": 0,
                    "pin_hash": None,
                    "created_at": utcnow(),
                },
                {
                    "member_id": new_id("member"),
                    "family_id": family_id,
                    "name": "Noah",
                    "role": "Child",
                    "avatar": None,
                    "stars": 0,
                    "pin_hash": None,
                    "created_at": utcnow(),
                },
            ]
            await database["family_members"].insert_many(seed_members)
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


@app.post("/api/family/invite")
async def family_invite(payload: InviteIn, user=Depends(require_user)):
    database = get_db()
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
        invite = {
            "invite_id": new_id("invite"),
            "family_id": user["family_id"],
            "email": email,
            "token": secrets.token_urlsafe(24),
            "status": "pending",
            "created_by_user_id": user["user_id"],
            "created_by_name": user.get("name"),
            "created_by_email": user.get("email"),
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "expires_at": utcnow() + timedelta(days=INVITE_DAYS),
            "accepted_at": None,
            "accepted_by_user_id": None,
            "accepted_by_email": None,
        }
        await database["family_invites"].insert_one(invite)

    public = public_invite(invite)
    email_result = await send_invite_email(
        email,
        public["invite_url"],
        user.get("name") or user.get("email") or "A family member",
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
        print(f"new card alert failed: {e}")

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

    if payload.status:
        changes["status"] = payload.status
        changes["completed_at"] = utcnow() if payload.status == "DONE" else None
        award_child = (
            card["status"] != "DONE"
            and payload.status == "DONE"
            and card["type"] == "TASK"
            and bool(card.get("assignee"))
        )

    await database["cards"].update_one({"card_id": card_id}, {"$set": changes})
    updated = await database["cards"].find_one({"card_id": card_id}, {"_id": 0})

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
            raise HTTPException(status_code=e.code, detail=f"Google Calendar error: {body}")
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
# Railway entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)

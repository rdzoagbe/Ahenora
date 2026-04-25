import os
import io
import json
import base64
import asyncio
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from google.oauth2 import id_token as google_id_token
from google.auth.transport.requests import Request as GoogleRequest
import google.generativeai as genai
import PIL.Image


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
MONGO_URL = os.environ.get("MONGO_URL", "")
DB_NAME = os.environ.get("DB_NAME", "household_coo")

GOOGLE_WEB_CLIENT_ID = os.environ.get("GOOGLE_WEB_CLIENT_ID", "")
GOOGLE_ANDROID_CLIENT_ID = os.environ.get("GOOGLE_ANDROID_CLIENT_ID", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "")

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "7"))

GOOGLE_CLIENT_IDS = [
    client_id
    for client_id in [GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID]
    if client_id
]

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

mongo = AsyncIOMotorClient(MONGO_URL) if MONGO_URL else None
db: Any = mongo[DB_NAME] if mongo else None

app = FastAPI(title="Household COO Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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
    email = user.get("email", "")
    name = user.get("name") or (email.split("@")[0] if email else "Parent")

    return {
        "user_id": user.get("user_id", ""),
        "email": email,
        "name": name,
        "picture": user.get("picture"),
        "family_id": user.get("family_id", ""),
        "language": user.get("language", "en"),
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
    }


# -----------------------------------------------------------------------------
# Auth
# -----------------------------------------------------------------------------
@app.post("/api/auth/session")
async def exchange_session(payload: SessionIn):
    database = get_db()

    if not GOOGLE_CLIENT_IDS:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth client IDs are missing",
        )

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

    if token_info is None:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid Google token: {last_error}",
        )

    google_sub = token_info["sub"]
    email = token_info.get("email", "")
    name = token_info.get("name", email.split("@")[0] if email else "Parent")
    picture = token_info.get("picture")

    user = await database["users"].find_one({"google_sub": google_sub}, {"_id": 0})

    if not user:
        family_id = new_id("family")
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
                "name": name,
                "role": "Parent",
                "avatar": picture,
                "stars": 0,
                "pin_hash": None,
            },
            {
                "member_id": new_id("member"),
                "family_id": family_id,
                "name": "Emma",
                "role": "Child",
                "avatar": None,
                "stars": 0,
                "pin_hash": None,
            },
            {
                "member_id": new_id("member"),
                "family_id": family_id,
                "name": "Noah",
                "role": "Child",
                "avatar": None,
                "stars": 0,
                "pin_hash": None,
            },
        ]

        await database["family_members"].insert_many(seed_members)
    else:
        await database["users"].update_one(
            {"user_id": user["user_id"]},
            {"$set": {"email": email, "name": name, "picture": picture, "updated_at": utcnow()}},
        )
        user = await database["users"].find_one({"user_id": user["user_id"]}, {"_id": 0})

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
async def family_invite(payload: dict, user=Depends(require_user)):
    sub = await build_subscription(user["family_id"])
    limit = sub["limits"]["max_members"]
    used = sub["members_count"]

    if used >= limit:
        plan_limit_error(
            feature="family_members",
            current_plan=sub["plan"],
            limit=limit,
            used=used,
            message=f"Your current plan allows {limit} family members. Upgrade to add more.",
        )

    return {"ok": True, "message": "Invite flow stubbed for now"}


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

    if family.get("vault_bytes_used", 0) + size > sub["limits"]["vault_bytes"]:
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
# Subscription
# -----------------------------------------------------------------------------
@app.get("/api/subscription")
async def get_subscription(user=Depends(require_user)):
    return await build_subscription(user["family_id"])


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
# Weekly brief
# -----------------------------------------------------------------------------
@app.post("/api/brief/weekly")
async def weekly_brief(user=Depends(require_user)):
    database = get_db()
    sub = await build_subscription(user["family_id"])

    if not sub["limits"]["weekly_brief"]:
        plan_limit_error(
            feature="weekly_brief",
            current_plan=sub["plan"],
            message="Weekly Brief is available on Executive and Family Office plans.",
        )

    cards = []
    async for item in database["cards"].find({"family_id": user["family_id"], "status": "OPEN"}, {"_id": 0}):
        cards.append(item)

    if not cards:
        brief = (
            "You have a clear runway this week. Use the space to reset routines, "
            "confirm calendars, and get ahead on one important family task."
        )
        return {"brief": brief, "generated_at": iso(utcnow())}

    lines = []
    for c in cards[:12]:
        due = iso(c.get("due_date")) or "no due date"
        assignee = c.get("assignee") or "unassigned"
        lines.append(f"- {c['title']} | due: {due} | assignee: {assignee}")

    if not GOOGLE_API_KEY:
        brief = (
            "This week’s household priorities are: "
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

    if family.get("ai_scans_used", 0) >= sub["limits"]["ai_scans_per_month"]:
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
    }

    if GOOGLE_API_KEY:
        prompt = f"""
Extract a household action card from this image.
Return JSON only with keys:
type, title, description, assignee, due_date

Rules:
- type must be one of SIGN_SLIP, RSVP, TASK
- assignee must be one of: {", ".join(members) if members else ""}
- due_date must be ISO string or null
""".strip()

        try:
            text = await _gemini_vision(prompt, payload.image_base64)
            text = text.strip().removeprefix("```json").removesuffix("```").strip()
            parsed = json.loads(text)
            fallback.update(parsed)
        except Exception:
            pass

    await database["families"].update_one(
        {"family_id": user["family_id"]},
        {"$inc": {"ai_scans_used": 1}, "$set": {"updated_at": utcnow()}},
    )

    return fallback


# -----------------------------------------------------------------------------
# Voice placeholder
# -----------------------------------------------------------------------------
@app.post("/api/voice/transcribe")
async def voice_transcribe(audio: UploadFile = File(...), user=Depends(require_user)):
    raise HTTPException(status_code=501, detail="Voice transcription not implemented yet")


# -----------------------------------------------------------------------------
# Railway entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)

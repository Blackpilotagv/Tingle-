"""
Broker Service - Angel One SmartAPI Integration
Handles:
- connect_broker(): Authenticate with API key + TOTP and get session token
- disconnect_broker(): Clear session
- get_profile(): Fetch user profile from Angel One
- get_connection_status(): Check if broker session is alive
- Secure token storage in DB (base64 encoded, not exposed to frontend)
"""

import base64
import json
import requests
import pyotp
from datetime import datetime
from backend.database import get_db

# Angel One SmartAPI base URL
ANGEL_API_BASE = "https://apiconnect.angelone.in"

HEADERS_BASE = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
}


def _encode_token(token: str) -> str:
    """Simple base64 encode to avoid plain-text token in DB."""
    return base64.b64encode(token.encode()).decode()


def _decode_token(encoded: str) -> str:
    return base64.b64decode(encoded.encode()).decode()


def connect_broker(user_id: int, api_key: str, client_id: str, password: str, totp_secret: str) -> dict:
    """
    Authenticate with Angel One SmartAPI.
    Steps:
    1. Generate TOTP from secret
    2. POST /rest/auth/angelbroking/user/v1/loginByPassword
    3. Store jwt_token + refresh_token + feed_token in DB
    Returns: {"success": True, "profile": {...}} or {"error": "..."}
    """
    try:
        # Generate TOTP
        totp = pyotp.TOTP(totp_secret).now()

        payload = {
            "clientcode": client_id,
            "password": password,
            "totp": totp,
        }

        headers = {**HEADERS_BASE, "X-PrivateKey": api_key}

        resp = requests.post(
            f"{ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword",
            json=payload,
            headers=headers,
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        if not data.get("status") or not data.get("data"):
            return {"error": data.get("message", "Login failed")}

        session_data = data["data"]
        jwt_token = session_data.get("jwtToken", "")
        refresh_token = session_data.get("refreshToken", "")
        feed_token = session_data.get("feedToken", "")

        # Store in DB (encoded)
        conn = get_db()
        existing = conn.execute(
            "SELECT id FROM broker_accounts WHERE user_id=?", (user_id,)
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE broker_accounts
                   SET api_key=?, client_id=?, encrypted_token=?, refresh_token=?,
                       feed_token=?, connection_status='connected', last_connected=?
                   WHERE user_id=?""",
                (
                    _encode_token(api_key),
                    client_id,
                    _encode_token(jwt_token),
                    _encode_token(refresh_token),
                    _encode_token(feed_token),
                    datetime.utcnow().isoformat(),
                    user_id,
                ),
            )
        else:
            conn.execute(
                """INSERT INTO broker_accounts
                   (user_id, broker_name, api_key, client_id, encrypted_token,
                    refresh_token, feed_token, connection_status, last_connected)
                   VALUES (?, 'angelone', ?, ?, ?, ?, ?, 'connected', ?)""",
                (
                    user_id,
                    _encode_token(api_key),
                    client_id,
                    _encode_token(jwt_token),
                    _encode_token(refresh_token),
                    _encode_token(feed_token),
                    datetime.utcnow().isoformat(),
                ),
            )
        conn.commit()
        conn.close()

        # Fetch profile
        profile = get_profile(user_id, api_key=api_key, jwt_token=jwt_token)
        return {"success": True, "profile": profile}

    except requests.exceptions.Timeout:
        return {"error": "Connection timed out. Check your network."}
    except requests.exceptions.RequestException as e:
        return {"error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"error": str(e)}


def get_broker_session(user_id: int) -> dict | None:
    """Retrieve decrypted broker credentials for a user. Returns None if not connected."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM broker_accounts WHERE user_id=? AND connection_status='connected'",
        (user_id,),
    ).fetchone()
    conn.close()

    if not row:
        return None

    return {
        "api_key": _decode_token(row["api_key"]),
        "client_id": row["client_id"],
        "jwt_token": _decode_token(row["encrypted_token"]),
        "refresh_token": _decode_token(row["refresh_token"]) if row["refresh_token"] else "",
        "feed_token": _decode_token(row["feed_token"]) if row["feed_token"] else "",
    }


def get_auth_headers(user_id: int) -> dict | None:
    """Build auth headers needed for Angel One API calls."""
    sess = get_broker_session(user_id)
    if not sess:
        return None
    return {
        **HEADERS_BASE,
        "X-PrivateKey": sess["api_key"],
        "Authorization": f"Bearer {sess['jwt_token']}",
    }


def get_profile(user_id: int, api_key: str = None, jwt_token: str = None) -> dict:
    """Fetch user profile from Angel One."""
    try:
        if api_key and jwt_token:
            headers = {**HEADERS_BASE, "X-PrivateKey": api_key, "Authorization": f"Bearer {jwt_token}"}
        else:
            headers = get_auth_headers(user_id)
            if not headers:
                return {"error": "Not connected"}

        resp = requests.get(
            f"{ANGEL_API_BASE}/rest/secure/angelbroking/user/v1/getProfile",
            headers=headers,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {})
    except Exception as e:
        return {"error": str(e)}


def disconnect_broker(user_id: int) -> dict:
    """Mark broker as disconnected. Optionally call Angel One logout."""
    try:
        sess = get_broker_session(user_id)
        if sess:
            headers = get_auth_headers(user_id)
            if headers:
                try:
                    requests.post(
                        f"{ANGEL_API_BASE}/rest/secure/angelbroking/user/v1/logout",
                        json={"clientcode": sess["client_id"]},
                        headers=headers,
                        timeout=5,
                    )
                except Exception:
                    pass  # Best effort logout

        conn = get_db()
        conn.execute(
            "UPDATE broker_accounts SET connection_status='disconnected' WHERE user_id=?",
            (user_id,),
        )
        conn.commit()
        conn.close()
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}


def get_connection_status(user_id: int) -> dict:
    """Check broker connection status from DB."""
    conn = get_db()
    row = conn.execute(
        "SELECT connection_status, client_id, broker_name, last_connected FROM broker_accounts WHERE user_id=?",
        (user_id,),
    ).fetchone()
    conn.close()

    if not row:
        return {"status": "not_configured"}

    return {
        "status": row["connection_status"],
        "client_id": row["client_id"],
        "broker": row["broker_name"],
        "last_connected": row["last_connected"],
    }

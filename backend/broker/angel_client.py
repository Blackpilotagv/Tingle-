"""
Angel One SmartAPI Client  — FIXED
==============================================
Root cause of AG8001 "Invalid Token":
  generateSession() does:
      self.access_token = jwtToken          (raw token, no prefix)
      user['data']['jwtToken'] = "Bearer " + jwtToken   ← mutates return value
  Old code stored data["data"]["jwtToken"] which had "Bearer " prefix.
  Then setAccessToken("Bearer xyz") made header "Bearer Bearer xyz" → rejected.

Fix:
  1. Read raw jwtToken from loginResultObject['data']['jwtToken']  (before the mutation)
  2. Also store refresh_token and userId so we can restore a full session.
  3. In get_broker_session(), pass all four tokens to SmartConnect.__init__()
     instead of calling setAccessToken() on a blank object.
"""

import pyotp
from SmartApi.smartConnect import SmartConnect
from backend.database import get_db
from datetime import datetime


def connect_broker(user_id: int, api_key: str, client_id: str,
                   password: str, totp_secret: str):
    """
    Authenticate with Angel One SmartAPI.
    Returns (True, message) on success, (False, error) on failure.
    Stores raw jwtToken, refreshToken, feedToken, userId in broker_accounts.
    """
    try:
        obj = SmartConnect(api_key=api_key)
        totp = pyotp.TOTP(totp_secret).now()

        # generateSession internally calls _postRequest("api.login")
        # loginResultObject['data']['jwtToken'] is the RAW token (no Bearer prefix)
        # generateSession then MUTATES the return value to add "Bearer " prefix
        # So we must capture the raw token BEFORE calling generateSession,
        # OR use obj.access_token which is set to the raw token inside generateSession.

        session_data = obj.generateSession(client_id, password, totp)

        # generateSession returns the profile (user) dict on success,
        # or the raw login error dict on failure.
        # Success: session_data['status'] == True, session_data['data']['clientcode'] exists
        # Failure: session_data['status'] == False, session_data['message'] exists

        if not session_data.get("status"):
            return False, session_data.get("message", "Authentication failed")

        # After generateSession, obj.access_token holds the RAW jwt (no "Bearer " prefix)
        raw_jwt      = obj.access_token          # ← raw token, safe to store
        refresh_token = obj.refresh_token
        feed_token    = obj.feed_token
        user_id_angel = obj.userId               # Angel One client code

        db = get_db()
        existing = db.execute(
            "SELECT id FROM broker_accounts WHERE user_id=?", (user_id,)
        ).fetchone()

        if existing:
            db.execute(
                """UPDATE broker_accounts
                   SET api_key=?, client_id=?, encrypted_token=?,
                       refresh_token=?, feed_token=?, angel_user_id=?,
                       connection_status='connected', connected_at=?
                   WHERE user_id=?""",
                (api_key, client_id, raw_jwt, refresh_token, feed_token,
                 user_id_angel, datetime.utcnow().isoformat(), user_id)
            )
        else:
            db.execute(
                """INSERT INTO broker_accounts
                   (user_id, broker_name, api_key, client_id, encrypted_token,
                    refresh_token, feed_token, angel_user_id,
                    connection_status, connected_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (user_id, "angelone", api_key, client_id, raw_jwt,
                 refresh_token, feed_token, user_id_angel,
                 "connected", datetime.utcnow().isoformat())
            )
        db.commit()
        db.close()
        return True, f"Connected as {user_id_angel}"

    except Exception as e:
        return False, str(e)


def get_broker_session(user_id: int):
    """
    Restores a SmartConnect session from DB.
    Passes all tokens directly to SmartConnect.__init__() — the only
    correct way to restore a session without re-authenticating.
    Returns (SmartConnect, broker_row) or (None, None).
    """
    db = get_db()
    row = db.execute(
        """SELECT * FROM broker_accounts
           WHERE user_id=? AND connection_status='connected'""",
        (user_id,)
    ).fetchone()
    db.close()

    if not row:
        return None, None

    # Pass ALL tokens at construction time — avoids the "Bearer Bearer" bug
    obj = SmartConnect(
        api_key      = row["api_key"],
        access_token = row["encrypted_token"],   # raw JWT, no "Bearer " prefix
        refresh_token= row["refresh_token"] or "",
        feed_token   = row["feed_token"] or "",
        userId       = row["angel_user_id"] or row["client_id"],
    )
    return obj, row


def disconnect_broker(user_id: int):
    db = get_db()
    db.execute(
        """UPDATE broker_accounts
           SET connection_status='disconnected', encrypted_token=NULL,
               refresh_token=NULL
           WHERE user_id=?""",
        (user_id,)
    )
    db.commit()
    db.close()
    return True, "Disconnected"


def get_connection_status(user_id: int):
    db = get_db()
    row = db.execute(
        """SELECT connection_status, connected_at, client_id, angel_user_id
           FROM broker_accounts WHERE user_id=?""",
        (user_id,)
    ).fetchone()
    db.close()
    if not row:
        return {"status": "not_configured"}
    return {
        "status":       row["connection_status"],
        "connected_at": row["connected_at"],
        "client_id":    row["angel_user_id"] or row["client_id"],
    }


def get_profile(user_id: int):
    smart, row = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.getProfile(row["refresh_token"] or "")
        if resp.get("status"):
            return resp["data"], None
        return None, resp.get("message", "Profile fetch failed")
    except Exception as e:
        return None, str(e)


def get_funds(user_id: int):
    smart, row = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.rmsLimit()
        if isinstance(resp, dict) and resp.get("status"):
            return resp.get("data", {}), None
        return None, resp.get("message", "RMS Limit fetch failed") if isinstance(resp, dict) else "RMS Limit fetch failed"
    except Exception as e:
        return None, str(e)


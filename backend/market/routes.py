"""
Market Blueprint — REST endpoints for search, prices, candles, watchlist.
"""

from flask import Blueprint, jsonify, request, session
from backend.database import get_db
from backend.market.service import (
    search_scrip, get_ltp, get_quote, get_candles,
    get_watchlist_with_ltp, resolve_token
)

market_bp = Blueprint("market", __name__)


def uid():
    return session.get("user_id")


# ── Symbol Search ─────────────────────────────────────────────────────────────
@market_bp.route("/search")
def search():
    """
    GET /market/search?q=RELIANCE&exchange=NSE
    Returns list of matching instruments with token, exchange, name.
    """
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    q        = request.args.get("q", "").strip()
    exchange = request.args.get("exchange", "NSE").upper()
    if len(q) < 2:
        return jsonify({"results": []})
    results, err = search_scrip(uid(), q, exchange)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"results": results or []})


# ── Live Price ────────────────────────────────────────────────────────────────
@market_bp.route("/ltp/<symbol>")
def ltp(symbol):
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    exchange = request.args.get("exchange", "NSE")
    data, err = get_ltp(uid(), symbol.upper(), exchange)
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


@market_bp.route("/quote/<symbol>")
def quote(symbol):
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    exchange = request.args.get("exchange", "NSE")
    data, err = get_quote(uid(), symbol.upper(), exchange)
    if err:
        return jsonify({"error": err}), 400
    return jsonify(data)


# ── Candles ───────────────────────────────────────────────────────────────────
@market_bp.route("/candles/<symbol>")
def candles(symbol):
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    timeframe = request.args.get("timeframe", "5m")
    exchange  = request.args.get("exchange", "NSE")
    data, err = get_candles(uid(), symbol.upper(), timeframe, exchange)
    if err and not data:
        return jsonify({"error": err}), 400
    return jsonify({
        "symbol":    symbol.upper(),
        "timeframe": timeframe,
        "candles":   data or [],
        "warning":   err if (err and data) else None,
    })


# ── Watchlist ─────────────────────────────────────────────────────────────────
@market_bp.route("/watchlist")
def get_watchlist():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT symbol, exchange, token FROM watchlist WHERE user_id=? ORDER BY added_at",
        (uid(),)
    ).fetchall()
    db.close()
    return jsonify({"watchlist": [dict(r) for r in rows]})


@market_bp.route("/watchlist/add", methods=["POST"])
def add_to_watchlist():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data     = request.get_json() or {}
    symbol   = data.get("symbol", "").upper().strip()
    exchange = data.get("exchange", "NSE").upper()
    token    = data.get("token", "")     # token passed directly from search result

    if not symbol:
        return jsonify({"error": "Symbol required"}), 400

    # If no token provided, try to resolve it now
    if not token:
        token, _, _ = resolve_token(uid(), symbol, exchange)

    db = get_db()
    try:
        db.execute(
            """INSERT OR IGNORE INTO watchlist (user_id, symbol, exchange, token)
               VALUES (?,?,?,?)""",
            (uid(), symbol, exchange, token or None)
        )
        # Update token if row already existed without one
        if token:
            db.execute(
                "UPDATE watchlist SET token=? WHERE user_id=? AND symbol=? AND (token IS NULL OR token='')",
                (token, uid(), symbol)
            )
        db.commit()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()
    return jsonify({"success": True, "symbol": symbol, "token": token})


@market_bp.route("/watchlist/remove", methods=["POST"])
def remove_from_watchlist():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    symbol = (request.get_json() or {}).get("symbol", "").upper()
    db = get_db()
    db.execute("DELETE FROM watchlist WHERE user_id=? AND symbol=?", (uid(), symbol))
    db.commit()
    db.close()
    return jsonify({"success": True})


@market_bp.route("/watchlist/ltp")
def watchlist_ltp():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data = get_watchlist_with_ltp(uid())
    return jsonify({"watchlist": data})

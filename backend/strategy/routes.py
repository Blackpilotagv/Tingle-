"""
Strategy Blueprint - CRUD for user strategies + signal generation.
"""

import json
from flask import Blueprint, jsonify, request, session
from backend.database import get_db
from backend.strategy.engine import evaluate_strategy
from backend.market.service import get_candles
from backend.strategy.indicators import calculate_all

strategy_bp = Blueprint("strategy", __name__)


def uid():
    return session.get("user_id")


@strategy_bp.route("/list")
def list_strategies():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT id, strategy_name, active_status, created_at FROM strategies WHERE user_id=? ORDER BY created_at DESC",
        (uid(),)
    ).fetchall()
    db.close()
    return jsonify({"strategies": [dict(r) for r in rows]})


@strategy_bp.route("/save", methods=["POST"])
def save_strategy():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data = request.get_json() or {}
    name   = data.get("name", "").strip()
    logic  = data.get("logic", {})
    sid    = data.get("id")

    if not name or not logic:
        return jsonify({"error": "name and logic required"}), 400

    logic_str = json.dumps(logic)
    db = get_db()
    try:
        if sid:
            db.execute(
                "UPDATE strategies SET strategy_name=?, strategy_logic=? WHERE id=? AND user_id=?",
                (name, logic_str, sid, uid())
            )
        else:
            db.execute(
                "INSERT INTO strategies (user_id, strategy_name, strategy_logic) VALUES (?,?,?)",
                (uid(), name, logic_str)
            )
        db.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        db.close()


@strategy_bp.route("/delete/<int:sid>", methods=["DELETE"])
def delete_strategy(sid):
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    db = get_db()
    db.execute("DELETE FROM strategies WHERE id=? AND user_id=?", (sid, uid()))
    db.commit()
    db.close()
    return jsonify({"success": True})


@strategy_bp.route("/signal", methods=["POST"])
def get_signal():
    """Run a strategy against live candles and return BUY/SELL/HOLD."""
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data     = request.get_json() or {}
    symbol   = data.get("symbol", "").upper()
    tf       = data.get("timeframe", "5m")
    strategy = data.get("strategy", {})

    candles, err = get_candles(uid(), symbol, tf)
    if err:
        return jsonify({"error": err}), 400

    signal = evaluate_strategy(strategy, candles)
    return jsonify({"symbol": symbol, "signal": signal, "candle_count": len(candles)})


@strategy_bp.route("/indicators/<symbol>")
def indicators(symbol):
    """Return all computed indicator values for the chart."""
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    tf = request.args.get("timeframe", "5m")
    exchange = request.args.get("exchange", "NSE")
    candles, err = get_candles(uid(), symbol.upper(), tf, exchange)
    if err:
        return jsonify({"error": err}), 400
    inds = calculate_all(candles)
    return jsonify({"symbol": symbol.upper(), "indicators": inds})

"""
Execution Blueprint - order placement and management API.
"""

from flask import Blueprint, jsonify, request, session
from backend.execution.service import (
    place_order, modify_order, cancel_order,
    get_order_book, get_positions, get_holdings
)
from backend.database import get_db

execution_bp = Blueprint("execution", __name__)


def uid():
    return session.get("user_id")


@execution_bp.route("/place", methods=["POST"])
def place():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    d = request.get_json() or {}
    result, err = place_order(
        user_id          = uid(),
        symbol           = d.get("symbol", "").upper(),
        exchange         = d.get("exchange", "NSE"),
        transaction_type = d.get("transaction_type", "BUY").upper(),
        quantity         = int(d.get("quantity", 0)),
        order_type       = d.get("order_type", "MARKET"),
        price            = float(d.get("price", 0)),
        trigger_price    = float(d.get("trigger_price", 0)),
        product_type     = d.get("product_type", "INTRADAY"),
        strategy_id      = d.get("strategy_id")
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"success": True, "data": result})


@execution_bp.route("/modify", methods=["POST"])
def modify():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    d = request.get_json() or {}
    result, err = modify_order(uid(), d.get("broker_order_id"), 
                               int(d.get("quantity", 0)),
                               float(d.get("price", 0)), d.get("order_type", "LIMIT"))
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"success": True, "data": result})


@execution_bp.route("/cancel", methods=["POST"])
def cancel():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    bid = (request.get_json() or {}).get("broker_order_id")
    result, err = cancel_order(uid(), bid)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"success": True, "data": result})


@execution_bp.route("/orders")
def orders():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data, err = get_order_book(uid())
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"orders": data})


@execution_bp.route("/orders/history")
def orders_history():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    db = get_db()
    rows = db.execute(
        "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        (uid(),)
    ).fetchall()
    db.close()
    return jsonify({"orders": [dict(r) for r in rows]})


@execution_bp.route("/positions")
def positions():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data, err = get_positions(uid())
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"positions": data})


@execution_bp.route("/holdings")
def holdings():
    if not uid():
        return jsonify({"error": "Not logged in"}), 401
    data, err = get_holdings(uid())
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"holdings": data})

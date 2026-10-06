"""
Broker Blueprint - Angel One connection management API.
"""

from flask import Blueprint, request, jsonify, session
from backend.broker.angel_client import (
    connect_broker, disconnect_broker,
    get_connection_status, get_profile, get_funds
)

broker_bp = Blueprint("broker", __name__)


def require_login():
    uid = session.get("user_id")
    if not uid:
        return None, jsonify({"error": "Not logged in"}), 401
    return uid, None, None


@broker_bp.route("/connect", methods=["POST"])
def connect():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401

    data = request.get_json() or {}
    api_key     = data.get("api_key", "").strip()
    client_id   = data.get("client_id", "").strip()
    password    = data.get("password", "")
    totp_secret = data.get("totp_secret", "").strip()

    if not all([api_key, client_id, password, totp_secret]):
        return jsonify({"error": "All fields required: api_key, client_id, password, totp_secret"}), 400

    ok, msg = connect_broker(user_id, api_key, client_id, password, totp_secret)
    if ok:
        return jsonify({"success": True, "message": msg})
    return jsonify({"success": False, "error": msg}), 400


@broker_bp.route("/disconnect", methods=["POST"])
def disconnect():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    ok, msg = disconnect_broker(user_id)
    return jsonify({"success": ok, "message": msg})


@broker_bp.route("/status")
def status():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify(get_connection_status(user_id))


@broker_bp.route("/profile")
def profile():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data, err = get_profile(user_id)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"success": True, "data": data})


@broker_bp.route("/funds")
def funds():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"error": "Not logged in"}), 401
    data, err = get_funds(user_id)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"success": True, "data": data})


"""
Risk Blueprint - stop loss and target management utilities.
Phase 4 will add auto-exit monitoring. For now exposes calculation helpers.
"""

from flask import Blueprint, jsonify, request, session

risk_bp = Blueprint("risk", __name__)


@risk_bp.route("/calculate", methods=["POST"])
def calculate():
    """
    Given entry price, SL%, target%, quantity:
    Returns stop loss price, target price, max loss, max profit, risk-reward.
    """
    d = request.get_json() or {}
    entry_price = float(d.get("entry_price", 0))
    sl_pct      = float(d.get("sl_percent", 2))
    target_pct  = float(d.get("target_percent", 4))
    quantity    = int(d.get("quantity", 1))
    side        = d.get("side", "BUY").upper()

    if entry_price <= 0:
        return jsonify({"error": "entry_price required"}), 400

    if side == "BUY":
        sl_price     = round(entry_price * (1 - sl_pct / 100), 2)
        target_price = round(entry_price * (1 + target_pct / 100), 2)
    else:
        sl_price     = round(entry_price * (1 + sl_pct / 100), 2)
        target_price = round(entry_price * (1 - target_pct / 100), 2)

    max_loss   = round(abs(entry_price - sl_price) * quantity, 2)
    max_profit = round(abs(target_price - entry_price) * quantity, 2)
    rr_ratio   = round(max_profit / max_loss, 2) if max_loss else 0

    return jsonify({
        "entry_price":   entry_price,
        "stop_loss":     sl_price,
        "target":        target_price,
        "max_loss":      max_loss,
        "max_profit":    max_profit,
        "risk_reward":   rr_ratio,
        "quantity":      quantity,
    })

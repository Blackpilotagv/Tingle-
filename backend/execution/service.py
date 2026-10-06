"""
Order Execution Service
Uses resolve_token() from market.service for all instrument lookups —
no hardcoded token map needed.
"""

from backend.broker.angel_client import get_broker_session
from backend.database import get_db
from backend.market.service import resolve_token
from datetime import datetime


def place_order(user_id: int, symbol: str, exchange: str,
                transaction_type: str, quantity: int,
                order_type: str = "MARKET", price: float = 0,
                trigger_price: float = 0, product_type: str = "INTRADAY",
                strategy_id: int = None):
    """
    Places an order via Angel One.
    Logs to DB first (PENDING), updates to PLACED or FAILED after broker response.
    """
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"

    # Resolve instrument token (live lookup if not cached)
    token, resolved_exch, err = resolve_token(user_id, symbol.upper(), exchange)
    if err:
        return None, f"Token resolution failed: {err}"
    if not token:
        return None, f"Instrument token not found for {symbol}"

    # Basic validation
    if quantity <= 0:
        return None, "Quantity must be > 0"
    if order_type in ("LIMIT", "STOPLOSS_LIMIT") and price <= 0:
        return None, "Price required for LIMIT/SL-LIMIT orders"
    if order_type in ("STOPLOSS_MARKET", "STOPLOSS_LIMIT") and trigger_price <= 0:
        return None, "Trigger price required for SL orders"

    # Log to DB first (PENDING)
    db = get_db()
    cur = db.execute(
        """INSERT INTO orders
           (user_id, symbol, exchange, order_type, transaction_type,
            quantity, price, trigger_price, status, strategy_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (user_id, symbol.upper(), resolved_exch, order_type, transaction_type.upper(),
         quantity, price, trigger_price, "PENDING", strategy_id)
    )
    local_order_id = cur.lastrowid
    db.commit()

    try:
        params = {
            "variety":         "NORMAL",
            "tradingsymbol":   symbol.upper(),
            "symboltoken":     token,
            "transactiontype": transaction_type.upper(),
            "exchange":        resolved_exch,
            "ordertype":       order_type,
            "producttype":     product_type,
            "duration":        "DAY",
            "price":           str(round(price, 2)),
            "triggerprice":    str(round(trigger_price, 2)),
            "quantity":        str(quantity),
        }

        resp = smart.placeOrder(params)

        if resp.get("status"):
            broker_order_id = resp["data"]["orderid"]
            db.execute(
                "UPDATE orders SET status='PLACED', broker_order_id=? WHERE id=?",
                (broker_order_id, local_order_id)
            )
            db.commit()
            db.close()
            return {
                "local_id":        local_order_id,
                "broker_order_id": broker_order_id,
                "symbol":          symbol.upper(),
                "transaction_type": transaction_type.upper(),
                "quantity":        quantity,
            }, None
        else:
            msg = resp.get("message", "Order placement failed")
            db.execute("UPDATE orders SET status='FAILED' WHERE id=?", (local_order_id,))
            db.commit()
            db.close()
            return None, msg

    except Exception as e:
        db.execute("UPDATE orders SET status='FAILED' WHERE id=?", (local_order_id,))
        db.commit()
        db.close()
        return None, str(e)


def modify_order(user_id: int, broker_order_id: str, quantity: int,
                 price: float, order_type: str):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.modifyOrder({
            "variety":   "NORMAL",
            "orderid":   broker_order_id,
            "ordertype": order_type,
            "quantity":  str(quantity),
            "price":     str(round(price, 2)),
            "duration":  "DAY",
        })
        if resp.get("status"):
            return resp["data"], None
        return None, resp.get("message", "Modify failed")
    except Exception as e:
        return None, str(e)


def cancel_order(user_id: int, broker_order_id: str):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.cancelOrder(broker_order_id, "NORMAL")
        if resp.get("status"):
            db = get_db()
            db.execute(
                "UPDATE orders SET status='CANCELLED' WHERE broker_order_id=? AND user_id=?",
                (broker_order_id, user_id)
            )
            db.commit()
            db.close()
            return resp.get("data", {}), None
        return None, resp.get("message", "Cancel failed")
    except Exception as e:
        return None, str(e)


def get_order_book(user_id: int):
    smart, _ = get_broker_session(user_id)
    if not smart:
        # Fallback: return local DB orders
        db = get_db()
        rows = db.execute(
            "SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
            (user_id,)
        ).fetchall()
        db.close()
        return [dict(r) for r in rows], None
    try:
        resp = smart.orderBook()
        if resp.get("status"):
            return resp.get("data") or [], None
        return None, resp.get("message", "Order book failed")
    except Exception as e:
        return None, str(e)


def get_positions(user_id: int):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.position()
        if resp.get("status"):
            positions = resp.get("data") or []
            db = get_db()
            db.execute("DELETE FROM positions WHERE user_id=?", (user_id,))
            for p in positions:
                db.execute(
                    """INSERT INTO positions (user_id, symbol, exchange, quantity,
                       average_price, pnl, product_type)
                       VALUES (?,?,?,?,?,?,?)""",
                    (user_id, p.get("tradingsymbol"), p.get("exchange"),
                     int(p.get("netqty", 0)),
                     float(p.get("averageprice", 0)),
                     float(p.get("unrealised", 0)),
                     p.get("producttype"))
                )
            db.commit()
            db.close()
            return positions, None
        return None, resp.get("message", "Position fetch failed")
    except Exception as e:
        return None, str(e)


def get_holdings(user_id: int):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.holding()
        if resp.get("status"):
            return resp.get("data") or [], None
        return None, resp.get("message", "Holdings fetch failed")
    except Exception as e:
        return None, str(e)

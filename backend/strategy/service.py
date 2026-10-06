"""
Strategy Service
Handles:
- save_strategy(): Store strategy as JSON in DB
- get_strategies(): List user strategies
- evaluate_strategy(): Run strategy conditions against candle data + indicators
- calculate_indicators(): EMA, SMA, RSI, MACD, Bollinger Bands

Strategy JSON format:
{
  "conditions": [
    {"indicator": "RSI", "period": 14, "operator": "<", "value": 30},
    {"indicator": "EMA", "period": 20, "operator": "crosses_above", "compare_indicator": "EMA", "compare_period": 50}
  ],
  "action": "BUY",
  "stoploss": 2,
  "target": 5,
  "quantity": 1,
  "product_type": "INTRADAY"
}
"""

import json
import math
from datetime import datetime
from backend.database import get_db


# ── Indicator Calculations ─────────────────────────────────────────────

def calculate_sma(closes: list[float], period: int) -> list[float | None]:
    """Simple Moving Average."""
    result = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        result[i] = sum(closes[i - period + 1 : i + 1]) / period
    return result


def calculate_ema(closes: list[float], period: int) -> list[float | None]:
    """Exponential Moving Average."""
    result = [None] * len(closes)
    if len(closes) < period:
        return result

    # Seed with SMA
    result[period - 1] = sum(closes[:period]) / period
    k = 2 / (period + 1)

    for i in range(period, len(closes)):
        result[i] = closes[i] * k + result[i - 1] * (1 - k)

    return result


def calculate_rsi(closes: list[float], period: int = 14) -> list[float | None]:
    """Relative Strength Index."""
    result = [None] * len(closes)
    if len(closes) < period + 1:
        return result

    gains, losses = [], []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(closes)):
        if i > period:
            avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period

        if avg_loss == 0:
            result[i] = 100
        else:
            rs = avg_gain / avg_loss
            result[i] = 100 - (100 / (1 + rs))

    return result


def calculate_macd(closes: list[float], fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """MACD = EMA(fast) - EMA(slow), Signal = EMA(MACD, signal)."""
    ema_fast = calculate_ema(closes, fast)
    ema_slow = calculate_ema(closes, slow)

    macd_line = []
    for f, s in zip(ema_fast, ema_slow):
        if f is not None and s is not None:
            macd_line.append(f - s)
        else:
            macd_line.append(None)

    # Signal line: EMA of MACD where available
    valid_indices = [i for i, v in enumerate(macd_line) if v is not None]
    signal_line = [None] * len(closes)

    if len(valid_indices) >= signal:
        valid_macd = [macd_line[i] for i in valid_indices]
        valid_signal = calculate_ema(valid_macd, signal)
        for idx, vi in enumerate(valid_indices):
            if valid_signal[idx] is not None:
                signal_line[vi] = valid_signal[idx]

    histogram = []
    for m, s in zip(macd_line, signal_line):
        if m is not None and s is not None:
            histogram.append(m - s)
        else:
            histogram.append(None)

    return {"macd": macd_line, "signal": signal_line, "histogram": histogram}


def calculate_bollinger_bands(closes: list[float], period: int = 20, std_dev: float = 2.0) -> dict:
    """Bollinger Bands: middle = SMA(period), upper/lower = middle ± stddev * σ."""
    middle = calculate_sma(closes, period)
    upper = [None] * len(closes)
    lower = [None] * len(closes)

    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1 : i + 1]
        mean = middle[i]
        variance = sum((x - mean) ** 2 for x in window) / period
        sigma = math.sqrt(variance)
        upper[i] = mean + std_dev * sigma
        lower[i] = mean - std_dev * sigma

    return {"upper": upper, "middle": middle, "lower": lower}


def calculate_all_indicators(candles: list[dict]) -> dict:
    """
    Calculate all indicators from a list of candle dicts.
    Each candle: {time, open, high, low, close, volume}
    Returns dict of indicator name → values list.
    """
    if not candles:
        return {}

    closes = [c["close"] for c in candles]
    times = [c["time"] for c in candles]

    indicators = {
        "times": times,
        "EMA_9": calculate_ema(closes, 9),
        "EMA_20": calculate_ema(closes, 20),
        "EMA_50": calculate_ema(closes, 50),
        "EMA_200": calculate_ema(closes, 200),
        "SMA_20": calculate_sma(closes, 20),
        "SMA_50": calculate_sma(closes, 50),
        "RSI_14": calculate_rsi(closes, 14),
        "MACD": calculate_macd(closes),
        "BB_20": calculate_bollinger_bands(closes, 20),
    }
    return indicators


# ── Strategy Evaluation ────────────────────────────────────────────────

def _get_indicator_value(indicators: dict, indicator: str, period: int, index: int) -> float | None:
    """Extract latest indicator value by name and period."""
    key = f"{indicator.upper()}_{period}"
    series = indicators.get(key)
    if series and index < len(series):
        return series[index]
    # Handle nested (MACD, BB)
    if indicator.upper() == "MACD":
        return indicators.get("MACD", {}).get("macd", [None] * (index + 1))[index]
    if indicator.upper() == "BB_UPPER":
        return indicators.get("BB_20", {}).get("upper", [None] * (index + 1))[index]
    if indicator.upper() == "BB_LOWER":
        return indicators.get("BB_20", {}).get("lower", [None] * (index + 1))[index]
    return None


def _check_condition(condition: dict, indicators: dict, idx: int, prev_idx: int) -> bool:
    """
    Evaluate a single strategy condition.
    Supports operators: <, >, <=, >=, ==, crosses_above, crosses_below
    """
    indicator = condition.get("indicator", "")
    period = condition.get("period", 14)
    operator = condition.get("operator", ">")
    value = condition.get("value")
    compare_indicator = condition.get("compare_indicator")
    compare_period = condition.get("compare_period")

    current_val = _get_indicator_value(indicators, indicator, period, idx)
    if current_val is None:
        return False

    # Compare against a fixed value
    if value is not None and not compare_indicator:
        target = float(value)
        ops = {
            "<": current_val < target,
            ">": current_val > target,
            "<=": current_val <= target,
            ">=": current_val >= target,
            "==": abs(current_val - target) < 0.001,
        }
        return ops.get(operator, False)

    # Compare against another indicator (e.g., EMA crosses)
    if compare_indicator and compare_period:
        compare_val = _get_indicator_value(indicators, compare_indicator, compare_period, idx)
        if compare_val is None:
            return False

        if operator == "crosses_above":
            prev_cur = _get_indicator_value(indicators, indicator, period, prev_idx)
            prev_cmp = _get_indicator_value(indicators, compare_indicator, compare_period, prev_idx)
            if prev_cur is None or prev_cmp is None:
                return False
            return prev_cur <= prev_cmp and current_val > compare_val

        if operator == "crosses_below":
            prev_cur = _get_indicator_value(indicators, indicator, period, prev_idx)
            prev_cmp = _get_indicator_value(indicators, compare_indicator, compare_period, prev_idx)
            if prev_cur is None or prev_cmp is None:
                return False
            return prev_cur >= prev_cmp and current_val < compare_val

        ops = {
            ">": current_val > compare_val,
            "<": current_val < compare_val,
            ">=": current_val >= compare_val,
            "<=": current_val <= compare_val,
        }
        return ops.get(operator, False)

    return False


def evaluate_strategy(strategy_logic: dict, candles: list[dict]) -> dict:
    """
    Run a strategy against candle data.
    Returns: {"signal": "BUY"/"SELL"/None, "reason": "...", "indicators": {...}}
    """
    if not candles or len(candles) < 30:
        return {"signal": None, "reason": "Not enough candle data (min 30)"}

    indicators = calculate_all_indicators(candles)
    conditions = strategy_logic.get("conditions", [])
    action = strategy_logic.get("action", "BUY")

    idx = len(candles) - 1
    prev_idx = idx - 1

    if not conditions:
        return {"signal": None, "reason": "No conditions defined"}

    all_met = all(_check_condition(c, indicators, idx, prev_idx) for c in conditions)

    # Build latest indicator snapshot for UI
    latest = {
        "RSI": indicators.get("RSI_14", [None])[-1],
        "EMA_9": indicators.get("EMA_9", [None])[-1],
        "EMA_20": indicators.get("EMA_20", [None])[-1],
        "EMA_50": indicators.get("EMA_50", [None])[-1],
        "MACD": indicators.get("MACD", {}).get("macd", [None])[-1],
        "MACD_signal": indicators.get("MACD", {}).get("signal", [None])[-1],
        "BB_upper": indicators.get("BB_20", {}).get("upper", [None])[-1],
        "BB_lower": indicators.get("BB_20", {}).get("lower", [None])[-1],
    }

    return {
        "signal": action if all_met else None,
        "conditions_met": all_met,
        "reason": f"All {len(conditions)} condition(s) met" if all_met else "Conditions not met",
        "latest_indicators": latest,
    }


# ── Strategy CRUD ──────────────────────────────────────────────────────

def save_strategy(user_id: int, name: str, symbol: str, exchange: str,
                  timeframe: str, logic: dict) -> dict:
    """Create or update a strategy."""
    logic_json = json.dumps(logic)
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO strategies
               (user_id, strategy_name, symbol, exchange, timeframe, strategy_logic, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, name, symbol.upper(), exchange.upper(), timeframe, logic_json,
             datetime.utcnow().isoformat()),
        )
        conn.commit()
        strategy_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        return {"success": True, "strategy_id": strategy_id}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()


def update_strategy(user_id: int, strategy_id: int, name: str, symbol: str,
                    exchange: str, timeframe: str, logic: dict) -> dict:
    logic_json = json.dumps(logic)
    conn = get_db()
    try:
        conn.execute(
            """UPDATE strategies SET strategy_name=?, symbol=?, exchange=?,
               timeframe=?, strategy_logic=?, updated_at=?
               WHERE id=? AND user_id=?""",
            (name, symbol.upper(), exchange.upper(), timeframe, logic_json,
             datetime.utcnow().isoformat(), strategy_id, user_id),
        )
        conn.commit()
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()


def get_strategies(user_id: int) -> list:
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM strategies WHERE user_id=? ORDER BY created_at DESC", (user_id,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["strategy_logic"] = json.loads(d["strategy_logic"])
        result.append(d)
    return result


def get_strategy(user_id: int, strategy_id: int) -> dict | None:
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM strategies WHERE id=? AND user_id=?", (strategy_id, user_id)
    ).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["strategy_logic"] = json.loads(d["strategy_logic"])
    return d


def toggle_strategy(user_id: int, strategy_id: int) -> dict:
    conn = get_db()
    row = conn.execute(
        "SELECT active_status FROM strategies WHERE id=? AND user_id=?", (strategy_id, user_id)
    ).fetchone()
    if not row:
        conn.close()
        return {"error": "Strategy not found"}
    new_status = 0 if row["active_status"] else 1
    conn.execute(
        "UPDATE strategies SET active_status=? WHERE id=? AND user_id=?",
        (new_status, strategy_id, user_id),
    )
    conn.commit()
    conn.close()
    return {"success": True, "active": bool(new_status)}


def delete_strategy(user_id: int, strategy_id: int) -> dict:
    conn = get_db()
    conn.execute("DELETE FROM strategies WHERE id=? AND user_id=?", (strategy_id, user_id))
    conn.commit()
    conn.close()
    return {"success": True}

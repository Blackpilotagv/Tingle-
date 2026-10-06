"""
Strategy Engine - evaluates strategy conditions against live indicator values
and generates BUY/SELL/HOLD signals.
"""

import json
from backend.strategy.indicators import ema, rsi, macd, sma, bollinger_bands

INDICATOR_FN = {
    "EMA20":  lambda c: ema(c, 20),
    "EMA50":  lambda c: ema(c, 50),
    "EMA9":   lambda c: ema(c, 9),
    "SMA20":  lambda c: sma(c, 20),
    "RSI14":  lambda c: rsi(c, 14),
    "MACD":   lambda c: macd(c)["macd"],
    "MACD_SIGNAL": lambda c: macd(c)["signal"],
    "BB_UPPER": lambda c: bollinger_bands(c)["upper"],
    "BB_LOWER": lambda c: bollinger_bands(c)["lower"],
}

OPERATORS = {
    ">":       lambda a, b: a > b,
    "<":       lambda a, b: a < b,
    ">=":      lambda a, b: a >= b,
    "<=":      lambda a, b: a <= b,
    "==":      lambda a, b: a == b,
    "crosses_above": lambda series, ref: (
        len(series) >= 2 and series[-2] < ref and series[-1] > ref
    ),
    "crosses_below": lambda series, ref: (
        len(series) >= 2 and series[-2] > ref and series[-1] < ref
    ),
}


def evaluate_condition(condition: dict, candles: list) -> bool:
    """
    condition = {
        "indicator": "RSI14",
        "operator":  "<",
        "value":     30        # can be a number OR another indicator name
    }
    """
    ind_name = condition.get("indicator")
    operator = condition.get("operator")
    raw_val  = condition.get("value")

    if ind_name not in INDICATOR_FN:
        return False

    ind_series = INDICATOR_FN[ind_name](candles)
    last_val   = next((v for v in reversed(ind_series) if v is not None), None)
    if last_val is None:
        return False

    # Value can be a number or another indicator name
    if isinstance(raw_val, str) and raw_val in INDICATOR_FN:
        ref_series = INDICATOR_FN[raw_val](candles)
        ref_val    = next((v for v in reversed(ref_series) if v is not None), None)
        if ref_val is None:
            return False
    else:
        try:
            ref_val = float(raw_val)
        except (TypeError, ValueError):
            return False

    op_fn = OPERATORS.get(operator)
    if not op_fn:
        return False

    if operator in ("crosses_above", "crosses_below"):
        non_none = [v for v in ind_series if v is not None]
        return op_fn(non_none, ref_val)

    return op_fn(last_val, ref_val)


def evaluate_strategy(strategy_logic: dict, candles: list) -> str:
    """
    Returns 'BUY', 'SELL', or 'HOLD'.
    strategy_logic = {
        "conditions": [...],
        "action": "BUY",
        "stoploss": 2,
        "target": 5
    }
    """
    if not candles or len(candles) < 30:
        return "HOLD"

    conditions = strategy_logic.get("conditions", [])
    action     = strategy_logic.get("action", "BUY")

    all_met = all(evaluate_condition(cond, candles) for cond in conditions)
    return action if all_met else "HOLD"

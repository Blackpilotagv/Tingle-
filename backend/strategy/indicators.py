"""
Indicator Engine - pure Python calculations on OHLC candle lists.
Each function accepts a list of candle dicts and returns a list of values
(same length, with None for warm-up periods).
"""

import math


def _closes(candles):
    return [c["close"] for c in candles]


def sma(candles, period=20):
    closes = _closes(candles)
    result = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        result[i] = round(sum(closes[i - period + 1: i + 1]) / period, 4)
    return result


def ema(candles, period=20):
    closes = _closes(candles)
    result = [None] * len(closes)
    if len(closes) < period:
        return result
    k = 2 / (period + 1)
    result[period - 1] = sum(closes[:period]) / period
    for i in range(period, len(closes)):
        result[i] = round(closes[i] * k + result[i - 1] * (1 - k), 4)
    return result


def rsi(candles, period=14):
    closes = _closes(candles)
    result = [None] * len(closes)
    if len(closes) <= period:
        return result

    gains = [max(closes[i] - closes[i - 1], 0) for i in range(1, len(closes))]
    losses = [max(closes[i - 1] - closes[i], 0) for i in range(1, len(closes))]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(closes)):
        idx = i - 1  # offset in gains/losses arrays
        avg_gain = (avg_gain * (period - 1) + gains[idx]) / period
        avg_loss = (avg_loss * (period - 1) + losses[idx]) / period
        if avg_loss == 0:
            result[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[i] = round(100 - 100 / (1 + rs), 4)

    return result


def macd(candles, fast=12, slow=26, signal=9):
    """Returns dict of {macd, signal, histogram} lists."""
    ema_fast = ema(candles, fast)
    ema_slow = ema(candles, slow)

    macd_line = [None] * len(candles)
    for i in range(len(candles)):
        if ema_fast[i] is not None and ema_slow[i] is not None:
            macd_line[i] = round(ema_fast[i] - ema_slow[i], 4)

    # Signal = EMA of macd_line
    signal_line = [None] * len(candles)
    macd_vals = [(v, i) for i, v in enumerate(macd_line) if v is not None]
    if len(macd_vals) >= signal:
        k = 2 / (signal + 1)
        start_i = macd_vals[signal - 1][1]
        signal_line[start_i] = sum(v for v, _ in macd_vals[:signal]) / signal
        for j in range(signal, len(macd_vals)):
            cur_i = macd_vals[j][1]
            prev_i = macd_vals[j - 1][1]
            signal_line[cur_i] = round(macd_line[cur_i] * k + signal_line[prev_i] * (1 - k), 4)

    histogram = [
        round(macd_line[i] - signal_line[i], 4)
        if macd_line[i] is not None and signal_line[i] is not None else None
        for i in range(len(candles))
    ]

    return {"macd": macd_line, "signal": signal_line, "histogram": histogram}


def bollinger_bands(candles, period=20, std_dev=2):
    """Returns dict of {upper, middle, lower} lists."""
    closes = _closes(candles)
    middle = sma(candles, period)
    upper  = [None] * len(closes)
    lower  = [None] * len(closes)

    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1: i + 1]
        mean = middle[i]
        variance = sum((x - mean) ** 2 for x in window) / period
        sd = math.sqrt(variance)
        upper[i] = round(mean + std_dev * sd, 4)
        lower[i] = round(mean - std_dev * sd, 4)

    return {"upper": upper, "middle": middle, "lower": lower}


def calculate_all(candles):
    """Returns all indicators for the frontend chart."""
    return {
        "ema20":  ema(candles, 20),
        "ema50":  ema(candles, 50),
        "sma20":  sma(candles, 20),
        "rsi14":  rsi(candles, 14),
        "macd":   macd(candles),
        "bb":     bollinger_bands(candles, 20),
    }

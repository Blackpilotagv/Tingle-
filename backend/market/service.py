"""
Market Data Service
- Symbol search via Angel One searchScrip API (live, no hardcoded tokens)
- Token resolution with in-memory cache + DB persistence
- LTP, OHLC quote, historical candles
"""

from backend.broker.angel_client import get_broker_session
from backend.database import get_db
from datetime import datetime, timedelta

# ── In-memory token cache: { "NSE:RELIANCE": {"token":"2885","exchange":"NSE",...} }
_token_cache = {}


def search_scrip(user_id: int, query: str, exchange: str = "NSE"):
    """
    Live search via Angel One searchScrip API.
    Returns list of {tradingsymbol, symboltoken, exchange, name} dicts.
    """
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    try:
        resp = smart.searchScrip(exchange, query.strip().upper())
        if resp.get("status") and resp.get("data"):
            results = []
            for item in resp["data"]:
                sym   = item.get("tradingsymbol", "")
                token = item.get("symboltoken", "")
                exch  = item.get("exchange", exchange)
                # Cache the token so subsequent data calls work instantly
                _token_cache[f"{exch}:{sym}"] = {"token": token, "exchange": exch}
                results.append({
                    "tradingsymbol": sym,
                    "symboltoken":   token,
                    "exchange":      exch,
                    "name":          item.get("name", sym),
                })
            return results, None
        elif resp.get("status"):
            return [], None          # valid response, zero results
        return None, resp.get("message", "Search failed")
    except Exception as e:
        return None, str(e)


def resolve_token(user_id: int, symbol: str, exchange: str = "NSE"):
    """
    Resolves symbol → instrument token.
    Priority: in-memory cache → DB watchlist → live searchScrip call.
    Supports -EQ / -BE suffix matching (e.g. RELIANCE → RELIANCE-EQ).
    Returns (token, exchange, error).
    """
    sym_upper = symbol.upper()
    key = f"{exchange}:{sym_upper}"

    # 1. In-memory cache
    if key in _token_cache:
        cached = _token_cache[key]
        return cached["token"], cached["exchange"], None

    # 2. DB watchlist
    db = get_db()
    row = db.execute(
        """SELECT token, exchange FROM watchlist 
           WHERE (symbol=? OR symbol=?) AND exchange=? AND token IS NOT NULL AND token != ''""",
        (sym_upper, f"{sym_upper}-EQ", exchange)
    ).fetchone()
    db.close()
    if row and row["token"]:
        _token_cache[key] = {"token": row["token"], "exchange": row["exchange"]}
        return row["token"], row["exchange"], None

    # 3. Live search
    results, err = search_scrip(user_id, symbol, exchange)
    if err:
        return None, exchange, err
    if not results:
        return None, exchange, f"Instrument not found: {symbol} on {exchange}"

    eq_sym = f"{sym_upper}-EQ"
    be_sym = f"{sym_upper}-BE"

    matched = None
    for item in results:
        tsym = item.get("tradingsymbol", "")
        if tsym == sym_upper or tsym == eq_sym:
            matched = item
            break
        elif tsym == be_sym and not matched:
            matched = item

    if not matched:
        for item in results:
            if item.get("tradingsymbol", "").startswith(sym_upper):
                matched = item
                break

    if not matched:
        matched = results[0]

    token = matched["symboltoken"]
    exch  = matched.get("exchange", exchange)

    _token_cache[key] = {"token": token, "exchange": exch}
    _token_cache[f"{exch}:{matched.get('tradingsymbol')}"] = {"token": token, "exchange": exch}
    return token, exch, None


# ── Timeframe mapping & lookback days ─────────────────────────────────────────
TIMEFRAME_MAP = {
    "1m":  ("ONE_MINUTE",      30),   # Up to 30 days of 1-minute candles
    "5m":  ("FIVE_MINUTE",     60),   # Up to 60 days of 5-minute candles
    "15m": ("FIFTEEN_MINUTE",  90),   # Up to 90 days of 15-minute candles
    "1h":  ("ONE_HOUR",        365),  # Up to 1 year of 1-hour candles
    "1d":  ("ONE_DAY",         730),  # Up to 2 years of daily candles
}


def get_ltp(user_id: int, symbol: str, exchange: str = "NSE"):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"

    token, exch, err = resolve_token(user_id, symbol, exchange)
    if err:
        return None, err
    try:
        resp = smart.ltpData(exch, symbol.upper(), token)
        if resp.get("status"):
            d = resp["data"]
            return {
                "ltp":    float(d.get("ltp", 0)),
                "close":  float(d.get("close", 0)),
                "open":   float(d.get("open", 0)),
                "high":   float(d.get("high", 0)),
                "low":    float(d.get("low", 0)),
                "symbol": symbol.upper(),
            }, None
        return None, resp.get("message", "LTP fetch failed")
    except Exception as e:
        return None, str(e)


def get_quote(user_id: int, symbol: str, exchange: str = "NSE"):
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"
    token, exch, err = resolve_token(user_id, symbol, exchange)
    if err:
        return None, err
    try:
        resp = smart.getMarketData("FULL", exch, token)
        if resp.get("status"):
            return resp.get("data", {}), None
        return None, resp.get("message", "Quote fetch failed")
    except Exception as e:
        return None, str(e)


def get_candles(user_id: int, symbol: str, timeframe: str = "5m", exchange: str = "NSE"):
    """
    Fetch historical OHLC candles. Falls back to DB cache on API error.
    Returns list of {time, open, high, low, close, volume} sorted by timestamp ASC.
    """
    smart, _ = get_broker_session(user_id)
    if not smart:
        return None, "Broker not connected"

    token, exch, err = resolve_token(user_id, symbol, exchange)
    if err:
        return None, err

    api_tf, lookback_days = TIMEFRAME_MAP.get(timeframe, ("FIVE_MINUTE", 60))

    now = datetime.now()
    from_dt   = now - timedelta(days=lookback_days)
    from_date = from_dt.strftime("%Y-%m-%d %H:%M")
    to_date   = now.strftime("%Y-%m-%d %H:%M")

    try:
        resp = smart.getCandleData({
            "exchange":    exch,
            "symboltoken": token,
            "interval":    api_tf,
            "fromdate":    from_date,
            "todate":      to_date,
        })
        if not resp.get("status"):
            raise Exception(resp.get("message", "Candle API failed"))

        candle_map = {}
        for row in (resp.get("data") or []):
            try:
                ts = row[0]
                # Angel returns ISO with offset like "2024-01-01T09:15:00+05:30"
                if not ("+" in ts or "-" in ts[10:] or ts.endswith("Z")):
                    ts += "+05:30"
                dt = datetime.fromisoformat(ts)
                t = int(dt.timestamp())
                candle_map[t] = {
                    "time":   t,
                    "open":   float(row[1]),
                    "high":   float(row[2]),
                    "low":    float(row[3]),
                    "close":  float(row[4]),
                    "volume": int(row[5]) if len(row) > 5 else 0,
                }
            except Exception:
                continue

        # Sort strictly ascending: past candles on left, newest live candle on right
        sorted_candles = [candle_map[t] for t in sorted(candle_map.keys())]

        if sorted_candles:
            _cache_candles(symbol, exch, timeframe, sorted_candles)
        return sorted_candles, None

    except Exception as e:
        cached = _load_cached_candles(symbol, exchange, timeframe)
        if cached:
            return cached, f"Using cached data ({e})"
        return None, str(e)


def _cache_candles(symbol, exchange, timeframe, candles):
    db = get_db()
    for c in candles:
        ts = datetime.fromtimestamp(c["time"]).isoformat()
        db.execute(
            """INSERT OR REPLACE INTO candle_cache
               (symbol, exchange, timeframe, timestamp, open, high, low, close, volume)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (symbol, exchange, timeframe, ts,
             c["open"], c["high"], c["low"], c["close"], c["volume"])
        )
    db.commit()
    db.close()


def _load_cached_candles(symbol, exchange, timeframe):
    db = get_db()
    rows = db.execute(
        """SELECT * FROM candle_cache
           WHERE symbol=? AND exchange=? AND timeframe=?
           ORDER BY timestamp ASC LIMIT 10000""",
        (symbol, exchange, timeframe)
    ).fetchall()
    db.close()
    if not rows:
        return None
    return [{
        "time":   int(datetime.fromisoformat(r["timestamp"]).timestamp()),
        "open":   r["open"], "high": r["high"],
        "low":    r["low"],  "close": r["close"], "volume": r["volume"],
    } for r in rows]


def get_watchlist_with_ltp(user_id: int):
    db = get_db()
    rows = db.execute(
        "SELECT symbol, exchange FROM watchlist WHERE user_id=?", (user_id,)
    ).fetchall()
    db.close()
    result = []
    for row in rows:
        sym = row["symbol"]
        ltp_data, err = get_ltp(user_id, sym, row["exchange"])
        if ltp_data:
            ltp   = ltp_data.get("ltp", 0)
            close = ltp_data.get("close", ltp) or ltp
            chg   = round((ltp - close) / close * 100, 2) if close else 0
            result.append({"symbol": sym, "exchange": row["exchange"], "ltp": ltp, "change": chg})
        else:
            result.append({"symbol": sym, "exchange": row["exchange"], "ltp": 0, "change": 0, "error": err})
    return result

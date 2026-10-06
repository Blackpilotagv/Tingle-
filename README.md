# Tingle Trade – MT5-Style Trading Terminal

## Setup

```bash
pip install -r requirements.txt
python app.py
```
Open http://localhost:5000

## Architecture

```
trading_platform/
├── app.py                        # Flask app factory + SocketIO
├── requirements.txt
├── instance/
│   └── trading_platform.db       # SQLite (auto-created)
├── backend/
│   ├── database.py               # init_db(), get_db()
│   ├── auth/routes.py            # login, register, logout, password reset
│   ├── broker/
│   │   ├── angel_client.py       # SmartAPI wrapper (connect, session, profile)
│   │   └── routes.py             # /broker/connect|disconnect|status|profile
│   ├── market/
│   │   ├── service.py            # LTP, OHLC, candles, watchlist LTP
│   │   └── routes.py             # /market/ltp|quote|candles|watchlist/*
│   ├── strategy/
│   │   ├── indicators.py         # EMA, SMA, RSI, MACD, Bollinger Bands
│   │   ├── engine.py             # Condition evaluator → BUY/SELL/HOLD
│   │   └── routes.py             # /strategy/list|save|delete|signal|indicators
│   ├── execution/
│   │   ├── service.py            # place/modify/cancel orders, positions, holdings
│   │   └── routes.py             # /execution/place|modify|cancel|orders|positions
│   └── risk/routes.py            # /risk/calculate
└── frontend/
    ├── templates/
    │   ├── login.html            # Auth page (login/register/forgot)
    │   └── terminal.html         # Main trading terminal
    └── static/
        ├── css/auth.css
        ├── css/terminal.css
        └── js/terminal.js
```

## Angel One Setup
1. Log in → My Profile → API → Generate API key
2. Enable TOTP authenticator, copy the secret key
3. In the terminal: ⚙️ → Enter API key, Client ID, password, TOTP secret → Connect

## Strategy Builder Example
```json
{
  "conditions": [
    { "indicator": "RSI14", "operator": "<", "value": 30 },
    { "indicator": "EMA20", "operator": "crosses_above", "value": "EMA50" }
  ],
  "action": "BUY",
  "stoploss": 2,
  "target": 5
}
```

## Development Phases
- ✅ Phase 1: Broker auth, market data, chart
- ✅ Phase 2: Order execution, positions, order history
- ✅ Phase 3: Indicator engine, strategy builder
- 🔲 Phase 4: Automated strategy execution, auto SL/target exits

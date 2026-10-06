"""
Trading Platform - Main Application Entry Point
FIX: Uncommented all blueprints that were accidentally commented out.
"""

from flask import Flask, redirect, url_for
from flask_socketio import SocketIO
from backend.auth.routes import auth_bp
from backend.broker.routes import broker_bp
from backend.market.routes import market_bp
from backend.strategy.routes import strategy_bp
from backend.execution.routes import execution_bp
from backend.risk.routes import risk_bp
from backend.database import init_db
import os

socketio = SocketIO()


def root():
    return redirect(url_for("auth.login_page"))


def create_app():
    app = Flask(
        __name__,
        template_folder="frontend/templates",
        static_folder="frontend/static"
    )

    app.secret_key = os.environ.get("SECRET_KEY", "tingle_trading_secret_2024")
    app.config["ENCRYPTION_KEY"] = os.environ.get("ENCRYPTION_KEY", "tingle_enc_key_32bytes!!")

    # Register blueprints — ALL of them
    app.register_blueprint(auth_bp)
    app.register_blueprint(broker_bp,    url_prefix="/broker")
    app.register_blueprint(market_bp,    url_prefix="/market")
    app.register_blueprint(strategy_bp,  url_prefix="/strategy")
    app.register_blueprint(execution_bp, url_prefix="/execution")
    app.register_blueprint(risk_bp,      url_prefix="/risk")

    socketio.init_app(app, cors_allowed_origins="*")
    app.add_url_rule("/", view_func=root)

    with app.app_context():
        init_db()

    return app


if __name__ == "__main__":
    app = create_app()
    socketio.run(app, debug=True, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)

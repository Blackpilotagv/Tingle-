"""
Auth Blueprint - Handles login, register, logout, password reset.
Preserved from original app.py with session-based auth.
"""

from flask import Blueprint, render_template, request, redirect, url_for, flash, session, jsonify
from backend.database import get_db
from datetime import datetime, timedelta
import smtplib, ssl, random, string
from email.mime.text import MIMEText

auth_bp = Blueprint("auth", __name__)

# ── Helpers ──────────────────────────────────────────────────────────────────

def send_email(to_email, subject, body):
    sender_email = "tingletrade@gmail.com"
    sender_password = "jahobigzmiewnbff"
    msg = MIMEText(body, "plain")
    msg["Subject"] = subject
    msg["From"] = sender_email
    msg["To"] = to_email
    ctx = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587) as s:
        s.starttls(context=ctx)
        s.login(sender_email, sender_password)
        s.sendmail(sender_email, to_email, msg.as_string())

# ── Routes ───────────────────────────────────────────────────────────────────

@auth_bp.route("/login")
def login_page():
    if "user_id" in session:
        return redirect(url_for("auth.terminal"))
    return render_template("login.html")


@auth_bp.route("/login", methods=["POST"])
def login():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    db = get_db()
    user = db.execute(
        "SELECT * FROM users WHERE username=? AND password=?", (username, password)
    ).fetchone()
    db.close()
    if user:
        session["user_id"] = user["id"]
        session["username"] = user["username"]
        return redirect(url_for("auth.terminal"))
    flash("Invalid username or password", "danger")
    return redirect(url_for("auth.login_page"))


@auth_bp.route("/register", methods=["POST"])
def register():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm  = request.form.get("confirm", "")
    email    = request.form.get("email", "").strip()
    phone    = request.form.get("phone", "").strip()

    if password != confirm:
        flash("Passwords do not match", "danger")
        return redirect(url_for("auth.login_page"))

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (username, password, email, phone) VALUES (?,?,?,?)",
            (username, password, email, phone)
        )
        db.commit()
        flash("Registration successful! Please login.", "success")
    except Exception:
        flash("Username already exists!", "danger")
    finally:
        db.close()
    return redirect(url_for("auth.login_page"))


@auth_bp.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.", "info")
    return redirect(url_for("auth.login_page"))


@auth_bp.route("/forgot_password", methods=["POST"])
def forgot_password():
    email = request.form.get("email", "").strip()
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not user:
        db.close()
        flash("No account with this email.", "danger")
        return redirect(url_for("auth.login_page"))

    otp = "".join(random.choices(string.digits, k=6))
    expiry = (datetime.utcnow() + timedelta(minutes=5)).isoformat()
    db.execute("UPDATE users SET otp=?, otp_expiry=? WHERE email=?", (otp, expiry, email))
    db.commit()
    db.close()
    session["reset_email"] = email
    try:
        send_email(email, "Your Tingle OTP", f"Your OTP is {otp}. Expires in 5 minutes.")
    except Exception:
        pass
    flash("OTP sent to your email.", "info")
    return redirect(url_for("auth.login_page"))


@auth_bp.route("/reset_password", methods=["POST"])
def reset_password():
    email = session.get("reset_email")
    otp   = request.form.get("otp", "")
    new_pw = request.form.get("new_password", "")
    if not email:
        flash("Session expired. Request OTP again.", "danger")
        return redirect(url_for("auth.login_page"))

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not user or user["otp"] != otp:
        db.close()
        flash("Invalid OTP.", "danger")
        return redirect(url_for("auth.login_page"))
    if datetime.utcnow() > datetime.fromisoformat(user["otp_expiry"]):
        db.close()
        flash("OTP expired.", "danger")
        return redirect(url_for("auth.login_page"))

    db.execute("UPDATE users SET password=?, otp=NULL, otp_expiry=NULL WHERE email=?", (new_pw, email))
    db.commit()
    db.close()
    session.pop("reset_email", None)
    flash("Password reset successful!", "success")
    return redirect(url_for("auth.login_page"))


# ── Main Terminal ─────────────────────────────────────────────────────────────

@auth_bp.route("/terminal")
def terminal():
    if "user_id" not in session:
        return redirect(url_for("auth.login_page"))
    return render_template("terminal.html", username=session["username"])


@auth_bp.route("/api/me")
def me():
    if "user_id" not in session:
        return jsonify({"error": "Not logged in"}), 401
    return jsonify({"user_id": session["user_id"], "username": session["username"]})

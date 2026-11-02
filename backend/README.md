# Connect The Dots backend — free local development

The backend uses FastAPI and a local SQLite database. It generates and verifies OTPs itself; it does not call a paid OTP provider.

## 1. Install (Windows PowerShell)
Open a terminal in this `backend` folder:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 2. Configure free Gmail email delivery
Gmail SMTP is a no-cost option for eligible personal use, subject to Google's sending limits and policies. It is not unlimited and Google controls delivery. No paid OTP API is required.

1. Use a Gmail account you control.
2. Enable 2-Step Verification.
3. Create a Google App Password from your Google Account security settings (if the account is eligible).
4. Set the following variables in the same PowerShell terminal. Replace the example values locally; never share the App Password or commit it to GitHub.

```powershell
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_PORT = "587"
$env:SMTP_USERNAME = "youraddress@gmail.com"
$env:SMTP_PASSWORD = "your-16-character-app-password"
$env:SMTP_FROM_EMAIL = "youraddress@gmail.com"
$env:SMTP_FROM_NAME = "Connect The Dots"
$env:CTD_SECRET_KEY = "replace-with-a-long-unique-random-secret"
```

Do not use your normal Gmail password. The `.env.example` file is only a reference; this project does not load `.env` files automatically. The PowerShell commands above set the variables for the current terminal session.

## 3. Start the API
```powershell
python -m uvicorn main:app --reload
```

Open http://127.0.0.1:8000/docs for API documentation. In a separate terminal, open the project root `index.html` with VS Code Live Server.

## OTP flow and safeguards
- FastAPI creates a cryptographically random six-digit code using Python's `secrets` module.
- The database stores a hash of the code, not the plaintext code.
- SMTP only delivers the code by email; it does not generate the code.
- Codes expire after 10 minutes.
- Resending has a 60-second cooldown.
- Verification allows up to 5 incorrect attempts for a code.
- Only verified accounts can sign in.
- Existing accounts from the previous database version remain verified.

## Keep the project at ₹0
- No paid OTP API or email API is integrated.
- No paid database is required; SQLite runs locally.
- No paid hosting is required for local development.
- AI/LLM calls are not included in this version.

## Important limitations
Gmail may impose sending limits or reject messages. A free service is not a promise of unlimited email delivery. If SMTP is not configured, registration cannot send verification email and will return an error; configure SMTP before testing signup end-to-end.

This setup is for development, not production deployment. Before exposing the app publicly, harden CORS, secrets, rate limiting, HTTPS, logging, token storage, and other security controls. Never commit SMTP credentials, database files containing user data, or real secrets.

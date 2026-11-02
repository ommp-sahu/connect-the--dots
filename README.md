# Connect The Dots — ₹0 development setup

This project can be developed locally without paying for hosting, an OTP provider, a database service, or an AI API.

## What's included
- `index.html` — landing page
- `signup.html` / `signin.html` — email/password authentication UI
- `workspace.html` / `workspace.js` — exploration workspace
- `backend/` — FastAPI authentication and SQLite API

## Run the frontend
1. Open this project folder in VS Code.
2. Open `index.html` with the Live Server extension.
3. Keep the frontend and backend running in separate terminals.

## Run the backend (Windows PowerShell)
```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Configure free Gmail SMTP for email verification by following `backend/README.md`. Then start the API:
```powershell
python -m uvicorn main:app --reload
```
API docs: http://127.0.0.1:8000/docs

## Cost and limits
- OTP generation and verification run in your own FastAPI code: no OTP vendor/API is used.
- SQLite stores application data locally: no hosted database is required for development.
- Gmail SMTP can deliver verification emails at no charge for eligible personal use, subject to Google's sending limits and policies. It is not unlimited or guaranteed delivery.
- Local development runs on your computer. Public hosting may have free tiers, but providers can impose limits or change their plans; no hosting account is needed to develop or test locally.
- AI/LLM integration is not included in this version, so there are no model API charges.

## Important
Keep SMTP credentials and `CTD_SECRET_KEY` private. Never commit them to GitHub or paste them into chats. Use a unique, long secret for `CTD_SECRET_KEY`. The local development configuration is not production-hardened.

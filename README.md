# CCA Campaign Manager 🚀

A powerful, self-hosted email campaign management system designed for **Brevo (formerly Sendinblue)**.  
Built with **FastAPI**, **SQLModel**, and a modern **Tailwind CSS** dashboard.

![CCA Campaign Manager Badge](https://img.shields.io/badge/CCA-Campaign%20Manager-blueviolet?style=for-the-badge)
![FastAPI Badge](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Tailwind Badge](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css)

## ✨ Features

- **📊 Premium Dashboard**: A beautiful, Vercel-style dark mode dashboard with real-time analytics.
- **📧 Smart Scheduling**: Intelligent scheduler that respects your defined **Hourly** and **Daily** rate limits to protect your sender reputation.
- **📇 CRM-Lite**:
  - Upload Contacts via Excel (`.xlsx`) or CSV.
  - **Auto-Cleanup**: Handles missing names case-insensitively and provides defaults.
  - **Full CRUD**: View, Search, Edit, and Delete contacts directly from the UI.
- **🎨 Template Personalization**: Supports **Jinja2** templating (e.g., `Hey {{ name }}!`) for dynamic content.
- **🔐 Secure Authentication**: Multi-user support with JWT-based Login/Signup and data isolation.
- **📈 Real-time Analytics**: Track Pending, Sent, and Failed emails live.

## 🛠️ Tech Stack

- **Backend**: Python 3.9+ (FastAPI)
- **Database**: SQLite (via SQLModel/SQLAlchemy)
- **Frontend**: Server-Side Rendered HTML + Tailwind CSS (CDN) + Vanilla JS
- **Scheduler**: Asyncio-based background worker

## 🚀 Getting Started

### Prerequisites

- Python 3.9 or higher
- A [Brevo](https://www.brevo.com/) API Key

### Installation

1.  **Clone the repository**

    ```bash
    git clone https://github.com/codezelat/cca-mail-sender.git
    cd cca-mail-sender
    ```

2.  **Create a virtual environment**

    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    ```

3.  **Install dependencies**

    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the application**
    ```bash
    uvicorn app.main:app --reload
    ```
    The server will start at `http://127.0.0.1:8000`.

## 📖 Usage Guide

1.  **Sign Up**: Create a new account at `/signup`.
2.  **Configuration**:
    - Go to **Dashboard**.
    - Enter your **Brevo API Key**.
    - Set your **Sender Details** and **Limits** (e.g., 20 emails/hour).
    - Click **Save Settings**.
3.  **Import Contacts**:
    - Prepare an Excel/CSV file with columns: `Email`, `Name`.
    - Click **Import Contacts** (Top Right).
4.  **Templates**:
    - Place your HTML template in `data/templates/mail.html`.
    - Use `{{ name }}` in your HTML to insert the contact's name automatically.
5.  **Start Campaign**:
    - The scheduler runs automatically in the background.
    - As soon as contacts are uploaded, it will start queuing them based on your rate limits.

## 📂 Project Structure

```
cca-mail-sender/
├── app/
│   ├── main.py              # Application entry point
│   ├── auth.py              # Authentication logic (JWT)
│   ├── database.py          # DB connection & initialization
│   ├── models.py            # SQLModel Database Tables
│   ├── routers/             # API & Page Routes
│   │   ├── api.py           # Backend Logic (Upload, Stats, CRUD)
│   │   └── pages.py         # Frontend Route Rendering
│   ├── services/
│   │   ├── brevo_service.py # Brevo API Wrapper
│   │   └── scheduler_service.py # Background Rate Limiter
│   └── templates/           # HTML Files (Dashboard, Login, etc.)
├── data/
│   ├── campaign.db          # SQLite Database (Auto-created)
│   └── templates/           # User Email Templates
├── requirements.txt         # Python Dependencies
└── README.md                # Documentation
```

## 🔒 Security

- **Password Hashing**: Passwords are hashed using `bcrypt` before storage.
- **JWT Tokens**: API endpoints are protected using OAuth2 with Password Flow.
- **Data Isolation**: Users can only access their own contacts and settings.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

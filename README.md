
# 📸 B-Snap

> **An all-in-one learning workspace connecting class materials, notes, PDFs, blackboard captures, and AI summaries.**

B-Snap is a study assistant application that integrates various learning materials from college classes into a single workspace, providing an efficient review workflow through AI-driven summaries, Q&A, and quiz generation.

Our goal is to seamlessly connect timetables, PDF annotations, blackboard captures, handwritten notes, and AI chat into one unified workspace.

---

## 🔄 Main Flow

```text
1️⃣ Upload learning materials (PDFs, images, blackboard captures, etc.)
        ↓
2️⃣ Take notes and memos in a unified workspace
        ↓
3️⃣ Multimodal AI summaries & RAG-based customized Q&A
        ↓
4️⃣ Generate quizzes & review for exams

```

---

## ✨ Key Features

### 📱 Frontend (Mobile & Web)

* **Unified Workspace**: Timetable view, PDF & blank note canvas provided.
* **Drawing Tools**: Pen, highlighter, eraser, and selection tools (save/load handwriting).
* **Material Management**: Upload captured materials, view note list, and edit note titles.
* **AI Interaction**: AI chat panel, conversation session list, and history display.
* **User Management**: Email/password-based login and token management.

### ⚙️ Backend & AI

* **Server & DB**: FastAPI-based asynchronous API server, PostgreSQL integration, and user-specific data isolation.
* **Multimodal Pipeline**: Image upload, pre-processed image generation, and photo description generation using vision models.
* **RAG System**: Context-aware Q&A based on learning materials (note summaries, PDFs, user memos, etc.).
* **Learning Assistant AI**: Note summaries, exam prep summaries, and automated customized quiz generation.
* **Security**: JWT-based user authentication.

---

## 🛠 Tech Stack

| Category | Technology |
| --- | --- |
| **Frontend** | Expo, React Native, TypeScript |
| **Backend** | FastAPI, Python |
| **Database** | PostgreSQL, pgvector |
| **AI** | LLM API (Select GPT or Gemini), RAG |
| **Mobile** | iOS, Android |
| **DevOps** | npm, Python venv, Docker |

---

## 📂 Project Structure

```text
B-Snap/
├── Document/          # Planning and design documents
├── backend/           # FastAPI backend
├── docs/              # Feature design and development docs
├── frontend/          # Expo React Native app
├── img_preprocessing/ # Image preprocessing module
├── scripts/           # Development/deployment auxiliary scripts
├── tests/             # Test codes
├── Dockerfile
├── cloudbuild.yaml
├── requirements.txt
└── README.md

```

---

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone [https://github.com/flecy0904/B-Snap.git](https://github.com/flecy0904/B-Snap.git)
cd B-Snap

```

### 2. Install Frontend Dependencies

We recommend using `clean-install` to maintain the exact same dependency tree based on `package-lock.json` among team members.

```bash
cd frontend
npm clean-install

```

### 3. Setup Backend Environment Variables

Copy the environment variable file in the project root and fill in the necessary settings (DB address, API Key, etc.).

```bash
# macOS / Linux
cp backend/.env.example backend/.env

# Windows PowerShell
Copy-Item backend/.env.example backend/.env

```

> ⚠️ **Warning**: Never share actual API Keys, DB passwords, or JWT Secrets on GitHub or messengers.

### 4. Setup Frontend Environment Variables


```bash
# macOS / Linux
cp frontend/.env.example frontend/.env

# Windows PowerShell
Copy-Item frontend/.env.example frontend/.env

```

### 5. DB & Backend Environment Setup

1. Create the `bsnap` database in your local PostgreSQL. (`CREATE DATABASE bsnap;`)
2. Create the backend virtual environment and install packages:

```bash
# macOS / Linux
python -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt

# Windows PowerShell
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

```

3. Create DB tables:

```bash
# macOS / Linux
backend/.venv/bin/python -m backend.scripts.init_db

# Windows PowerShell
.\backend\.venv\Scripts\python.exe -m backend.scripts.init_db

```

Note: `cd frontend && npm run backend` also tries to prepare the backend virtual environment and packages when they are missing.

---

## 💻 How to Run

During development, open two terminals for Backend and Frontend respectively.

### Terminal 1: Run Backend

```bash
cd frontend
npm run backend:dev

```

* Default Address: `http://localhost:8000`
* Health Check: `http://localhost:8000/health`

### Terminal 2: Run Frontend

Choose one of the commands below depending on your environment.

```bash
cd frontend

npm run web         # Run on Web
npm run ios         # Run iOS Simulator (macOS only, requires pod install)
npm run ios:ipad    # Run iPad Simulator
npm run android     # Run Android Emulator

```

---

## 🧠 AI / RAG Learning Pipeline

B-Snap's RAG system vectorizes saved learning materials (note summaries, PDF text, user memos) for search, and injects the retrieved context into prompts to improve the accuracy of the AI's response.

To enable semantic vector search, set the embedding model in `backend/.env` and run the script below to generate the index.

```bash
# macOS / Linux
backend/.venv/bin/python -m backend.scripts.backfill_document_chunks

```

For detailed architecture, please refer to `backend/README_RAG.md`.

---

## 🖼️ Image Preprocessing & Capture Analysis

Uploading images (like blackboard captures) follows this flow:

1. Save the original image (`backend/uploads`).
2. Generate and save a pre-processed PNG image (`backend/uploads/processed-images`).
3. For AI photo descriptions and text extraction, use the **pre-processed image** first for better readability (fallback to original if failed).
4. Render the original photo in the App UI to prevent user confusion.


---

## 📄 License

This project is licensed under the **MIT License**.

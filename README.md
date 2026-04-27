# $ROLLAT — Local Setup

The on-chain roulette mockup site. FastAPI + React + MongoDB.

## Prerequisites

1. **Python 3.10–3.12** (3.14 may have issues with some deps — 3.11 recommended)
2. **Node.js 18+** and **Yarn** (`npm install -g yarn`)
3. **MongoDB** running locally
   - Easiest: Docker → `docker run -d -p 27017:27017 --name mongo mongo:7`
   - Or install MongoDB Community Server: https://www.mongodb.com/try/download/community

---

## 1. Backend (FastAPI)

Open a terminal in the `backend/` folder:

```bash
cd backend

# (recommended) create a virtual env
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux

pip install -r requirements.txt

# run the server (binds to 0.0.0.0:8001)
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

You should see:
```
INFO: Uvicorn running on http://0.0.0.0:8001
```

Test it:
```bash
curl http://localhost:8001/api/stats
```

---

## 2. Frontend (React)

Open a **second terminal** in the `frontend/` folder:

```bash
cd frontend

# point the React app at your local backend
# edit frontend/.env and set:
#   REACT_APP_BACKEND_URL=http://localhost:8001

yarn install
yarn start
```

The app will open at http://localhost:3000

---

## Project structure

```
rollat/
├── backend/
│   ├── server.py            # FastAPI app + mock endpoints
│   ├── requirements.txt
│   └── .env                 # MONGO_URL, DB_NAME, CORS_ORIGINS
├── frontend/
│   ├── src/
│   │   ├── pages/           # Landing.jsx, Dashboard.jsx
│   │   ├── components/site/ # Hero, Tokenomics, HallOfFame, etc.
│   │   ├── components/ui/   # shadcn/ui primitives
│   │   └── lib/             # api client, useCountdown
│   ├── public/
│   ├── package.json
│   ├── tailwind.config.js
│   └── .env                 # REACT_APP_BACKEND_URL
└── README.md
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Live pot, countdown, distributed total |
| GET | `/api/winners?limit=20` | Hall of Fame winners |
| GET | `/api/wallet-check/{wallet}` | Mock qualification check |
| GET | `/api/dashboard/{wallet}` | Dashboard payload (status + history) |

All wallet data is **deterministic mock data** generated from a SHA-256 hash of the address — same address always returns the same response.

---

## Common issues

- **`MONGO_URL` connection refused** → MongoDB isn't running. Start it via Docker or service.
- **CORS errors in browser** → Make sure `REACT_APP_BACKEND_URL` in `frontend/.env` matches the actual backend URL.
- **`emergentintegrations` not found** → Already removed from requirements.txt. If you see it again, just delete that line.
- **Port 8001 in use** → Change to another port and update `frontend/.env` accordingly.

---

## What's mocked

This is a presentation-only mockup. The following are NOT real:
- Phantom wallet connect (toast only)
- Chainlink VRF spin (no on-chain calls)
- All winner / pot / qualification data (generated deterministically from wallet hash)
- NFT trophy mints

To go live you'd need to deploy the Solana smart contract + Chainlink VRF subscription and replace the mock backend.

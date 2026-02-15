# CarRent

Full-stack car rental platform:
- Frontend: Vite + React (`client`)
- Backend: Node.js + Express + MongoDB (`backend`)
- Dev mode runs on a single port (`5173`) with Vite middleware integration.

## Quick Start

1. Install dependencies:
```bash
npm --prefix backend install
npm --prefix client install
```

2. Configure environment files:
- `backend/.env`
- `client/.env` (optional for custom client config)

3. Run development server:
```bash
npm run dev
```

4. Open:
- `http://localhost:5173`

## Data + Runbook Folder

Project run instructions, workflow, and Atlas seed exports are inside:
- `docs/README.md`
- `docs/atlas-data/users.json`
- `docs/atlas-data/cars.json`


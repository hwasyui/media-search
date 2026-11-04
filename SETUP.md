# Media Search — Setup Guide

## Requirements

- **Node.js** v22+
- **Python** 3.10+

---

## 1. Clone / Copy the project

Make sure `node_modules/` is excluded. Everything else (including `data/`) can be copied as-is.

---

## 2. Environment file

Create a `.env` file in the project root:

```
GROQ_API_KEY=your_key_here
```

Get a free API key at https://console.groq.com

Optional overrides:
```
GROQ_MODEL=openai/gpt-oss-120b   # default model
PYTHON=python                     # or python3 if needed
PORT=3000                         # default port
```

---

## 3. Install Node dependencies

```bash
npm install
```

---

## 4. Install Python dependencies

```bash
pip install -r listener/requirements.txt
```

Then install the Playwright browser (required for Social Media scraping):

```bash
playwright install chromium
```

> If `playwright` command is not found, try: `python -m playwright install chromium`

---

## 5. Run the app

```bash
npm start
```

Open http://localhost:3000 in your browser.

---

## Data storage

All crawled articles are stored as plain JSON files in `data/articles/YYYY-MM-DD.json`. No database required.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `GROQ_API_KEY belum diisi` | Check `.env` file exists in project root |
| Social media returns 0 results | Run `playwright install chromium` |
| `python` not found | Set `PYTHON=python3` in `.env` |
| Port already in use | Set `PORT=3001` in `.env` |

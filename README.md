<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy AutoYT

This contains everything you need to run your app locally.

## Run Locally

**Prerequisites:** Node.js, Python 3.9+, and [TikTok-Api](https://github.com/davidteather/TikTok-Api) (for TikTok Explorer video listings only; Gemini is used only for movie identification).

1. Install Node dependencies: `npm install`
2. Install Python dependencies: `pip install -r requirements.txt` then `python -m playwright install chromium`
3. Set `GEMINI_API_KEY` in [.env.local](.env.local) (required for **Analyze clip** / movie ID). Optionally set `TIKTOK_MS_TOKEN` from your TikTok browser cookies if listings fail (see TikTok-Api README).
4. Run the app: `npm run dev`

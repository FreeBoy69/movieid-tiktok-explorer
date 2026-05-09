# CLAUDE.md — MovieID Agent

## Project Overview
An AI-powered service that identifies movies from recap videos by analyzing visual frames, audio transcripts, and cross-referencing internet databases.

## Tech Stack
- **AI/LLM:** Google Gemini (via @google/genai)
- **Transcription & Vision:** Integrated Gemini Multi-modal Analysis
- **Frontend:** React + Vite + Tailwind CSS
- **Animations:** Motion (motion/react)
- **Icons:** Lucide React

## Architecture
- `src/services/gemini.ts`: Movie identification only (Gemini multimodal).
- `src/services/tiktok.ts`: Fetches video lists from `POST /api/tiktok/list` (Python [TikTok-Api](https://github.com/davidteather/TikTok-Api); no Gemini).
- `scripts/tiktok_list.py`: TikTok-Api + Playwright session for listing.
- `src/App.tsx`: Main UI following the Claude Editorial Design System.
- `src/types.ts`: Type definitions for AI responses and app state.

## Coding Patterns
- Functional React components with hooks.
- Base64 encoding for client-side video throughput to AI.
- Graceful error handling for missing permissions or API Quotas.

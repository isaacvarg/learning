# Notes

- Mission is a personal challenge; no ham radio plans. Keep lessons free of QSO/Q-code material.
- Learner wants sending from the start, on keyboard or screen tap. Needs a custom `<morse-key>` widget in `assets/` (records `direction: "send"`, `keyed`, `decoded`, `sendWpm`, `timingError`).
- Character speed 20 wpm from lesson 1 (Koch). Introduce Farnsworth spacing only if copy stalls; unit 2 uses 20/15.
- Has 20-30 minutes a day: lessons can carry a longer drill than the 5-minute minimum.
- Quizzes and exams: home defaults (every 5 lessons, 10 questions, 70%) but timed at 10 minutes.
- Drills draw only unlocked items, and a lesson's items unlock when it's marked done. So a lesson can't run a drill over its own new letters: give it inline `<tome-audio>` runs instead, and point to `listen-koch` for later days.
- `assets/morse-key.js` is the sending trainer (`chars`, `rounds`, `wpm`). It records against `item:send-<char>`, so every new Koch character needs a `send-<char>` flashcard item. It was tested in a mock harness at 11-20 wpm keying.
- Audio: `python3 assets/audio/generate.py assets/audio` renders 20 wpm, 600 Hz WAVs. Add new characters to its `CODES` table.

// <morse-key chars="KM" rounds="8" wpm="20"></morse-key>
//
// A sending trainer. Each round asks for one character from `chars`; the learner
// keys it by holding Space (or pressing the pad) and hears a sidetone. When they
// stop keying, the widget decodes what they sent, measures their speed and
// timing, and records an attempt against `item:send-<char>`.
//
// Records: direction "send", keyed (".-" pattern), decoded, sendWpm,
// timingError (mean % deviation from ideal 1:3 ratios at their own speed),
// wpm (the target character speed) and responseTime (prompt to first key-down).
import { tome } from "/widgets/v1/tome.js";

const CODES = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-",
  5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "/": "-..-.", "=": "-...-",
};
const DECODE = Object.fromEntries(Object.entries(CODES).map(([c, p]) => [p, c]));
const SAY = (p) =>
  [...p].map((e, i) => (e === "-" ? "dah" : i === p.length - 1 ? "dit" : "di")).join("-");
const FREQ = 600;

const CSS = `
.tome-mk { display: flex; flex-direction: column; gap: .9rem; padding: 1rem; background: var(--t-surface); color: var(--t-ink); border: 1px solid var(--t-rule); border-radius: var(--t-radius); font-family: var(--t-ui); }
.tome-mk .tome-stage { display: flex; flex-direction: column; align-items: center; gap: .6rem; text-align: center; }
.tome-mk .tome-prompt { margin: 0; font-family: var(--t-display); font-size: 1.4rem; }
.tome-mk .tome-prompt b { font-size: 2.2rem; }
.tome-mk .tome-hint { margin: 0; font-size: .85rem; color: var(--t-muted); min-height: 1.3em; }
.tome-mk .tome-hint kbd { font-family: var(--t-mono); font-size: .75rem; border: 1px solid var(--t-rule); border-radius: 4px; padding: 0 .3rem; }
.tome-mk .tome-mk-pad { width: 100%; min-height: 7rem; border: 2px solid var(--t-ink); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); font: inherit; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.tome-mk .tome-mk-pad[data-down] { background: var(--t-accent); color: var(--t-accent-ink); border-color: var(--t-accent); }
.tome-mk .tome-mk-pad:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.tome-mk .tome-mk-tape { font-family: var(--t-mono); font-size: 1rem; min-height: 1.4em; margin: 0; letter-spacing: .1em; }
.tome-mk .tome-verdict { margin: 0; font-size: .85rem; font-weight: 600; padding: .2rem .7rem; border-radius: 99px; font-variant-numeric: tabular-nums; }
.tome-mk .tome-verdict[data-state="correct"] { color: var(--t-good); background: var(--t-good-bg); }
.tome-mk .tome-verdict[data-state="wrong"] { color: var(--t-bad); background: var(--t-bad-bg); }
.tome-mk .tome-mk-row { display: flex; gap: .5rem; justify-content: center; flex-wrap: wrap; }
.tome-mk button.tome-mk-btn { font: inherit; padding: .5rem .9rem; min-height: 2.5rem; border: 1px solid var(--t-rule); border-radius: var(--t-radius); background: var(--t-bg); color: var(--t-ink); cursor: pointer; }
.tome-mk button.tome-mk-btn.tome-mk-primary { border-color: var(--t-accent); background: var(--t-accent); color: var(--t-accent-ink); }
.tome-mk .tome-mk-score { margin: 0; font-family: var(--t-display); font-size: 1.2rem; }
`;

function injectCss() {
  if (document.getElementById("tome-mk-css")) return;
  const s = document.createElement("style");
  s.id = "tome-mk-css";
  s.textContent = CSS;
  document.head.append(s);
}

let ctx;
function audio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

class MorseKey extends HTMLElement {
  #chars = [];
  #rounds = 8;
  #wpm = 20;
  #round = 0;
  #correct = 0;
  #target = "";
  #state = "idle"; // idle | keying | saving | result | finished
  #marks = []; // [start, end] in ms
  #downAt = null;
  #promptAt = 0;
  #endTimer;
  #osc;
  #gain;
  #last;
  #wired = false;

  connectedCallback() {
    injectCss();
    this.#chars = [...(this.getAttribute("chars") ?? "").toUpperCase()].filter((c) => CODES[c]);
    this.#rounds = Number(this.getAttribute("rounds")) || 8;
    this.#wpm = Number(this.getAttribute("wpm")) || 20;
    this.innerHTML = `
      <div class="tome-mk">
        <div class="tome-stage">
          <p class="tome-prompt"></p>
          <p class="tome-hint"></p>
          <button type="button" class="tome-mk-pad" aria-label="Morse key: hold to send">Hold here, or hold Space</button>
          <p class="tome-mk-tape" aria-live="polite"></p>
          <p class="tome-verdict" hidden></p>
          <div class="tome-mk-row">
            <button type="button" class="tome-mk-btn" data-act="hear">Hear it</button>
            <button type="button" class="tome-mk-btn" data-act="clear">Start over</button>
            <button type="button" class="tome-mk-btn tome-mk-primary" data-act="next" hidden>Next</button>
          </div>
        </div>
      </div>`;
    this.$ = (s) => this.querySelector(s);
    const pad = this.$(".tome-mk-pad");
    pad.addEventListener("pointerdown", (e) => { e.preventDefault(); pad.setPointerCapture?.(e.pointerId); this.#down(); });
    pad.addEventListener("pointerup", () => this.#up());
    pad.addEventListener("pointercancel", () => this.#up());
    pad.addEventListener("contextmenu", (e) => e.preventDefault());
    if (!this.#wired) {
      this.#wired = true;
      this.addEventListener("keydown", (e) => {
        if (e.key === " " || e.code === "Space") { e.preventDefault(); if (!e.repeat) this.#down(); }
        else if (e.key === "Enter" && this.#state === "result") { e.preventDefault(); this.#next(); }
      });
      this.addEventListener("keyup", (e) => {
        if (e.key === " " || e.code === "Space") { e.preventDefault(); this.#up(); }
      });
    }
    this.querySelector('[data-act="hear"]').addEventListener("click", () => this.#play(CODES[this.#target]));
    this.querySelector('[data-act="clear"]').addEventListener("click", () => this.#reset());
    this.querySelector('[data-act="next"]').addEventListener("click", () => this.#next());
    if (!this.#chars.length) {
      this.$(".tome-prompt").textContent = 'morse-key needs chars="…"';
      return;
    }
    this.#next();
  }

  get #dit() { return 1200 / this.#wpm; }

  #pick() {
    let c;
    do c = this.#chars[Math.floor(Math.random() * this.#chars.length)];
    while (this.#chars.length > 1 && c === this.#last);
    this.#last = c;
    return c;
  }

  #next() {
    if (this.#round >= this.#rounds) return this.#finish();
    this.#round++;
    this.#target = this.#pick();
    this.$(".tome-prompt").innerHTML = `Send <b>${this.#target}</b>`;
    this.$(".tome-hint").innerHTML = `Round ${this.#round} of ${this.#rounds} · hold <kbd>Space</kbd> or the pad`;
    this.$('[data-act="next"]').hidden = true;
    this.$('[data-act="clear"]').hidden = false;
    this.$('[data-act="hear"]').hidden = false;
    this.#reset();
    this.$(".tome-mk-pad").focus({ preventScroll: true });
  }

  #reset() {
    if (this.#state === "saving") return;
    clearTimeout(this.#endTimer);
    this.#marks = [];
    this.#downAt = null;
    this.#state = "idle";
    this.#promptAt = performance.now();
    this.$(".tome-mk-tape").textContent = "";
    this.$(".tome-verdict").hidden = true;
  }

  #tone(on) {
    const a = audio();
    if (on) {
      this.#osc = a.createOscillator();
      this.#gain = a.createGain();
      this.#osc.frequency.value = FREQ;
      this.#gain.gain.setValueAtTime(0, a.currentTime);
      this.#gain.gain.linearRampToValueAtTime(0.3, a.currentTime + 0.005);
      this.#osc.connect(this.#gain).connect(a.destination);
      this.#osc.start();
    } else if (this.#osc) {
      const { currentTime: t } = a;
      this.#gain.gain.cancelScheduledValues(t);
      this.#gain.gain.setValueAtTime(this.#gain.gain.value, t);
      this.#gain.gain.linearRampToValueAtTime(0, t + 0.005);
      this.#osc.stop(t + 0.01);
      this.#osc = undefined;
    }
  }

  #play(pattern) {
    if (!pattern) return;
    const a = audio();
    const d = this.#dit / 1000;
    let t = a.currentTime + 0.05;
    for (const e of pattern) {
      const len = e === "-" ? 3 * d : d;
      const o = a.createOscillator();
      const g = a.createGain();
      o.frequency.value = FREQ;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.005);
      g.gain.setValueAtTime(0.3, t + len - 0.005);
      g.gain.linearRampToValueAtTime(0, t + len);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + len + 0.01);
      t += len + d;
    }
  }

  #down() {
    if (this.#state === "result") return this.#next();
    if (this.#state !== "idle" && this.#state !== "keying") return;
    if (this.#downAt !== null) return;
    clearTimeout(this.#endTimer);
    this.#state = "keying";
    this.#downAt = performance.now();
    this.#tone(true);
    this.$(".tome-mk-pad").toggleAttribute("data-down", true);
  }

  #up() {
    if (this.#downAt === null) return;
    const now = performance.now();
    this.#marks.push([this.#downAt, now]);
    this.#downAt = null;
    this.#tone(false);
    this.$(".tome-mk-pad").toggleAttribute("data-down", false);
    this.$(".tome-mk-tape").textContent = "▬ ".repeat(this.#marks.length).trim();
    // End of character after a pause well beyond an inter-element gap.
    const lens = this.#marks.map(([s, e]) => e - s);
    const wait = Math.max(7 * this.#dit, 1.5 * Math.max(...lens), 450);
    this.#endTimer = setTimeout(() => this.#judge(), wait);
  }

  #classify(lens) {
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    // Mixed lengths: split at the geometric midpoint. Uniform: compare to 2 dits at target speed.
    const threshold = max / min >= 2 ? Math.sqrt(min * max) : 2 * this.#dit;
    return lens.map((l) => (l >= threshold ? "-" : ".")).join("");
  }

  async #judge() {
    if (this.#state !== "keying" || !this.#marks.length) return;
    this.#state = "saving";
    const lens = this.#marks.map(([s, e]) => e - s);
    const gaps = this.#marks.slice(1).map(([s], i) => s - this.#marks[i][1]);
    const keyed = this.#classify(lens);
    const decoded = DECODE[keyed] ?? "?";
    const ideal = [...keyed].map((e) => (e === "-" ? 3 : 1));
    const units = ideal.reduce((a, b) => a + b, 0) + gaps.length;
    const span = this.#marks.at(-1)[1] - this.#marks[0][0];
    const unit = span / units;
    const devs = [
      ...lens.map((l, i) => Math.abs(l - ideal[i] * unit) / (ideal[i] * unit)),
      ...gaps.map((g) => Math.abs(g - unit) / unit),
    ];
    const timingError = Math.round((devs.reduce((a, b) => a + b, 0) / devs.length) * 1000) / 10;
    const sendWpm = Math.round((1200 / unit) * 10) / 10;
    const correct = decoded === this.#target;
    if (correct) this.#correct++;
    const responseTime = Math.max(0, Math.round(this.#marks[0][0] - this.#promptAt));
    const verdict = this.$(".tome-verdict");
    verdict.hidden = false;
    verdict.dataset.state = correct ? "correct" : "wrong";
    verdict.textContent = `${correct ? "Right" : `That was ${decoded === "?" ? "not a character" : decoded}`} · ${sendWpm} wpm · timing ±${timingError}%`;
    this.$(".tome-mk-tape").textContent = `You sent ${SAY(keyed)}${correct ? "" : ` · ${this.#target} is ${SAY(CODES[this.#target])}`}`;
    try {
      await tome.attempt(
        {
          ref: `item:send-${this.#target.toLowerCase()}`,
          outcome: correct ? "correct" : "wrong",
          grade: correct ? 3 : 1,
          duration: Math.round(performance.now() - this.#promptAt),
          data: { direction: "send", keyed, decoded, sendWpm, timingError, wpm: this.#wpm, responseTime },
        },
        this,
      );
    } catch (err) {
      this.$(".tome-hint").textContent = `Couldn't save: ${err?.message ?? err}`;
    }
    this.#state = "result";
    this.$('[data-act="clear"]').hidden = true;
    const next = this.$('[data-act="next"]');
    next.hidden = false;
    next.textContent = this.#round >= this.#rounds ? "Finish" : "Next";
    this.$(".tome-hint").innerHTML = `Press <kbd>Space</kbd> or <kbd>Enter</kbd> for the next one`;
  }

  #finish() {
    this.#state = "finished";
    this.$(".tome-stage").innerHTML = `
      <p class="tome-mk-score">${this.#correct} of ${this.#rounds} sent cleanly</p>
      <div class="tome-mk-row"><button type="button" class="tome-mk-btn tome-mk-primary" data-act="again">Go again</button></div>`;
    this.$('[data-act="again"]').addEventListener("click", () => {
      this.#round = 0;
      this.#correct = 0;
      this.connectedCallback();
    });
  }
}

customElements.define("morse-key", MorseKey);

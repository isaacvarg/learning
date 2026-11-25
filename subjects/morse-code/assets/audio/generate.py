import math, struct, sys, wave
CODES = {"K": "-.-", "M": "--"}
def render(code, wpm=20, freq=600, rate=44100, lead=0.15, tail=0.15):
    dit = 1.2 / wpm; ramp = 0.005; out = []
    def silence(s): out.extend([0.0] * int(s * rate))
    def tone(s):
        n = int(s * rate); r = int(ramp * rate)
        for i in range(n):
            env = 1.0
            if i < r: env = 0.5 - 0.5 * math.cos(math.pi * i / r)
            elif i > n - r: env = 0.5 - 0.5 * math.cos(math.pi * (n - i) / r)
            out.append(0.6 * env * math.sin(2 * math.pi * freq * i / rate))
    silence(lead)
    for j, c in enumerate(code):
        if j: silence(dit)
        tone(dit if c == "." else 3 * dit)
    silence(tail)
    return out, rate
outdir = sys.argv[1]
for ch, code in CODES.items():
    s, rate = render(code)
    with wave.open(f"{outdir}/{ch.lower()}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(x * 32767)) for x in s))
    print(ch, code, f"{len(s)/rate*1000:.0f} ms")

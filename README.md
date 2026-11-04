# Dan's Beat the Clock

A quiz game for a big screen. Every player has a clock; only the player being asked loses time, and a correct
answer passes play to the next player. When a clock hits zero that player is out. The last clock ticking wins.

It is a static website (no server, no build step), published with GitHub Pages.

## Running a quiz

1. **On the big screen** (a laptop or tablet in landscape), open the site's address, for example
   `https://<you>.github.io/<repo>/`.
2. Tap **📡** and scan the QR code with your phone. The phone becomes the remote: you can run the whole game
   from it, and it shows you each question and its answer. (Or open `remote.html` on the phone and type the
   room code.)
3. **Tap the big screen once** so the browser allows sound. The 📡 chip shows 🔇 until you do.
4. On the phone, open **👥 Players** to set names and seconds, then **Send & start game**. Then **▶ Start clock**.
5. Read the question, and tap **✓ CORRECT** when it is answered. When a clock runs out, tap **Continue →**.

The big screen has its own buttons as well, if you ever need them. On a laptop, **C** = correct and
**P** = pause/resume.

### Host controls on the phone (⚙ Host)

- **Add or remove time** for everyone still in, or **set all clocks**.
- **Questions:** choose a questions file stored on the phone (see below), or go back to the default questions.
- **Next question after Correct:** whether the reader moves on by itself.
- **Reset all settings:** puts the questions, your place, the players list and the other options back to their
  defaults. The phone stays connected.

## Questions

The phone starts with `questions.json` from the site. To use different questions without changing the site,
put a file in the same format on your phone and choose it under **⚙ Host → Questions → Choose file…**. It is
remembered on that phone until you choose another, tap **Use default**, or reset.

```json
{
  "questions": [
    { "question": "What is the capital city of Australia?", "answer": "Canberra" },
    { "question": "How many sides does a hexagon have?", "answer": "Six" }
  ]
}
```

- Every item needs a `"question"`; `"answer"` is optional.
- A plain list `[ {...}, {...} ]` also works.
- If something is wrong, the phone says what, e.g. *my-quiz.json: question 5 has no "question"*.
- Files can be up to 1 MB.

## Publishing

Upload everything in this folder to the GitHub Pages repository:

```
index.html  remote.html  questions.json  css/  js/  vendor/  tests/  README.md  CLAUDE.md
```

Old links and QR codes that point at `index.html?remote=CODE` still work; they forward to `remote.html`.

## Trying it on your computer

The pages use JavaScript modules, which browsers will not load from a file on disk, so start a small web
server in this folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000/> for the display and <http://localhost:8000/remote.html> for the remote
(a phone on the same Wi-Fi can use `http://<your computer's IP>:8000/remote.html`).
<http://localhost:8000/tests/game.test.html> runs the automatic checks; every line should be blue.

## How the phone talks to the screen

Through free public MQTT relays (several at once, so if one is down the others carry on). Nothing is stored
on them. The six-letter room code is the only thing that links the two devices, so keep it to yourselves;
**New code** in the 📡 dialog makes a fresh one.

## Third-party code

- `vendor/mqtt.min.js`: [MQTT.js](https://github.com/mqttjs/MQTT.js) 5.15.2, MIT licence.
- `vendor/qrcode.js`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by
  Kazuhiko Arase, MIT licence.
- Fonts: Bebas Neue, Inter and JetBrains Mono from Google Fonts.

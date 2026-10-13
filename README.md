# Draft Enhancer for SillyTavern

Turn a rough one-liner into a full, polished roleplay message, or let the model write your next turn for you. Draft Enhancer adds a small button next to the message box with two tools:

- **Enhance my draft** takes whatever you typed (even three words) and rewrites it into a rich message that fits the scene, your persona's voice and the chat's writing style.
- **Write something for me** writes your next message. Anything you typed is used as the direction.

The result lands in the message box, so you can edit it before sending, and **Undo** brings your original text back.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.0.0-informational)
![SillyTavern extension](https://img.shields.io/badge/SillyTavern-extension-orange)

<!-- Add screenshots here, for example: ![Menu](docs/menu.png) ![Settings](docs/settings.png) -->

---

## Table of contents

- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Using the extension](#using-the-extension)
- [Generation modes](#generation-modes)
- [Settings reference](#settings-reference)
- [How the rewrite instruction works](#how-the-rewrite-instruction-works)
- [Tips for better results](#tips-for-better-results)
- [Troubleshooting and FAQ](#troubleshooting-and-faq)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Privacy](#privacy)
- [For developers](#for-developers)
- [Updating and uninstalling](#updating-and-uninstalling)
- [License](#license)
- [العربية](#العربية)

---

## Features

- **Works with any draft length.** A short draft is expanded to a target size (configurable minimum), a long one is polished without being cut down.
- **Context-aware.** In the default mode the request goes through SillyTavern's normal prompt pipeline, so your preset, character card, persona, lorebook, author's note and chat history all apply, and the output follows the model you are connected to.
- **Faithful to your intent.** Your actions, dialogue and decisions are kept in order. A creativity setting controls how much new detail may be added.
- **Matches your style.** Perspective, tense and formatting (`*actions*` with `"dialogue"`, or plain prose) are detected from your draft and earlier messages, or forced from the settings.
- **Never speaks for the character.** The instruction forbids writing the character's dialogue, actions or reactions.
- **Any language.** Output in the language of your draft, the language of the chat, or a custom language. Arabic drafts are supported, including the token budget.
- **Length control.** Light polish, balanced, rich, or match the length of the character's last message, with minimum and maximum word limits.
- **Safe to use.** Optional preview window (Use / Retry / Cancel), one-step Undo, cancel while generating, and the original draft is never lost on errors.
- **Fast access.** Send-bar button, keyboard shortcuts and slash commands.
- **Two modes.** Full context, or a lightweight mode that sends only a compact context.
- **Robust.** Handles reasoning blocks (`<think>...</think>`), code fences and stray labels in model output, and falls back to the older SillyTavern call signatures when needed.

## Installation

### Option A: install from GitHub (recommended)

1. In SillyTavern, open the **Extensions** panel (puzzle-piece icon in the top bar).
2. Click **Install extension**.
3. Paste the repository URL, for example `https://github.com/brabro1/DraftEnhancer`, and confirm. If SillyTavern asks, choose whether to install it for yourself or for all users.
4. Reload the page. A feather button appears in the send bar, and a **Draft Enhancer** section appears in the Extensions settings.

Installing from a URL needs `git` on the machine that runs SillyTavern. On Termux, run `pkg install git` if it is missing.

### Option B: manual install

Copy the `DraftEnhancer` folder (the one containing `manifest.json`) to one of these locations, then restart SillyTavern and reload the page:

```
SillyTavern/data/<your-user>/extensions/DraftEnhancer        (only for that user, usually default-user)
SillyTavern/public/scripts/extensions/third-party/DraftEnhancer   (for all users)
```

### Option C: Termux (SillyTavern running on your phone)

```bash
termux-setup-storage            # first time only, grant the storage permission
pkg install unzip -y
unzip ~/storage/downloads/DraftEnhancer.zip -d ~/storage/downloads/
cp -r ~/storage/downloads/DraftEnhancer ~/SillyTavern/data/default-user/extensions/
```

Adjust the paths if your SillyTavern folder or user name is different, then restart SillyTavern.

### Option D: phone connected to a SillyTavern server

Extensions live on the server, not on the device you browse from. If your phone opens SillyTavern running on your PC or a remote server, install the extension there once and it is available on every device. Reload the page after installing.

## Quick start

1. Open a chat and type a rough draft in the message box, for example: `I sit down and stare at her.`
2. Click the feather button and choose **Enhance my draft** (or press `Alt+E`).
3. After a few seconds your draft is replaced with the finished message. Edit it if you like and send.
4. Not happy? Click the button again and choose **Undo last change** (or press `Alt+Z`).

To let the model write for you, leave the box empty (or type a short direction such as `deflect with a joke`) and choose **Write something for me**.

## Using the extension

### The button and menu

The feather button sits on the left side of the send bar. Clicking it opens the menu:

| Item | What it does | Shortcut |
| --- | --- | --- |
| Enhance my draft | Rewrites the text in the message box | `Alt+E` |
| Write something for me | Writes your next message, using the box text as direction if present | `Alt+W` |
| Undo last change | Restores the text you had before the last enhance or write | `Alt+Z` |

While a request is running the button shows a spinner. Click it to cancel.

Shortcuts work only while the cursor is in the message box, use physical key positions (so they work on any keyboard layout, including Arabic), and can be turned off in the settings. Touch devices use the button.

### Slash commands

| Command | Alias | Description |
| --- | --- | --- |
| `/enhance-draft [text]` | `/enhance` | Enhances the given text, or the message box if no text is given |
| `/write-for-me [direction]` | `/writeforme` | Writes your next message, optionally steered by a direction |

Both put the result in the message box and also return it as text, so it can be used by STscript.

### Preview window

Turn on **Preview before applying** to review each result in a window with your original text, an editable result, and the buttons **Use this**, **Retry** and **Cancel**. Retry runs a fresh generation from the same original text.

### Auto-send

**Send automatically after generating** sends the result right away. It is off by default so you can review the text first.

## Generation modes

| | Full context (default) | Lightweight |
| --- | --- | --- |
| What is sent | The normal SillyTavern prompt (preset, card, persona, lorebook, author's note, history) plus the rewrite instruction | A compact context (character description, personality and scenario, your persona, the last N messages) plus the rewrite instruction |
| Follows your preset | Yes | Only the sampler settings |
| Speed and token cost | Same as a normal reply | Lower |
| Best when | You want the result to match the scene, lore and writing style as closely as possible | A preset makes the model answer as the character instead of rewriting, or you want cheaper, faster requests |

If a result comes back as an in-character reply instead of your rewritten message, switch to Lightweight mode.

## Settings reference

Open **Extensions** and expand **Draft Enhancer**. All settings are saved with your SillyTavern settings.

### General

| Setting | Default | Description |
| --- | --- | --- |
| Enable Draft Enhancer | On | Shows or hides the button and disables the commands and shortcuts |
| Generation mode | Full context | Full context or Lightweight (see above) |
| Preview before applying | Off | Show the Use / Retry / Cancel window |
| Send automatically after generating | Off | Send the result immediately |
| Keyboard shortcuts | On | `Alt+E`, `Alt+W`, `Alt+Z` inside the message box |
| Log prompts and outputs | Off | Writes the prompt and raw output to the browser console |

### Enhance my draft

| Setting | Default | Description |
| --- | --- | --- |
| Length | Balanced | Light polish (about 1.25x the draft), Balanced (about 2.2x), Rich (about 3.5x), or match the last character message |
| Creativity | Balanced | Faithful (no new content, only richer delivery), Balanced (small supporting details), Creative (develop the idea further) |
| Perspective | Auto | Follow the draft and your history, or force first, second or third person |
| Formatting | Auto | Detect from the chat, or force `*actions*` with `"dialogue"`, or plain prose with `"dialogue"` |
| Minimum words for short drafts | 60 | Floor for Balanced length (Rich uses twice this value) |
| Maximum words | 450 | Upper limit for the target length (raised automatically if your draft is already longer) |
| Output language | Same as my draft | Same as the draft, same as the chat, or custom |
| Custom language | empty | Language name used when Output language is Custom |
| Extra instructions | empty | Free text added to every enhance request |

### Write something for me

| Setting | Default | Description |
| --- | --- | --- |
| Target words | 0 | Length of the generated message. 0 means match the last character message |
| Extra instructions | empty | Free text added to every write request |

### Advanced

| Setting | Default | Description |
| --- | --- | --- |
| Messages of history (Lightweight mode) | 6 | How many recent messages are included in Lightweight mode |
| Max tokens | 0 | Response token limit. 0 chooses automatically from the target length (roughly 3 tokens per word, 4.5 for Arabic, plus headroom, between 300 and 3000) |

**Reset to defaults** restores every setting.

## How the rewrite instruction works

Each request carries a structured instruction. For **Enhance my draft** it contains:

1. **Task framing.** A clear out-of-character rewrite task, so the model does not continue the story as the character.
2. **Your draft**, inside `<draft>` tags, passed through untouched.
3. **Faithfulness rules** based on the Creativity setting: keep every action and line in order, never contradict the draft or the story, preserve meaning, tone and intensity, no disclaimers.
4. **Length target** with an acceptable range. Short drafts are expanded to the target and the result is never meant to be shorter than the draft.
5. **Perspective and tense** from the draft, your earlier messages, or your override.
6. **Formatting** detected from the chat (asterisk actions or plain prose) or your override.
7. **Voice** matched to your earlier messages, with the descriptive richness of the chat.
8. **Boundaries.** Only your character is written, never the other character's words, actions, thoughts or reactions, and the message stops where your draft stops.
9. **Language** and quality rules (varied rhythm, concrete detail, no filler, no repetition of recent messages).
10. Your **extra instructions**, then an output rule: only the finished message, with no labels or notes.

**Write something for me** uses the same structure with your direction in `<direction>` tags, or, when there is none, an instruction to choose a natural, in-character next move.

The reply is then cleaned: reasoning blocks, code fences, `<draft>` tags, leading labels such as "Rewritten:" and a leading `YourName:` prefix are removed. Pure dialogue in quotes is kept as is.

Turn on **Log prompts and outputs**, or run `DraftEnhancer.getLastPrompt()` in the browser console, to see exactly what was sent.

## Tips for better results

- Keep the draft in your own words. A line like `I step closer and ask about the letter` is enough. Faithful and Balanced creativity keep your intent.
- For longer, more novel-like turns choose **Rich** length and **Creative** creativity. For minimal edits choose **Light polish** and **Faithful**.
- Use **Match the last character message** to keep both sides at a similar length.
- If your chat uses a special style (second person, present tense, no asterisks), set Perspective and Formatting explicitly instead of Auto.
- Use **Extra instructions** for personal rules, for example `Keep my character guarded and sarcastic` or `Short sentences, no purple prose`.
- Draft in Arabic and want English output (or the reverse)? Set **Output language** to **Same as the chat**.
- Use the preview window with **Retry** when you want to compare several versions.

## Troubleshooting and FAQ

**The button does not appear.** Make sure the extension folder contains `manifest.json` at its top level (not inside a sub-folder) and sits in one of the extension folders listed above. Restart SillyTavern, reload the page without cache, and check that the extension is enabled in its settings. Errors are logged in the browser console with the prefix `[Draft Enhancer]`.

**"Type a draft in the message box first."** Enhance needs some text. Use **Write something for me** if you want the model to write from scratch.

**"Wait for the current reply to finish first."** The extension does not start while a normal reply is generating.

**Empty or very short result with a reasoning model.** Reasoning tokens can use up the response limit. Raise **Max tokens** in the Advanced settings.

**The model answers as the character instead of rewriting.** Switch to **Lightweight** mode, or add an extra instruction such as `Output only the rewritten message`.

**The result is cut off.** Raise **Max tokens** or lower the target length.

**The result adds things I did not write.** Set Creativity to **Faithful** and Length to **Light polish** or **Balanced**.

**The result is too short.** Choose **Rich** length, raise **Minimum words for short drafts**, or use **Match the last character message**.

**Can I use a different model or API just for enhancing?** The extension uses the API and preset you have connected, and has no separate model setting.

**Can I change the temperature only for the extension?** No. It uses the sampler settings of your active preset.

**Does it work in group chats?** Yes. In group chats the instruction refers to "the other characters" and the Lightweight mode skips the single-character card.

## Compatibility and limitations

- Built for current SillyTavern releases and uses the stable `SillyTavern.getContext()` API. It also contains a fallback for the older positional signatures of `generateQuietPrompt` and `generateRaw`. Very old versions are not tested.
- Developed and tested on desktop. On phones the same button and menu are used. Keyboard shortcuts need a physical keyboard.
- It uses SillyTavern's own generation functions, so it follows whichever API and model you have connected. Behavior can still differ between models and providers.
- Results are not streamed. The text appears when generation finishes.
- Only one request runs at a time, and it is blocked while a normal reply is generating.
- Undo keeps one level: the text you had before the last change.
- Quality depends on the model and preset you use.

## Privacy

Draft Enhancer makes no network requests of its own. Your draft and the context go only to the API you have already connected in SillyTavern, the same way a normal message does. The only data it stores is its settings, inside your SillyTavern settings. Prompts and outputs are logged to the console only if you enable the log option.

## For developers

### Structure

```
DraftEnhancer/
  manifest.json   extension metadata
  index.js        all logic: settings, prompt building, generation, UI, slash commands
  style.css       button, menu, preview window and settings styling
  README.md
  LICENSE
```

### Public API

The extension exposes a small object on `window`:

```js
DraftEnhancer.enhance('I wave');          // returns a Promise with the enhanced text (or null)
DraftEnhancer.write('ask about the key'); // returns a Promise with the generated text (or null)
DraftEnhancer.undo();                     // restores the previous message box text
DraftEnhancer.getLastPrompt();            // the last instruction that was sent
DraftEnhancer.getLastOutput();            // the last raw model output
```

Both `enhance` and `write` place the result in the message box, like the menu items do.

### Debugging

Enable **Log prompts and outputs** in the settings and open the browser developer console. All messages use the prefix `[Draft Enhancer]`.

### Contributing

Issues and pull requests are welcome. When reporting a bug, include your SillyTavern version, the API and model you use, whether you use Full context or Lightweight mode, and the console output with the log option enabled (remove private content first).

## Updating and uninstalling

- **Update:** if you installed from GitHub, open **Extensions**, then **Manage extensions**, and use the update button. For a manual install, replace the folder and reload the page.
- **Uninstall:** remove it from **Manage extensions**, or delete the `DraftEnhancer` folder and restart SillyTavern.

## License

Released under the [MIT License](LICENSE).

---

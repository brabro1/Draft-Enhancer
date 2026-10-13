# Draft Enhancer for SillyTavern (beta)

Janitor AI's **Enhance my draft** and **Write something for me**, brought to SillyTavern.

- **Enhance my draft**: type a rough line, even three words, and it becomes a finished message.
- **Write something for me**: the next message is written for you. Anything you typed is used as the direction.

Both follow your active preset, jailbreak included, and put the result in the message box so you can edit it before sending.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-2.0.0--beta.1-orange)
![SillyTavern extension](https://img.shields.io/badge/SillyTavern-extension-informational)

> **Beta.** This is a pre-release. It works, but expect changes between versions. Bug reports and feedback are very welcome in the [issues](https://github.com/brabro1/Draft-Enhancer/issues).

<!-- Screenshots: add images here, for example ![Menu](docs/menu.png) -->

## Contents

- [Installation](#installation)
- [How to use](#how-to-use)
- [How it follows your preset](#how-it-follows-your-preset)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Privacy](#privacy)
- [For developers](#for-developers)
- [License](#license)

## Installation

**From GitHub (recommended)**

1. In SillyTavern open **Extensions** (puzzle-piece icon) and click **Install extension**.
2. Paste `https://github.com/brabro1/Draft-Enhancer` and confirm.
3. Reload the page. A feather button appears in the send bar.

Installing from a URL needs `git` on the machine that runs SillyTavern (on Termux: `pkg install git`).

**Manually**

Copy the extension folder (the one with `manifest.json` inside) to `SillyTavern/data/<your-user>/extensions/` and restart SillyTavern.

**On a phone**

- If your phone opens SillyTavern that runs on your PC or a server, there is nothing to do: install it there once and it shows up on every device.
- If SillyTavern runs on the phone itself (Termux):

  ```bash
  cd ~/SillyTavern/data/default-user/extensions
  git clone https://github.com/brabro1/Draft-Enhancer
  ```

  Then restart SillyTavern.

After an update, close and reopen the browser tab so the phone does not keep the old version cached.

## How to use

1. Type something in the message box.
2. Tap the feather button and pick an action:

| Menu item | What it does | Shortcut |
| --- | --- | --- |
| Enhance my draft | Rewrites the text in the box into a finished message | `Alt+E` |
| Write something for me | Writes the next message; the text in the box (if any) is the direction | `Alt+W` |
| Writing as: *name* | Switches between writing as **you** and as **the character** | |
| Undo last change | Brings back the text you had before | `Alt+Z` |

The result appears in the message box (when writing as you it streams in live). Edit it if you like, then send. Tap the feather again while it is working to cancel; your draft comes back.

The two actions are also in SillyTavern's **Extensions (wand) menu**, and as slash commands:

- `/enhance-draft [text]` (alias `/enhance`)
- `/write-for-me [direction]` (alias `/writeforme`)

### Writing as the character

Sometimes you want to write what the character says or does yourself. Switch the menu to **Writing as: (character)**, type a draft such as `she hands me the tea and smiles` and tap **Enhance my draft**. Or leave the box empty and tap **Write something for me** to get a full reply from the character. The text goes into the message box like any other result.

When writing as you, a draft can still mention what the character does (`I take the cup she offers`). The extension keeps that as written and does not add more for the character.

## How it follows your preset

Draft Enhancer does not use its own writing rules. It runs the request through SillyTavern's normal generation, so everything your preset sets up applies: main prompt, jailbreak, enabled toggles, post-history instructions, lorebooks, author's note, persona and chat history.

| Writing as | SillyTavern path | What applies from the preset |
| --- | --- | --- |
| You | **Impersonate** (the same path as SillyTavern's Impersonate button) | Everything above, plus the preset's Impersonation prompt, its impersonation prefill, prompts that are set to fire only on Impersonate, and User Input regex scripts |
| The character | **Quiet character turn** (the path SillyTavern uses for background replies) | Everything above, as for a normal character reply |

On top of that, the extension adds one short note as the last message. The note says only what the preset cannot know:

- the task (enhance or write)
- your draft or direction
- to keep every action and line from your draft
- the length
- your own notes

Style, tone, point of view and content rules all come from your preset.

Many presets add extras to every narrator reply, such as a time/location header, status or tracker panels, HTML or reasoning. The note asks the model to leave them out, and **Remove preset extras** cleans up anything that still comes through.

## Settings

Open **Extensions** and expand **Draft Enhancer**.

| Setting | Default | What it does |
| --- | --- | --- |
| Enabled | On | Shows or hides the button and the menu entries |
| Length | Flexible | **Flexible** fits your text. A one-line draft grows into a full message (about 50-120 words), a short paragraph roughly doubles, and a detailed draft is polished without padding. For Write, it follows how long that speaker's recent messages are. **Short** (30-80 words), **Medium** (80-180) and **Long** (180-350) are fixed ranges. Enhance never makes a draft shorter. |
| Write as | You | You (your persona) or the character. Also switchable from the menu. |
| Your notes | empty | Free text added to every request, for example `Keep my character guarded and sarcastic` |
| Preview before applying | Off | Shows the result in a window with **Use this**, **Retry** and **Cancel** |
| Send automatically | Off | Sends the result right away |
| Remove preset extras | On | Removes scene headers like `[ 08:15 PM \| Day 3 \| Tavern ]`, status and tracker panels, HTML and reasoning from the result |
| Log requests | Off | Writes each note and raw model output to the browser console |

## Troubleshooting

**The button does not appear.** Check that `manifest.json` is at the top level of the extension folder, restart SillyTavern and reload the page. Errors appear in the browser console with the prefix `[Draft Enhancer]`.

**The result does not sound like my preset.** For "Writing as you", most of the style comes from your preset's **Impersonation prompt** (AI Response Configuration, Utility Prompts) and any prompts set to trigger on Impersonate. Adjust those, or use **Your notes**.

**A header or status panel ends up in my message.** Keep **Remove preset extras** on. If one still gets through, turn on **Log requests** and open an issue with the raw output.

**Empty result with a reasoning model.** The reasoning can use up the whole response length. Raise the response length in your preset.

**It adds things I did not write.** Use the **Short** length, or add a note such as `Change only the wording`.

**Does it work in group chats?** Yes. "The character" is whoever SillyTavern currently treats as the active character.

## Limitations

- Beta: settings and behaviour may still change.
- Needs a recent SillyTavern release.
- One request at a time, and not while a normal reply is generating.
- Undo keeps one step.
- When writing as you, other extensions that react to Impersonate also see the request.
- The quality depends on your model and preset.

## Privacy

Draft Enhancer makes no network requests of its own. Your text goes only to the API you already use in SillyTavern, the same way a normal message does. It stores only its settings, inside your SillyTavern settings.

## For developers

```
manifest.json   extension metadata
index.js        settings, the task note, generation, cleanup, menu, preview, slash commands
style.css       button, menu, preview and settings styles
```

Console helpers:

```js
DraftEnhancer.enhance('I wave');          // same as the menu item; resolves to the text or null
DraftEnhancer.write('ask about the key');
DraftEnhancer.undo();
DraftEnhancer.getLastPrompt();            // the last note that was sent
DraftEnhancer.getLastOutput();            // the last raw model output
```

When reporting a bug, include your SillyTavern version, API and model, preset name, and the console output with **Log requests** on (remove anything private).

## License

[MIT](LICENSE)

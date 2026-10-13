# Draft Enhancer for SillyTavern

Two tools in one button next to the message box:

- **Enhance my draft**: takes whatever you typed (even a few words) and rewrites it into a full, polished message that fits the scene, your persona's voice, and the chat's writing style.
- **Write something for me**: writes your next message. Anything you typed is used as the direction.

Both put the result in the message box, so you can edit before sending. **Undo last change** restores what you had before.

## Install

Copy the `DraftEnhancer` folder to one of these, then restart SillyTavern and refresh the page:

- `SillyTavern/data/default-user/extensions/DraftEnhancer`
- or `SillyTavern/public/scripts/extensions/third-party/DraftEnhancer`

## Use

- Click the feather button in the send bar (left side), or use the shortcuts inside the message box: `Alt+E` enhance, `Alt+W` write, `Alt+Z` undo.
- Click the spinning button to cancel a running request.
- Slash commands: `/enhance-draft [text]` and `/write-for-me [direction]`.

## Modes

- **Full context** (default): uses your normal prompt (preset, character card, persona, lorebook, author's note, chat history), so output follows the model and preset you use.
- **Lightweight**: only sends the card, persona and the last few messages. Use it if a preset makes the model answer as the character instead of rewriting your draft.

## Settings (Extensions panel, "Draft Enhancer")

Length (light polish / balanced / rich / match the last character message), creativity, perspective, formatting, output language, min and max words, extra instructions, preview before applying (Use / Retry / Cancel), auto-send, and max tokens.

## Troubleshooting

- Empty result with a reasoning model: raise **Max tokens** in the settings.
- Model replies as the character: switch to **Lightweight** mode, or add an extra instruction.
- See the exact prompt: enable the console log option, or run `DraftEnhancer.getLastPrompt()` in the browser console.

Requires a recent SillyTavern release (1.12 or newer recommended).

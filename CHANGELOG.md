# Changelog

## 2.2.0-beta.1

- **Preset compatibility** (tested against Writer's Block Unlimited): new setting that tells the model to skip the preset's end-of-reply extras and its "who you may write for" rules, so narrative modes (Roleplay, Director, Persona) and trackers stop leaking into your message.
- The clean-up now removes tag trackers (`<svt>`, `<trk>`, `<bst>`, `<tracker>` and their mini-tags) together with their content, plot-director / brainstormer blocks, `💰` one-line trackers and a leftover `(answer)` placeholder.

## 2.1.0-beta.3

- **Write as: The character** now writes the character's own turn: their point of view, voice, actions and thoughts, and never the player's. Voice matching uses the character's recent messages in this mode.
- **Write as: Narrator** now narrates like an outside storyteller and decides from the context whether to show both you and the character in the scene or only narrate the setting and events.

## 2.1.0-beta.2

- Fix: the "cut a reply stopped mid-sentence" option no longer clips short replies that end in an emoji or a plain word; it only trims a small unfinished tail (at most 20%).
- Fix: the trailing-note clean-up only removes lines that start with "Note:", not story text that begins with the word "Note".

## 2.1.0-beta.1

- **Match my writing voice**: a few of your recent messages are sent as a style sample.
- **Tone** setting (warm, romantic, playful, tense, dark, calm, angry).
- Text in (parentheses) or [brackets] is treated as a direction to the model.
- **Compact instruction style** for small and local models.
- Automatic **retries** on an empty result.
- Replies cut off mid-sentence are trimmed back to the last full sentence.
- Chatty lead-ins ("Sure, here is…") and trailing notes are removed.
- Enhance on an empty box writes something for you instead of warning.
- **Result history**: flip between regenerated results with the arrows in the Keep / Regenerate / Discard bar.

## 2.0.0-beta.3

- Previous beta. See the commit history for earlier changes.

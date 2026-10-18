# Changelog

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

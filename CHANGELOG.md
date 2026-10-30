# Changelog

## 2.5.0-beta.1

- **Continue my draft** (`Alt+C`, `/continue-draft`): keeps what you wrote and adds the rest, from exactly where you stopped.
- **Enhance a selection**: select part of the box first and only that part is rewritten; the text around it stays exactly as it is.
- **Refine** on the result bar: Shorter, Longer, More dialogue, More detail, More emotion, Simpler wording, or type your own change.
- **Clean while streaming**: reasoning, trackers and status blocks no longer flash in the box while the reply streams in; the box says "Draft Enhancer is writing…" while a reasoning model thinks.
- **Connection profile for drafting**: draft with another API or model from the Connection Manager; the connection is switched back afterwards. It only switches when your own connection is an up-to-date saved profile, so switching back can never lose your settings; otherwise it warns and uses the current connection.
- **Write as, per character and group**, and in group chats you can pick which member to write as (`as=` also takes a member's name).
- **Multi-step Undo** (last 20 changes); Undo also brings back a result after Discard.
- **Preview the note** button in the settings.
- Tests in the repository (`node tests/run.mjs`, 45 checks), run on every push by GitHub Actions.
- Tested with a real model (GLM 5.3 thinking, streaming) in SillyTavern 1.19.0.

## 2.4.1-beta.1

- Code clean-up: index.js rewritten for clarity, about 180 lines shorter, with every feature and setting kept (your settings carry over). Removed the pre-2.0 settings migration (old keys are now simply dropped), fallbacks for SillyTavern versions that are no longer supported, duplicate state and dead CSS. Slash commands now register through SillyTavern's context instead of file imports.
- Fix: the menu could open in the top-left corner instead of above the feather button; it now positions itself again once the layout settles and when the window resizes.
- The settings panel is built section by section (no more empty grid hack).

## 2.4.0-beta.1

- **Continues where the chat stopped**: the last chat message is now sent again inside the note, right next to the task, with an instruction to follow directly from it (same scene, place and moment; no restart, recap or time jump). Fixes drafts that drifted away from the current point of the story, especially with presets that put long instructions after the chat history. New setting, on by default; new `{{last}}` macro for custom instructions.

## 2.3.0-beta.1

- **Works with any preset**: with Chat Completion the note is now appended as the very last message, after all preset prompts, trackers and chain-of-thought templates, so nothing the preset adds at the end can outrank it. Verified end to end in SillyTavern 1.19.0 against Writer's Block Unlimited with trackers, a narrative mode, a writing assistant and a chain-of-thought template switched on, and against the Default preset.
- Writing as the character or narrator no longer fights the preset's impersonation prompt: it is left out of that one request (writing as you keeps it).
- Clean-up removes any unknown tag-wrapped block at the very end of a reply (trackers and notes in formats the extension has never seen), unless it is ordinary formatting like `<b>` or `<i>`.

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

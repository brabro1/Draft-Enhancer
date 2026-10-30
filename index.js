/*
 * Draft Enhancer (beta) — SillyTavern extension
 *
 * Janitor AI's "Enhance my draft" and "Write something for me", for SillyTavern, plus "Continue my draft" and
 * refining a result ("Shorter", "More dialogue", ...).
 *
 * Every request runs through SillyTavern's Impersonate, so the active preset (main prompt, jailbreak, toggles,
 * impersonation prompt and prefill, impersonate-only prompts, user-input regex), lorebooks, persona and chat history
 * all apply. The extension only adds one short note that describes the task, and the result always lands in the
 * message box for you to edit and send.
 *
 * "Write as" chooses whose turn the message is: yours, a character's, or the narrator's.
 */

const MODULE = 'draftEnhancer';
const TAG = '[Draft Enhancer]';
const TITLE = 'Draft Enhancer';
const NOTE_KEY = 'draft_enhancer_note';
const NO_PROFILE = '<None>';

/* ------------------------------------------------------------------ */
/* Settings schema: the panel and the defaults are both built from it  */
/* ------------------------------------------------------------------ */

const SUBJECTS = [
    ['user', 'You (your persona)'],
    ['char', 'The character (their point of view and actions, never yours)'],
    ['narrator', 'Narrator (the scene, you and the character, or just the story)'],
];

const SECTIONS = [
    ['General', [
        { key: 'enabled', type: 'bool', def: true, label: 'Enabled' },
        { key: 'wandMenu', type: 'bool', def: true, label: 'Also show the actions in the Extensions (wand) menu' },
        { key: 'shortcuts', type: 'bool', def: true, label: 'Keyboard shortcuts in the message box (Alt+E, Alt+W, Alt+C, Alt+Z)' },
        { key: 'actionBar', type: 'bool', def: true, label: 'Show Keep / Regenerate / Refine / Discard after each result' },
        { key: 'autoSend', type: 'bool', def: false, label: 'Send automatically' },
        { key: 'debug', type: 'bool', def: false, label: 'Log every request to the browser console' },
    ]],
    ['Writing', [
        {
            key: 'subject', type: 'select', def: 'user', label: 'Write as (default)', options: SUBJECTS, grid: true,
            hint: 'Whose turn the message is. The menu can change it per character.',
        },
        {
            key: 'length', type: 'select', def: 'flexible', label: 'Length', grid: true,
            options: [['flexible', 'Flexible (fits your text)'], ['short', 'Short (30-80 words)'], ['medium', 'Medium (80-180 words)'], ['long', 'Long (180-350 words)'], ['custom', 'Custom range']],
        },
        { key: 'lengthMin', type: 'number', def: 60, label: 'Custom: minimum words', min: 10, max: 2000, step: 10, grid: true, showIf: (s) => s.length === 'custom' },
        { key: 'lengthMax', type: 'number', def: 160, label: 'Custom: maximum words', min: 10, max: 3000, step: 10, grid: true, showIf: (s) => s.length === 'custom' },
        {
            key: 'pov', type: 'select', def: 'auto', label: 'Point of view', grid: true,
            options: [['auto', 'Auto (follow the chat)'], ['first', 'First person (I)'], ['second', 'Second person (you)'], ['third', 'Third person (he / she / they)']],
        },
        {
            key: 'format', type: 'select', def: 'auto', label: 'Formatting', grid: true,
            options: [['auto', 'Auto (follow the chat)'], ['asterisks', '*Actions* and "dialogue"'], ['plain', 'Plain prose and "dialogue"'], ['dialogue', 'Dialogue only']],
        },
        { key: 'language', type: 'select', def: 'auto', label: 'Language', grid: true, options: [['auto', 'Same as what I typed'], ['chat', 'Same as the chat'], ['custom', 'Custom']] },
        { key: 'languageName', type: 'text', def: '', label: 'Language name', placeholder: 'e.g. English', grid: true, showIf: (s) => s.language === 'custom' },
        {
            key: 'faithfulness', type: 'select', def: 'balanced', label: 'Enhance: faithfulness', grid: true,
            options: [['strict', 'Strict (only wording and detail)'], ['balanced', 'Balanced (small supporting beats)'], ['creative', 'Creative (develop the idea)']],
        },
        {
            key: 'tone', type: 'select', def: 'auto', label: 'Tone', grid: true,
            options: [['auto', 'Auto (follow the chat)'], ['warm', 'Warm and gentle'], ['romantic', 'Romantic'], ['playful', 'Playful and teasing'], ['tense', 'Tense'], ['dark', 'Dark and serious'], ['calm', 'Calm and reflective'], ['angry', 'Angry']],
        },
        { key: 'rememberSubject', type: 'bool', def: true, label: 'Remember "Write as" for each character and group' },
        { key: 'voiceMatch', type: 'bool', def: true, label: 'Match the writing voice (uses a few recent messages from that side as a style sample)' },
        { key: 'parenDirections', type: 'bool', def: true, label: 'Treat (parentheses) and [brackets] in my text as directions, not words to write' },
        { key: 'anchor', type: 'bool', def: true, label: 'Continue exactly where the chat stopped (sends the last message again, right next to the task)' },
        { key: 'noRepeat', type: 'bool', def: true, label: 'Ask the model not to repeat recent messages' },
        { key: 'endOpen', type: 'bool', def: true, label: 'Stop where the other side would answer (leave the turn open)' },
    ]],
    ['Model compatibility', [
        {
            key: 'profile', type: 'profile', def: '', label: 'Connection profile for drafting', grid: true,
            hint: 'Draft with another API or model (Connection Manager). Your connection is switched back afterwards.',
        },
        {
            key: 'instructionStyle', type: 'select', def: 'full', label: 'Instruction style', grid: true,
            options: [['full', 'Full (best for large models)'], ['compact', 'Compact (small or local models)']],
            hint: 'Compact sends a shorter note with only the essential rules.',
        },
        { key: 'retries', type: 'number', def: 1, label: 'Retries on an empty result', min: 0, max: 3, step: 1, grid: true },
        { key: 'presetGuard', type: 'bool', def: true, label: "Tell the model to skip the preset's end-of-reply extras (trackers, status blocks, suggestions) and its \"who you may write for\" rules" },
        { key: 'liveClean', type: 'bool', def: true, label: 'Clean the text live while it streams in (no reasoning or trackers flashing in the box)' },
        { key: 'emptyToWrite', type: 'bool', def: true, label: 'Enhance or Continue with an empty box writes something for me instead' },
        { key: 'trimUnfinished', type: 'bool', def: true, label: 'Cut a reply that was stopped mid-sentence back to its last full sentence' },
    ]],
    ['Instructions', [
        { key: 'notesEnhance', type: 'area', def: '', label: 'Your notes for Enhance my draft', placeholder: 'e.g. Keep sentences short, no purple prose.' },
        { key: 'notesWrite', type: 'area', def: '', label: 'Your notes for Write something for me and Continue my draft', placeholder: 'e.g. Keep my character guarded and sarcastic.' },
        {
            key: 'templateEnhance', type: 'area', def: '', label: 'Custom instruction for Enhance (advanced)', fill: 'enhance',
            placeholder: 'Empty = the built-in instruction. Macros: {{draft}} {{rules}} {{notes}} {{subject}} {{other}} {{min}} {{max}} {{last}}, plus SillyTavern macros such as {{user}} and {{char}}.',
        },
        {
            key: 'templateWrite', type: 'area', def: '', label: 'Custom instruction for Write (advanced)', fill: 'write',
            placeholder: 'Empty = the built-in instruction. Macros: {{direction}} {{rules}} {{notes}} {{subject}} {{other}} {{min}} {{max}} {{last}}, plus SillyTavern macros.',
        },
    ]],
    ['Clean-up of the result', [
        { key: 'cleanReasoning', type: 'bool', def: true, label: 'Remove reasoning blocks (<think>, <checklist>, …)' },
        { key: 'cleanHeaders', type: 'bool', def: true, label: 'Remove scene headers ( [ time | day | place ] )' },
        { key: 'cleanPanels', type: 'bool', def: true, label: 'Remove status, tracker and internal-state panels (<details>, <tracker>, <svt>, …)' },
        { key: 'cleanHtml', type: 'bool', def: true, label: 'Remove any remaining HTML tags' },
        { key: 'cleanPreamble', type: 'bool', def: true, label: 'Remove chatty lead-ins ("Sure, here is…") and trailing notes' },
        { key: 'cleanCustom', type: 'area', def: '', label: 'Also remove (one regular expression per line)', placeholder: '/^\\[OOC:[^\\]]*\\]\\s*/gm' },
    ]],
];

const FIELDS = SECTIONS.flatMap(([, fields]) => fields);
// subjectByChat is not shown in the panel: the menu fills it ("Write as" per character or group).
const DEFAULTS = { ...Object.fromEntries(FIELDS.map((f) => [f.key, f.def])), subjectByChat: {} };

/** Refine options on the result bar. */
const REFINES = [
    ['shorter', 'Shorter', 'fa-compress', 'Make it noticeably shorter, about half the length, keeping the key beats.'],
    ['longer', 'Longer', 'fa-expand', 'Make it longer, about one and a half times, with more detail and beats, without moving the story further than it already goes.'],
    ['dialogue', 'More dialogue', 'fa-comments', 'Give it more spoken dialogue, in character.'],
    ['detail', 'More detail', 'fa-eye', 'Add more sensory and descriptive detail.'],
    ['emotion', 'More emotion', 'fa-heart', 'Show more emotion and inner feeling.'],
    ['simpler', 'Simpler wording', 'fa-feather', 'Use simpler, plainer wording.'],
];

const KIND_TITLES = { enhance: 'Enhance my draft', write: 'Write something for me', continue: 'Continue my draft', refine: 'Refine my message' };

const state = {
    busy: false,
    cancelled: false,
    undo: [],       // earlier box texts, newest last
    lastRun: null,  // { kind, text, subject, original, selection, instruction }: what Regenerate and Discard act on
    history: [],    // results of the current Regenerate / Refine chain
    hIdx: 0,
    lastPrompt: '',
    lastOutput: '',
};

class Cancelled extends Error {}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ctx = () => SillyTavern.getContext();
const save = () => ctx().saveSettingsDebounced();
const words = (t) => (String(t || '').match(/\S+/g) || []).length;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const box = () => document.getElementById('send_textarea');

/** The extension's settings, with defaults filled in and keys from older versions dropped. */
function settings() {
    const all = ctx().extensionSettings;
    const s = (all[MODULE] ??= {});
    for (const k of Object.keys(s)) if (!(k in DEFAULTS)) delete s[k];
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = structuredClone(v);
    return s;
}

function setBox(text, focus = true) {
    const ta = box();
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) {
        ta.focus();
        ta.setSelectionRange(text.length, text.length);
    }
}

/** Puts a new text in the box and remembers the old one for Undo. */
function changeBox(text) {
    const old = box()?.value ?? '';
    if (old !== text) state.undo = [...state.undo, old].slice(-20);
    setBox(text);
}

/** Chat messages that are part of the story, oldest first. */
const storyMessages = () => (ctx().chat || []).filter((m) => m && !m.is_system && String(m.mes || '').trim());

function replyIsRunning() {
    const stop = document.getElementById('mes_stop');
    return !!stop && stop.offsetParent !== null && getComputedStyle(stop).display !== 'none';
}

/* ------------------------------------------------------------------ */
/* Write as: you, a character, or the narrator                         */
/* ------------------------------------------------------------------ */

/** Members of the open group chat, as characters. */
function groupMembers() {
    const c = ctx();
    const group = c.groupId ? (c.groups || []).find((g) => String(g.id) === String(c.groupId)) : null;
    return (group?.members || []).map((avatar) => (c.characters || []).find((ch) => ch.avatar === avatar)).filter(Boolean);
}

/** Every "Write as" choice for the open chat: you, the character (or each group member), the narrator. */
function subjectChoices() {
    const members = groupMembers();
    return ['user', ...(members.length ? members.map((m) => `member:${m.avatar}`) : ['char']), 'narrator'];
}

function chatKey() {
    const c = ctx();
    if (c.groupId) return `group:${c.groupId}`;
    const avatar = c.characters?.[c.characterId]?.avatar;
    return avatar ? `char:${avatar}` : null;
}

/** The "Write as" choice for the open chat. */
function currentSubject() {
    const s = settings();
    const key = chatKey();
    const saved = s.rememberSubject && key ? s.subjectByChat[key] : null;
    if (saved && subjectChoices().includes(saved)) return saved;
    return s.subject === 'char' && groupMembers().length ? 'char' : s.subject;
}

/** Turns what a user or slash command typed (user, char, narrator, or a group member's name) into a subject. */
function parseSubject(value) {
    const v = String(value || '').trim();
    if (!v) return null;
    if (['user', 'char', 'narrator'].includes(v.toLowerCase())) return v.toLowerCase();
    if (v.startsWith('member:')) return subjectChoices().includes(v) ? v : null;
    const member = groupMembers().find((m) => m.name.toLowerCase() === v.toLowerCase());
    return member ? `member:${member.avatar}` : null;
}

/** Who the message belongs to, and who must be left alone. */
function roles(subject = 'user') {
    const c = ctx();
    const user = c.name1 || 'User';
    let char = c.name2 || 'the character';
    if (String(subject).startsWith('member:')) {
        char = groupMembers().find((m) => `member:${m.avatar}` === subject)?.name || char;
        subject = 'char';
    }
    if (subject === 'char') return { mode: 'char', who: char, other: user, piece: 'message', user, char };
    if (subject === 'narrator') return { mode: 'narrator', who: 'the narrator', other: user, piece: 'passage', user, char };
    return { mode: 'user', who: user, other: char, piece: 'message', user, char };
}

/* ------------------------------------------------------------------ */
/* The task note                                                       */
/* ------------------------------------------------------------------ */

const LENGTHS = { short: [30, 80], medium: [80, 180], long: [180, 350] };

/** Target word range. Flexible scales with your draft, or with how long that side of the chat usually writes. */
function lengthRange(kind, draftWords, s, r) {
    let lo, hi;
    if (s.length === 'custom') {
        lo = num(s.lengthMin, 60);
        hi = Math.max(num(s.lengthMax, 160), lo + 20);
    } else if (LENGTHS[s.length]) {
        [lo, hi] = LENGTHS[s.length];
    } else if (kind === 'enhance') {
        const d = draftWords;
        if (d < 15) [lo, hi] = [50, 120];              // a line or two: grow it into a full message
        else if (d < 60) [lo, hi] = [d * 1.6, d * 2.6]; // a short paragraph: about double
        else [lo, hi] = [d * 1.1, d * 1.6];            // already detailed: polish, little padding
    } else {
        const recent = storyMessages().filter((m) => !!m.is_user === (r.mode === 'user')).slice(-4);
        const avg = recent.length ? recent.reduce((n, m) => n + words(clean(m.mes, CLEAN_ALL)), 0) / recent.length : 0;
        [lo, hi] = avg ? [Math.max(30, avg * 0.8), Math.max(90, avg * 1.6)] : [60, 150];
    }
    if (kind === 'continue') [lo, hi] = [Math.max(20, lo - draftWords), Math.max(40, hi - draftWords)]; // only the added part
    if (kind === 'enhance') lo = Math.max(lo, draftWords); // never shorter than the draft
    hi = Math.max(hi, lo * 1.15, lo + 20);
    return [Math.round(lo), Math.round(clamp(hi, 40, 2000))];
}

const FAITH = {
    strict: 'Change only the wording and the level of detail. Add no action, decision or line of dialogue that the draft does not already contain.',
    balanced: 'Keep every action, decision and line of dialogue from the draft, in the same order. Small supporting beats (a gesture, a glance, a reaction to the surroundings) are fine; nothing that changes what happens.',
    creative: 'Treat the draft as a skeleton: keep its intent and its key beats, and develop them with richer detail, dialogue and inner thought, as long as nothing contradicts the draft.',
};

const POV = {
    first: 'Write in the first person ("I", "me").',
    second: 'Write in the second person ("you").',
    third: 'Write in the third person (he / she / they).',
};

const FORMAT = {
    asterisks: 'Formatting: actions, narration and thoughts in *single asterisks*, spoken words in "double quotes".',
    plain: 'Formatting: plain prose paragraphs with spoken words in "double quotes". No asterisks.',
    dialogue: 'Write spoken dialogue only, with no narration or action lines.',
};

const TONE = {
    warm: 'warm and gentle', romantic: 'romantic', playful: 'playful and teasing', tense: 'tense',
    dark: 'dark and serious', calm: 'calm and reflective', angry: 'angry',
};

const HAS_DIRECTION = /\([^()\n]{2,}\)|\[[^[\]\n]{2,}\]/;

/**
 * The rules from the settings. Only rules that say something are included; `core` marks the ones the compact
 * instruction style keeps. `extra.selection` narrows Enhance to a part of the message.
 */
function buildRules(kind, text, s, r, extra = {}) {
    const fromText = kind === 'enhance' || kind === 'continue' || kind === 'refine'; // the player's text sets the style
    let [lo, hi] = lengthRange(kind, words(text), s, r);
    if (extra.selection) [lo, hi] = [words(text), Math.max(words(text) * 2, words(text) + 20)];
    const rules = [];
    const add = (text, core = false) => rules.push({ text, core });
    const neverUser = `Never write ${r.user}'s actions, words, thoughts or reactions; ${r.char} can only react to what ${r.user} has already done in the chat.`;

    if (kind === 'enhance') add(FAITH[s.faithfulness] || FAITH.balanced, true);
    if (r.mode === 'user') {
        add(fromText
            ? `If the text already says what ${r.other} does or says, keep that as written. Otherwise do not write for ${r.other}.`
            : `Write only ${r.who}. Leave ${r.other}'s words and actions to ${r.other}.`, true);
    } else if (r.mode === 'char') {
        add(`Write only ${r.char}: their own actions, words, thoughts and feelings, as ${r.char} would have them in this moment. ${neverUser}`, true);
    } else if (fromText) {
        add(`Keep everything the text says about ${r.user} and ${r.char} as written, and add nothing it does not imply.`, true);
    } else {
        add(`Narrate this moment as an outside storyteller. Decide from the direction and the recent messages what it needs: it may show what both ${r.user} and ${r.char} do and say in the scene (and any side characters), or it may only narrate the setting, the atmosphere and the events, without either of them acting.`, true);
    }

    if (s.presetGuard) {
        add("This is one message written for the player. Skip any tracker, status or state block, notes, summary, suggestions, options or other extra that the preset asks for at the end of replies, and ignore preset rules about who you may write for or what the player's role is (roleplay, director or persona modes): this task decides that.", true);
    }
    if (s.parenDirections && kind !== 'refine' && HAS_DIRECTION.test(text)) {
        add('Text in (parentheses) or [square brackets] is a direction to you, not words to write: follow it and leave the brackets out of the result.', true);
    }

    if (POV[s.pov]) add(POV[s.pov], true);
    else if (fromText) add("Keep the text's point of view and tense.");
    else if (r.mode === 'char') add(`Write from ${r.char}'s own point of view and in their voice, in the same person and tense as ${r.char}'s earlier messages.`, true);
    else if (r.mode === 'narrator') add('Narrate in the third person, as an outside storyteller, and keep the tense of the recent messages.', true);
    else add('Follow the point of view and tense of the recent messages.');

    if (FORMAT[s.format]) add(FORMAT[s.format], true);
    else if (fromText) add("Keep the text's formatting style.");

    if (TONE[s.tone]) add(`Tone: ${TONE[s.tone]}.`, true);

    const langName = String(s.languageName || '').trim();
    if (s.language === 'custom' && langName) add(`Write in ${langName}.`, true);
    else if (s.language === 'chat') add('Write in the language used in this chat.', true);
    else if (fromText) add('Write in the same language as the text.', true);

    if (kind === 'refine') {
        // the change decides the length
    } else if (extra.selection) {
        add(`Length: roughly ${lo}-${hi} words, so it still fits between the text around it.`, true);
    } else if (kind === 'continue') {
        add(`Length of the part you add: roughly ${lo}-${hi} words.`, true);
    } else if (s.length !== 'flexible') {
        add(`Length: about ${lo}-${hi} words.`, true);
    } else if (kind === 'enhance') {
        add(`Length: as long as the draft's content needs, roughly ${lo}-${hi} words. A short draft becomes a full message; a detailed one is polished without padding.`, true);
    } else {
        add(`Length: as long as this moment needs, roughly ${lo}-${hi} words.`, true);
    }

    if (s.noRepeat) add('Do not repeat wording or descriptions from the recent messages.');
    if (s.endOpen && !extra.selection) add(`Stop where ${r.mode === 'user' ? r.other : r.user} would answer, leaving the turn open.`, true);
    return { rules, lo, hi };
}

/**
 * The last message of the chat. Big presets put pages of instructions between the chat history and the end of the
 * prompt, so the model can lose the thread; repeating it next to the task keeps the message on the current moment.
 */
function lastBeat(r, max) {
    const msg = storyMessages().pop();
    let text = msg ? clean(msg.mes, CLEAN_ALL) : '';
    if (!text) return null;
    if (text.length > max) text = `…${text.slice(-max).replace(/^\S*\s/, '')}`; // the end matters most
    const speaker = msg.name || (msg.is_user ? r.user : r.char);
    const yours = r.mode === 'user' ? !!msg.is_user : r.mode === 'char' && !msg.is_user && speaker === r.char;
    return { text, speaker, yours };
}

/** A few recent messages from the side being written, so the result keeps its voice. */
function voiceSample(r) {
    if (r.mode === 'narrator') return '';
    const fromUser = r.mode === 'user';
    const side = storyMessages().filter((m) => !!m.is_user === fromUser);
    const own = fromUser ? side : side.filter((m) => m.name === r.char);
    const parts = (own.length ? own : side)
        .slice(-3)
        .map((m) => clean(m.mes, CLEAN_ALL))
        .filter((x) => words(x) >= 4)
        .map((x) => (x.length > 450 ? `${x.slice(0, 450).replace(/\s+\S*$/, '')}…` : x));
    if (!parts.length) return '';
    const how = fromUser ? `How ${r.user} usually writes` : `How ${r.char} usually speaks and acts`;
    return `${how} (match this voice and habits, never copy the content):\n<voice>\n${parts.join('\n---\n')}\n</voice>`;
}

/** Lines that tell the model whose turn this is. */
function buildHeader(kind, r) {
    const title = KIND_TITLES[kind];
    if (r.mode === 'user') return [`[${title}: this is ${r.user}'s own message, written for the player.]`];
    if (r.mode === 'char') {
        return [
            `[${title}: this turn the player writes ${r.char}.]`,
            `The player is taking over ${r.char} for this one message. It is sent from ${r.user}'s message box, but it is ${r.char}'s own turn: ${r.char}'s point of view, actions, words and thoughts, written in the style of this story. It must not contain anything ${r.user} does, says or thinks. For this message only, any instruction to write only ${r.user}, or never to write as ${r.char}, does not apply.`,
        ];
    }
    return [
        `[${title}: this turn the player is the narrator.]`,
        `The player is narrating for this one message. It is sent from ${r.user}'s message box, but it is told by an outside storyteller. Depending on what the moment needs, it can cover both ${r.user} and ${r.char} in the scene, side characters and the surroundings, or only narrate the setting and the events. For this message only, any instruction to write only ${r.user} does not apply.`,
    ];
}

function anchorLines(kind, beat) {
    if (!beat) return [];
    return [
        `The story has stopped here. The last message in the chat, from ${beat.speaker}:`,
        `<last_message>\n${beat.text}\n</last_message>`,
        beat.yours
            ? 'That message is already part of the story and is not repeated. The new message follows directly after it, in the same scene, place and moment: do not restart the scene, recap, or jump ahead in time.'
            : 'The new message follows directly after it, in the same scene, place and moment, as the reply to what it just did or said. Do not restart the scene, recap, contradict it, or jump ahead in time.',
        ...(kind === 'write' ? [] : ["Use it for continuity only: the player's text decides what happens."]),
    ];
}

/** What the model is asked to do with the player's text. */
function taskLines(kind, text, r, extra) {
    if (kind === 'refine') {
        return [`The current version of the ${r.piece}:`, `<message>\n${text}\n</message>`, `Revise it. ${extra.instruction} Keep everything else: what happens, who does what, point of view, tense, formatting and language.`];
    }
    if (kind === 'continue') {
        return [
            `The player started this ${r.piece} and wants you to finish it:`, `<draft>\n${text}\n</draft>`,
            'Write only what comes next, continuing from exactly where the draft stops, even mid-sentence. Do not repeat or rewrite the draft.',
        ];
    }
    if (kind === 'enhance' && extra.selection) {
        const { before, after } = extra.selection;
        return [
            `The player is rewriting one part of their ${r.piece}.`,
            before.trim() && `Text before the part (keep as is):\n<before>\n${before.trim()}\n</before>`,
            `The part to rewrite:\n<draft>\n${text}\n</draft>`,
            after.trim() && `Text after the part (keep as is):\n<after>\n${after.trim()}\n</after>`,
            'Rewrite only the part, so it reads naturally between the text around it. Output only the rewritten part.',
        ].filter(Boolean);
    }
    if (kind === 'enhance') {
        return ['The player drafted this:', `<draft>\n${text}\n</draft>`, `Rewrite it into the finished ${r.piece}, following your instructions and the style of this story.`];
    }
    return [text ? `Follow the player's direction closely:\n<direction>\n${text}\n</direction>` : ''];
}

/**
 * The note added as the last message. It says only what the preset cannot know: the task, your text, the rules from
 * your settings and your notes. Everything else comes from the preset.
 */
function buildNote(kind, text, s, extra = {}) {
    const r = roles(extra.subject ?? s.subject);
    const { rules, lo, hi } = buildRules(kind, text, s, r, extra);
    const notes = String((kind === 'enhance' ? s.notesEnhance : kind === 'refine' ? '' : s.notesWrite) || '').trim();
    const custom = String((kind === 'enhance' && !extra.selection ? s.templateEnhance : kind === 'write' ? s.templateWrite : '') || '').trim();

    if (custom) {
        const map = {
            draft: text, direction: text, notes, subject: r.who, other: r.other, min: String(lo), max: String(hi),
            rules: rules.map((x) => `- ${x.text}`).join('\n'),
            last: lastBeat(r, 900)?.text ?? '',
        };
        return ctx().substituteParams(custom.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in map ? map[key] : whole)));
    }

    if (s.instructionStyle === 'compact') {
        const who = r.mode === 'narrator' ? "the narrator's" : `${r.who}'s`;
        const beat = s.anchor && lastBeat(r, 450);
        const opening = {
            enhance: `Rewrite this draft as ${who} finished ${r.piece}, in the style of this story:`,
            write: `Write ${who} next ${r.piece}${text ? ', following this direction:' : ', continuing naturally from the last message.'}`,
            continue: `Finish ${who} ${r.piece}: write only what comes after this draft, from exactly where it stops.`,
            refine: `Revise ${who} ${r.piece}. ${extra.instruction} Keep everything else the same.`,
        }[kind];
        const tag = { enhance: 'draft', write: 'direction', continue: 'draft', refine: 'message' }[kind];
        return [
            opening,
            beat && `Story so far ends with this message from ${beat.speaker}; continue directly from it, same scene and moment:\n<last_message>\n${beat.text}\n</last_message>`,
            extra.selection && 'Only this part of the message is rewritten; output only the rewritten part.',
            text && `<${tag}>\n${text}\n</${tag}>`,
            rules.filter((x) => x.core).map((x) => x.text).join(' '),
            notes && `Notes: ${notes}`,
            `Output only the ${extra.selection ? 'rewritten part' : kind === 'continue' ? 'new part' : r.piece} itself.`,
        ].filter(Boolean).join('\n');
    }

    const beat = s.anchor ? lastBeat(r, 900) : null;
    return [
        ...buildHeader(kind, r),
        ...anchorLines(kind, beat),
        ...taskLines(kind, text, r, extra),
        kind === 'write' && !text && !beat && 'Continue naturally from the last message.',
        rules.map((x) => `- ${x.text}`).join('\n'),
        s.voiceMatch && kind !== 'refine' && voiceSample(r),
        notes && `Player's notes: ${notes}`,
        `Output only the ${extra.selection ? 'rewritten part' : kind === 'continue' ? 'new part' : r.piece} itself: no scene header, status block, notes or reasoning.`,
    ].filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ */
/* Cleaning the result                                                 */
/* ------------------------------------------------------------------ */

const CLEAN_ALL = { cleanReasoning: true, cleanHeaders: true, cleanPanels: true, cleanHtml: true };

const THINK = 'think|thinking|reasoning|thought|thoughts|checklist|cot|analysis|planning|internal_monologue';
// Panels and trackers that presets ask for at the end of every reply. The short names (dy, ob, cs, ...) are the
// mini-tags of tag trackers such as <svt>, <trk> and <bst>; their content goes too, not only the tags.
const TRACKERS = 'tracker|trackers|svt|trk|bst|world_activity|money_tracker|inventory|subtext|objective_tracker|plot_director|brainstormer|trope_spotter|chaos_suggester|plot_threads|narrative_mode|director_notes|story_notes';
const TRACKER_TAGS = 'dy|ob|ph|in|at|wl|hg|th|ai|cs|lc|tm|wx|bg|ch|sx|dt';
const PANELS = `details|summary|internal_states|internal_state|status|stats|style|script|table|ooc|${TRACKERS}|${TRACKER_TAGS}`;
const reThinkPair = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
const reThinkBefore = new RegExp(`^[\\s\\S]*?<\\/(${THINK})>`, 'i'); // reasoning whose opening tag was a prefill
const reThinkOpen = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*$`, 'i'); // reasoning cut off at the end
const rePanelPair = new RegExp(`<(${PANELS})\\b[^>]*>(?:(?!<(?:${PANELS})\\b)[\\s\\S])*?<\\/\\1\\s*>`, 'gi'); // innermost
const rePanelOpen = new RegExp(`<(${PANELS})\\b[\\s\\S]*$`, 'i'); // a panel cut off at the end
// Tags that are ordinary formatting in a message; any other tag-wrapped block at the very end is an extra.
const KEEP_TAGS = new Set('a b i u s em strong span p br hr sub sup small big mark del ins ul ol li blockquote code pre font center q cite'.split(' '));

/** Turns "/pattern/flags" (or a bare pattern) into a RegExp, or null. */
function parseRegex(line) {
    const t = String(line).trim();
    if (!t) return null;
    try {
        const m = t.match(/^\/(.*)\/([gimsuy]*)$/s);
        return m ? new RegExp(m[1], m[2] || 'g') : new RegExp(t, 'g');
    } catch (err) {
        console.warn(TAG, 'bad clean-up pattern:', t, err);
        return null;
    }
}

/**
 * Presets differ in how they ask for trackers and notes, but the extras always come at the very end, wrapped in their
 * own tag. Removes such blocks, whatever their name, unless the tag is ordinary formatting.
 */
function stripTrailingBlocks(text) {
    let t = text.trimEnd();
    for (let i = 0; i < 6; i++) {
        const m = t.match(/<\/([a-z][\w-]*)\s*>$/i);
        if (!m || KEEP_TAGS.has(m[1].toLowerCase())) break;
        const start = t.search(new RegExp(`<${m[1]}\\b[^>]*>(?![\\s\\S]*<${m[1]}\\b)`, 'i')); // its last opening tag
        const before = start > 0 ? t.slice(0, start).trimEnd() : '';
        if (!before) break; // the whole message is that block: leave it to the other steps
        t = before;
    }
    return t;
}

/** Removes reasoning, preset extras and wrapper noise, according to the clean-up settings. */
function clean(raw, s) {
    let t = String(raw ?? '');
    if (s.cleanReasoning) t = t.replace(reThinkPair, '').replace(reThinkBefore, '').replace(reThinkOpen, '');
    t = t.trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
    if (s.cleanPanels) {
        t = t.replace(/<!--[\s\S]*?-->/g, '');
        for (let i = 0, prev; i < 20 && prev !== t; i++) {
            prev = t;
            t = t.replace(rePanelPair, '');
        }
        t = stripTrailingBlocks(t.replace(rePanelOpen, '').replace(/^[ \t]*💰[^\n]*$/gmu, '')); // "💰 Currency: 20" lines
    }
    if (s.cleanHtml) t = t.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, '');
    if (s.cleanHeaders) t = t.replace(/^\s*\[[^\]\n]*\|[^\]\n]*\|[^\]\n]*\]\s*$/gm, '');
    for (const line of String(s.cleanCustom || '').split('\n')) {
        const re = parseRegex(line);
        if (re) t = t.replace(re, '');
    }
    t = t.replace(/<\/?(draft|direction|voice|last_message|message|before|after)>/gi, '');
    if (s.cleanPreamble) {
        t = t
            .replace(/^\s*\(answer\)[ \t]*\n?/i, '') // placeholder some reasoning templates end with
            .replace(/^\s*(?:sure|certainly|of course|okay|ok|alright|here(?:'s| is| are))\b[^\n]{0,160}:[ \t]*\n+/i, '')
            .replace(/\n+[ \t]*[[(*_]*(?:note|word count|author'?s note|n\.b\.)\s*[:：][^\n]*$/i, '');
    }
    t = t.replace(/^\s*(?:\*\*)?(?:rewritten|enhanced|revised|final|continuation)(?: (?:message|draft|reply|version|part))?(?:\*\*)?\s*:\s*(?:\*\*)?/i, '');
    const { user, char } = roles();
    for (const n of [user, char]) t = t.replace(new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The same clean-up for text that is still streaming in: a half-written tag at the end is hidden too. */
const cleanPartial = (raw, s) => clean(String(raw ?? '').replace(/<[^>\n]*$/, ''), s);

/**
 * A reply that hit the token limit stops mid-sentence. Cuts it back to the last full sentence, but only when the
 * unfinished tail is a small part of the text (at most 20%).
 */
function trimUnfinished(t) {
    const text = String(t || '').trimEnd();
    if (!/[\p{L}\p{N},;:\-–—]$/u.test(text)) return text; // ends in punctuation, a marker or an emoji: looks finished
    const m = [...text.matchAll(/[.!?…]+[*_"'”’»)\]]*(?=\s|$)/g)].pop();
    if (!m) return text;
    const cut = m.index + m[0].length;
    return cut >= text.length * 0.8 ? text.slice(0, cut).trimEnd() : text;
}

/**
 * Joins the player's draft and the part the model added. When the model wrote the whole message again, draft
 * included (often with its own formatting, such as *asterisks*), its version is used as it is.
 */
function joinContinuation(draft, added) {
    const letters = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (letters(draft) && letters(added).startsWith(letters(draft))) return added;
    const rest = added.replace(/^[ \t]+/, '');
    if (!rest) return draft;
    const glue = /\s$/.test(draft) || /^[\s,.;:!?…'"’”)\]]/.test(rest) ? '' : ' ';
    return draft + glue + rest;
}

/** Puts a result back together with what stayed in the box: the draft for Continue, the text around a selection. */
function assemble(run, result) {
    if (run.kind === 'continue') return joinContinuation(run.text, result);
    if (run.selection) return run.selection.before + run.selection.lead + result + run.selection.trail + run.selection.after;
    return result;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Removes the preset's impersonation prompt ("write as {{user}}, never as {{char}}") from an assembled prompt. Used
 * only when writing as a character or the narrator, where it says the opposite of the task.
 */
function stripImpersonationPrompt(messages) {
    const c = ctx();
    const needle = String(c.substituteParams(String(c.chatCompletionSettings?.impersonation_prompt || ''))).trim();
    if (!needle) return;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (typeof m?.content !== 'string' || !m.content.includes(needle)) continue;
        m.content = m.content.split(needle).join('').trim();
        if (!m.content) messages.splice(i, 1);
    }
}

async function slash(command) {
    const r = await ctx().executeSlashCommandsWithOptions(command, { handleParserErrors: false, handleExecutionErrors: false });
    return String(r?.pipe ?? '');
}

const quoteArg = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

async function profileInfo(name) {
    try {
        return JSON.parse(await slash(`/profile-get ${quoteArg(name)}`));
    } catch {
        return null;
    }
}

/** What the connection is right now, in the terms a connection profile uses. */
function liveConnection() {
    const c = ctx();
    const cs = c.chatCompletionSettings || {};
    return {
        api: c.mainApi === 'openai' ? cs.chat_completion_source : c.mainApi,
        model: c.getChatCompletionModel?.() ?? '',
        url: cs.chat_completion_source === 'custom' ? cs.custom_url : undefined,
        preset: $('#settings_preset_openai option:selected').text(),
    };
}

/** True when the connection is set up the way the saved profile says (fields the profile does not save are ignored). */
function matchesProfile(profile) {
    const live = liveConnection();
    const same = (a, b) => !a || String(a) === String(b ?? '');
    return profile?.mode === 'cc' && same(profile.api, live.api) && same(profile.model, live.model)
        && (live.url === undefined || same(profile['api-url'], live.url)) && same(profile.preset, live.preset);
}

/**
 * Runs `fn` with the drafting connection profile, then switches back. This is only safe when the connection you are
 * using is exactly a saved profile: switching back loads that profile, so anything changed since it was saved (another
 * model, another preset) would be lost. In every other case the current connection is used, with a warning.
 */
async function withProfile(name, fn) {
    const c = ctx();
    if (!name || !c.SlashCommandParser?.commands?.profile) return fn();
    const current = await slash('/profile').catch(() => '');
    if (current === name) return fn();
    const warn = (why) => {
        toastr.warning(`${why} Drafting with the current connection.`, TITLE, { timeOut: 7000 });
        return fn();
    };
    if (!current || current === NO_PROFILE) return warn('To draft with another connection profile, your main connection must be a saved profile too, so it can be switched back.');
    if (!matchesProfile(await profileInfo(current))) return warn(`Your connection has changed since the profile "${current}" was saved, so switching back to it would not restore it. Update that profile in the Connection Manager first.`);
    const target = await profileInfo(name);
    if (target?.mode !== 'cc' || c.mainApi !== 'openai') return warn(`Connection profile "${name}" was not found, or is not a Chat Completion profile.`);

    const applied = async (profile) => {
        await slash(`/profile await=true timeout=8000 ${quoteArg(profile.name)}`);
        // The profile is applied in steps; wait until the connection really is the profile before generating.
        for (let i = 0; i < 40 && !(matchesProfile(profile) && ctx().onlineStatus !== 'no_connection'); i++) await new Promise((r) => setTimeout(r, 200));
        return matchesProfile(profile);
    };
    const back = await profileInfo(current);
    try {
        if (!(await applied(target))) throw new Error(`Could not switch to the connection profile "${name}".`);
        return await fn();
    } finally {
        if (!(await applied(back).catch(() => false))) toastr.error(`Could not switch back to the connection profile "${current}". Check your connection.`, TITLE);
    }
}

/**
 * Runs SillyTavern's Impersonate with the note as the last message. With Chat Completion the note is appended to the
 * finished prompt, after every preset prompt, tracker and reasoning template, so nothing the preset adds at the end
 * can outrank it. Other APIs get it injected at depth 0. While the reply streams in, the box shows it cleaned and put
 * together with the rest of your text (`display`).
 */
async function generate(note, r, s, display) {
    const c = ctx();
    const ta = box();
    state.lastPrompt = note;
    const event = c.eventTypes.CHAT_COMPLETION_PROMPT_READY;
    const chatCompletion = c.mainApi === 'openai' && !!event;
    const onReady = (data) => {
        if (data?.dryRun || !Array.isArray(data?.chat)) return;
        if (r.mode !== 'user') stripImpersonationPrompt(data.chat);
        data.chat.push({ role: 'user', content: note });
    };

    let raw = '';
    let rewriting = false;
    const onInput = () => {
        if (rewriting) return;
        raw = ta.value;
        if (!s.liveClean) return;
        rewriting = true;
        ta.value = display(cleanPartial(raw, s));
        rewriting = false;
    };

    const placeholder = ta.placeholder;
    ta.placeholder = `${TITLE} is writing…`;
    setBox('', false); // SillyTavern writes the reply into the empty box
    ta.addEventListener('input', onInput);
    if (chatCompletion) c.eventSource.on(event, onReady);
    else c.setExtensionPrompt(NOTE_KEY, note, 1 /* in chat */, 0 /* depth */, false, 1 /* user role */);
    try {
        const ret = await c.generate('impersonate', {});
        raw ||= ta.value; // no input event: the box holds the reply as SillyTavern wrote it
        return raw.trim() ? raw : String(ret ?? '');
    } finally {
        ta.removeEventListener('input', onInput);
        ta.placeholder = placeholder;
        if (chatCompletion) c.eventSource.removeListener(event, onReady);
        else c.setExtensionPrompt(NOTE_KEY, '', 1, 0, false, 1);
    }
}

function cancel() {
    if (!state.busy) return;
    state.cancelled = true;
    try {
        ctx().stopGeneration();
    } catch (err) {
        console.warn(TAG, err);
    }
}

/** The part of the box that is selected, when Enhance should work on that part only. */
function boxSelection() {
    const ta = box();
    if (!ta || ta.selectionStart === ta.selectionEnd) return null;
    const value = ta.value;
    const picked = value.slice(ta.selectionStart, ta.selectionEnd);
    if (!picked.trim() || picked.trim() === value.trim()) return null;
    return {
        before: value.slice(0, ta.selectionStart),
        after: value.slice(ta.selectionEnd),
        lead: picked.match(/^\s*/)[0],
        trail: picked.match(/\s*$/)[0],
        text: picked.trim(),
    };
}

/**
 * Enhance, Write, Continue or Refine.
 * opts.original       the text Discard restores (the box before the first run)
 * opts.restoreOnError what goes back in the box if this attempt fails
 * opts.fromBar        started from the result bar (Regenerate or Refine)
 * opts.selection      for Enhance: the selected part of the box and the text around it
 * opts.instruction    for Refine: the change to make
 */
async function run(kind, overrideText, overrideSubject, opts = {}) {
    const s = settings();
    if (!s.enabled) return null;
    if (state.busy) return cancel(), null;

    const c = ctx();
    if (c.characterId === undefined && !c.groupId) return toastr.warning('Open a chat first.', TITLE), null;
    if (replyIsRunning()) return toastr.warning('Wait for the current reply to finish.', TITLE), null;

    const original = opts.original ?? (box()?.value ?? '');
    const selection = kind === 'enhance' && overrideText === undefined && !opts.fromBar ? boxSelection() : opts.selection ?? null;
    let text = selection ? selection.text : String(overrideText ?? original).trim();
    if ((kind === 'enhance' || kind === 'continue') && !text) {
        if (!s.emptyToWrite) return toastr.warning('Type a draft in the message box first.', TITLE), null;
        kind = 'write'; // nothing to work on: write the next message instead
    }
    if (kind === 'continue') text = String(overrideText ?? original).replace(/\s+$/, ''); // keep the draft exactly as typed
    const subject = parseSubject(overrideSubject) ?? currentSubject();
    const r = roles(subject);
    const runInfo = { kind, text, subject, original, selection, instruction: opts.instruction };
    const restore = opts.restoreOnError ?? box()?.value ?? original;

    state.busy = true;
    state.cancelled = false;
    closeDialogs();
    if (opts.fromBar) setBarWorking(true);
    else hideBar();
    updateButton();

    try {
        let result = '';
        const note = buildNote(kind, text, s, { subject, selection, instruction: opts.instruction });
        const display = (partial) => (partial ? assemble(runInfo, partial) : '');
        await withProfile(s.profile, async () => {
            const attempts = 1 + clamp(num(s.retries, 1), 0, 3);
            for (let i = 0; i < attempts && !result; i++) {
                let raw;
                try {
                    raw = await generate(note, r, s, display);
                } finally {
                    if (state.cancelled) throw new Cancelled(); // eslint-disable-line no-unsafe-finally
                }
                state.lastOutput = String(raw ?? '');
                if (s.debug) console.log(TAG, `${kind}, as ${subject}, attempt ${i + 1}\n--- note ---\n${note}\n--- raw output ---\n${state.lastOutput}`);
                result = clean(raw, s);
                if (result && s.trimUnfinished) result = trimUnfinished(result);
            }
        });
        if (!result) throw new Error('The model returned nothing usable. Check the connection, or raise the response length if your model uses reasoning.');

        const full = assemble(runInfo, result);
        setBox(restore, false); // so Undo goes back to what was there before this run
        changeBox(full);
        state.lastRun = runInfo;
        state.history = [...(opts.fromBar ? state.history : []), full].slice(-8);
        state.hIdx = state.history.length - 1;
        if (s.autoSend) {
            hideBar();
            document.getElementById('send_but')?.click();
        } else if (s.actionBar) {
            showBar();
        } else {
            toastr.success({ enhance: 'Draft enhanced', write: 'Message written', continue: 'Draft continued', refine: 'Message refined' }[kind], TITLE, { timeOut: 1500 });
        }
        return full;
    } catch (err) {
        setBox(restore, false); // never lose what was in the box
        if (opts.fromBar) showBar(); // a failed Regenerate or Refine keeps the earlier result and the bar
        if (err instanceof Cancelled) {
            toastr.info('Cancelled', TITLE, { timeOut: 1500 });
        } else {
            console.error(TAG, err);
            toastr.error(String(err?.message || err), TITLE);
        }
        return null;
    } finally {
        state.busy = false;
        setBarWorking(false);
        updateButton();
    }
}

function undo() {
    closeDialogs();
    hideBar();
    if (!state.undo.length) return toastr.info('Nothing to undo.', TITLE, { timeOut: 1500 });
    setBox(state.undo.pop());
}

/* ------------------------------------------------------------------ */
/* Result bar: ‹ 1/2 › Keep / Regenerate / Refine / Discard            */
/* ------------------------------------------------------------------ */

function showBar() {
    if (!settings().actionBar) return;
    const n = state.history.length;
    $('#de_bar .de-nav').toggleClass('displayNone', n < 2);
    $('#de_bar .de-count').text(`${state.hIdx + 1}/${n}`);
    $('#de_bar [data-bar="prev"]').toggleClass('de-disabled', state.hIdx <= 0);
    $('#de_bar [data-bar="next"]').toggleClass('de-disabled', state.hIdx >= n - 1);
    const el = document.getElementById('de_bar');
    if (el?.classList.contains('displayNone')) {
        el.classList.remove('displayNone', 'de-working');
        animateIn(el);
    }
}

const hideBar = () => $('#de_bar').addClass('displayNone').removeClass('de-working');
const setBarWorking = (on) => $('#de_bar').toggleClass('de-working', on);

function barAction(action) {
    const last = state.lastRun;
    if (action === 'keep') {
        hideBar();
        return box()?.focus();
    }
    if (action === 'prev' || action === 'next') {
        const i = state.hIdx + (action === 'next' ? 1 : -1);
        if (i < 0 || i >= state.history.length) return;
        state.hIdx = i;
        setBox(state.history[i]);
        return showBar();
    }
    if (action === 'refine') return toggleDialog('de_refine', document.querySelector('#de_bar [data-bar="refine"]'));
    if (action === 'discard' || !last) {
        state.history = [];
        if (last) changeBox(last.original);
        return hideBar();
    }
    // Regenerate: the same request again
    return run(last.kind, last.kind === 'continue' || last.kind === 'refine' ? last.text : last.selection ? undefined : last.text, last.subject, {
        original: last.original, fromBar: true, selection: last.selection, instruction: last.instruction,
    });
}

/** Refine: changes the result that is in the box now (including your own edits) in one way. */
function refine(instruction) {
    const last = state.lastRun;
    const current = (box()?.value ?? '').trim();
    if (!current || !instruction) return;
    closeDialogs();
    return run('refine', current, last?.subject, { original: last?.original ?? current, fromBar: true, instruction });
}

/* ------------------------------------------------------------------ */
/* Button, menu and refine popup                                       */
/* ------------------------------------------------------------------ */

/*
 * The popups fade like SillyTavern's own menus: 125 ms, and not at all with reduced motion. The duration lives in a
 * CSS variable so the stylesheet and the close timer agree.
 */
function animMs() {
    const reduced = document.body.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = reduced ? 0 : 125;
    document.documentElement.style.setProperty('--de-anim', `${ms}ms`);
    return ms;
}

/** Replays the appear animation. */
function animateIn(el) {
    animMs();
    el.classList.remove('de-in', 'de-out');
    void el.offsetWidth; // restarts the CSS animation
    el.classList.add('de-in');
}

const DIALOGS = ['de_menu', 'de_refine'];
const anchors = {};
const closeTimers = {};

function closeDialog(id, instant = false) {
    const m = document.getElementById(id);
    if (!m?.open) return;
    clearTimeout(closeTimers[id]);
    const done = () => {
        m.classList.remove('de-in', 'de-out');
        m.close();
    };
    const ms = instant ? 0 : animMs();
    if (!ms) return done();
    m.classList.remove('de-in');
    m.classList.add('de-out');
    closeTimers[id] = setTimeout(done, ms);
}

const closeDialogs = (instant = false) => DIALOGS.forEach((id) => closeDialog(id, instant));

/** Keeps a popup next to the control that opened it, above it when there is room, and inside the screen. */
function placeDialog(id) {
    const m = document.getElementById(id);
    const b = anchors[id]?.getBoundingClientRect();
    if (!m?.open || !b?.width) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const left = clamp(b.left, 8, Math.max(8, vw - m.offsetWidth - 8));
    let top = b.top - m.offsetHeight - 8;
    if (top < 8) top = clamp(b.bottom + 8, 8, Math.max(8, innerHeight - m.offsetHeight - 8)); // no room above
    m.style.cssText = `left:${Math.round(left)}px;top:${Math.round(top)}px`;
}

/*
 * The popups are <dialog> elements opened with showModal(): the browser's top layer is positioned against the screen,
 * so themes that transform the page cannot push them away.
 */
function toggleDialog(id, anchor) {
    const m = document.getElementById(id);
    if (!m || !anchor) return;
    if (m.classList.contains('de-out')) {
        clearTimeout(closeTimers[id]); // caught on the way out: bring it straight back
        refreshMenu();
        return animateIn(m);
    }
    if (m.open) return closeDialog(id);
    closeDialogs(true);
    anchors[id] = anchor;
    refreshMenu();
    m.classList.toggle('de-touch', matchMedia('(pointer: coarse)').matches);
    m.style.cssText = 'visibility:hidden;left:0;top:0';
    m.showModal();
    placeDialog(id);
    requestAnimationFrame(() => placeDialog(id)); // again once layout has settled
    animateIn(m);
}

function updateButton() {
    const on = !!settings().enabled;
    if (!on) hideBar();
    $('#de_button')
        .toggleClass('displayNone', !on)
        .toggleClass('fa-feather-pointed', !state.busy)
        .toggleClass('fa-spinner fa-spin de-busy', state.busy)
        .attr('title', state.busy ? 'Working… tap to cancel' : TITLE);
    $('#de_ext_enhance, #de_ext_write, #de_ext_continue').toggleClass('displayNone', !on);
}

function subjectName(subject) {
    const r = roles(subject);
    return r.mode === 'narrator' ? 'Narrator' : r.who;
}

function refreshMenu() {
    const s = settings();
    $('#de_menu .de-subject').text(`Writing as: ${subjectName(currentSubject())}`);
    $('#de_menu [data-action="undo"]').toggleClass('de-disabled', !state.undo.length);
    $('#de_menu kbd').toggleClass('displayNone', !s.shortcuts);
}

/** Next "Write as" choice: per character or group when remembered, otherwise the default. */
function cycleSubject() {
    const s = settings();
    const choices = subjectChoices();
    const now = currentSubject();
    const i = choices.indexOf(now === 'char' && choices[1]?.startsWith('member:') ? choices[1] : now);
    const next = choices[(i + 1) % choices.length];
    const key = chatKey();
    if (s.rememberSubject && key) {
        s.subjectByChat[key] = next;
    } else {
        s.subject = next.startsWith('member:') ? 'char' : next;
        $('#de_settings [data-key="subject"]').val(s.subject);
    }
    save();
    refreshMenu();
}

function buildUI() {
    closeDialogs(true);
    $('#de_button, #de_menu, #de_refine, #de_bar, #de_ext_enhance, #de_ext_write, #de_ext_continue').remove();

    // Right above the message box, where SillyTavern puts its own confirm bar.
    const bar = `
        <div id="de_bar" class="de-bar displayNone">
            <div class="de-nav displayNone">
                <div class="de-bar-btn de-bar-nav" data-bar="prev" title="Previous result"><i class="fa-solid fa-chevron-left"></i></div>
                <span class="de-count"></span>
                <div class="de-bar-btn de-bar-nav" data-bar="next" title="Next result"><i class="fa-solid fa-chevron-right"></i></div>
            </div>
            <div class="de-bar-btn de-bar-keep" data-bar="keep" title="Keep"><i class="fa-solid fa-check"></i><span>Keep</span></div>
            <div class="de-bar-btn" data-bar="regenerate" title="Regenerate"><i class="fa-solid fa-rotate"></i><span>Regenerate</span></div>
            <div class="de-bar-btn" data-bar="refine" title="Refine"><i class="fa-solid fa-sliders"></i><span>Refine</span></div>
            <div class="de-bar-btn de-bar-discard" data-bar="discard" title="Discard"><i class="fa-solid fa-xmark"></i><span>Discard</span></div>
        </div>`;
    if ($('#send_form').length) $('#send_form').before(bar);
    else $('#form_sheld').append(bar);

    ($('#leftSendForm').length ? $('#leftSendForm') : $('#send_form')).append(
        `<div id="de_button" class="fa-solid fa-feather-pointed interactable" tabindex="0" role="button" title="${TITLE}"></div>`,
    );

    const item = (action, icon, label, key) =>
        `<div class="de-item" data-action="${action}"><i class="fa-solid ${icon}"></i><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</div>`;
    $('body').append(`
        <dialog id="de_menu" class="de-menu" aria-label="${TITLE}">
            <div class="de-menu-inner">
                ${item('enhance', 'fa-wand-magic-sparkles', 'Enhance my draft', 'Alt+E')}
                ${item('write', 'fa-pen-nib', 'Write something for me', 'Alt+W')}
                ${item('continue', 'fa-forward', 'Continue my draft', 'Alt+C')}
                <div class="de-sep"></div>
                ${item('subject', 'fa-masks-theater', '<span class="de-subject"></span>')}
                ${item('undo', 'fa-rotate-left', 'Undo last change', 'Alt+Z')}
            </div>
        </dialog>
        <dialog id="de_refine" class="de-menu" aria-label="Refine">
            <div class="de-menu-inner">
                ${REFINES.map(([id, label, icon]) => item(`refine:${id}`, icon, label)).join('')}
                <div class="de-sep"></div>
                <form class="de-refine-own"><input type="text" class="text_pole" placeholder="Or say what to change…" aria-label="Your change"><button type="submit" class="menu_button fa-solid fa-arrow-right" title="Refine"></button></form>
            </div>
        </dialog>`);

    if (settings().wandMenu) {
        const ext = (id, icon, label) =>
            `<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span></div>`;
        $('#extensionsMenu').append(
            ext('de_ext_enhance', 'fa-wand-magic-sparkles', 'Enhance my draft'),
            ext('de_ext_write', 'fa-pen-nib', 'Write something for me'),
            ext('de_ext_continue', 'fa-forward', 'Continue my draft'),
        );
    }
    updateButton();
}

/*
 * Touch screens can deliver the same tap twice; the echo is ignored. The window is short for the "Write as" cycler,
 * which is meant to be tapped repeatedly, and longer for controls that start work.
 */
let lastTap = { key: '', at: 0 };
function duplicateTap(key, within = 300) {
    const now = Date.now();
    if (lastTap.key === key && now - lastTap.at < within) return true;
    lastTap = { key, at: now };
    return false;
}

function onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest('#de_button')) {
        if (!duplicateTap('button')) state.busy ? cancel() : toggleDialog('de_menu', document.getElementById('de_button'));
        return;
    }
    const item = t.closest('.de-menu .de-item');
    if (item) {
        const action = item.dataset.action;
        if (item.classList.contains('de-disabled') || duplicateTap(action, action === 'subject' ? 60 : 300)) return;
        if (action === 'subject') return cycleSubject(); // the menu stays open
        if (action === 'undo') return undo();
        if (action.startsWith('refine:')) return refine(REFINES.find(([id]) => `refine:${id}` === action)?.[3]);
        return run(action);
    }
    const barBtn = t.closest('#de_bar [data-bar]');
    if (barBtn) {
        if (!duplicateTap(`bar:${barBtn.dataset.bar}`)) barAction(barBtn.dataset.bar);
        return;
    }
    const ext = t.closest('#de_ext_enhance, #de_ext_write, #de_ext_continue');
    if (ext) {
        if (duplicateTap(ext.id)) return;
        $('#extensionsMenu').hide();
        return run(ext.id.replace('de_ext_', ''));
    }
    if (t.closest('#send_but')) hideBar(); // the message is on its way out
    // A tap outside a popup lands on its invisible backdrop, which is the <dialog> itself.
    for (const id of DIALOGS) if (document.getElementById(id)?.open && (t.id === id || !t.closest(`#${id}`))) closeDialog(id);
}

function bindEvents() {
    // Capture phase on window: runs before anything in the page can swallow the tap.
    window.addEventListener('click', onClick, true);
    // Keeps the focus, the selection and the phone keyboard in the message box when a button is pressed.
    window.addEventListener('mousedown', (e) => {
        if (e.target instanceof Element && e.target.closest('#de_button, #de_ext_enhance, #de_ext_write, #de_ext_continue, #de_bar [data-bar]')) e.preventDefault();
    }, true);
    window.addEventListener('resize', () => DIALOGS.forEach(placeDialog)); // phone keyboard, window resizing

    const c = ctx();
    c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => {
        hideBar();
        state.history = [];
        state.lastRun = null;
    });

    $(document).on('submit', '#de_refine .de-refine-own', function (e) {
        e.preventDefault();
        const own = String($(this).find('input').val() || '').trim();
        if (!own) return;
        $(this).find('input').val('');
        refine(/[.!?]$/.test(own) ? own : `${own}.`);
    });
    $(document).on('keydown', '#de_button', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        toggleDialog('de_menu', e.currentTarget);
    });
    // Shortcuts inside the message box, by physical key position, so any keyboard layout works.
    $(document).on('keydown', '#send_textarea', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) hideBar(); // sending
        if (!settings().shortcuts || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const fn = { KeyE: () => run('enhance'), KeyW: () => run('write'), KeyC: () => run('continue'), KeyZ: undo }[e.code];
        if (!fn) return;
        e.preventDefault();
        fn();
    });
}

/* ------------------------------------------------------------------ */
/* Settings panel                                                      */
/* ------------------------------------------------------------------ */

function fieldHtml(f) {
    if (f.type === 'bool') {
        return `<label class="checkbox_label de-check" data-row="${f.key}"><input type="checkbox" data-key="${f.key}"><span>${esc(f.label)}</span></label>`;
    }
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
    const options = (list) => list.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    const input = {
        select: () => `<select class="text_pole" data-key="${f.key}">${options(f.options)}</select>`,
        profile: () => `<select class="text_pole" data-key="${f.key}">${options([['', 'Same as chat']])}</select>`,
        number: () => `<input type="number" class="text_pole" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}">`,
        text: () => `<input type="text" class="text_pole" data-key="${f.key}"${ph}>`,
        area: () => `<textarea class="text_pole" data-key="${f.key}"${ph}></textarea>` +
            (f.fill ? `<div class="menu_button de-fill" data-fill="${f.fill}" data-target="${f.key}">Insert the built-in instruction</div>` : ''),
    }[f.type]();
    return `<div class="de-row${f.grid ? ' de-col' : ''}" data-row="${f.key}"><label>${esc(f.label)}</label>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
}

/** Fills the connection profile list from the Connection Manager. */
async function loadProfiles() {
    const s = settings();
    const select = $('#de_settings [data-key="profile"]');
    let names = [];
    if (ctx().SlashCommandParser?.commands?.['profile-list']) {
        try {
            names = JSON.parse(await slash('/profile-list'));
        } catch {
            names = [];
        }
    }
    if (s.profile && !names.includes(s.profile)) names.push(s.profile); // keep a saved choice visible
    select.html([['', 'Same as chat'], ...names.map((n) => [n, n])].map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''));
    select.val(s.profile);
}

function syncSettings() {
    const s = settings();
    $('#de_settings [data-key]').each((_, el) => {
        if (el.type === 'checkbox') el.checked = !!s[el.dataset.key];
        else el.value = s[el.dataset.key] ?? '';
    });
    for (const f of FIELDS) if (f.showIf) $(`#de_settings [data-row="${f.key}"]`).toggleClass('displayNone', !f.showIf(s));
}

/** Shows the note that Enhance (or Write, with an empty box) would send right now. */
function previewNote() {
    const c = ctx();
    if (c.characterId === undefined && !c.groupId) return toastr.info('Open a chat to see the note with its names and last message.', TITLE);
    const s = settings();
    const text = (box()?.value ?? '').trim();
    const kind = text ? 'enhance' : 'write';
    const note = buildNote(kind, text, s, { subject: currentSubject() });
    c.callGenericPopup(
        `<h3>${KIND_TITLES[kind]}, as ${esc(subjectName(currentSubject()))}</h3><pre class="de-preview">${esc(note)}</pre>`,
        c.POPUP_TYPE.TEXT, '', { wide: true, large: true, allowVerticalScrolling: true },
    );
}

function buildSettings() {
    $('#de_settings').remove();
    const sections = SECTIONS.map(([title, fields]) => `<h4 class="de-section">${esc(title)}</h4><div class="de-fields">${fields.map(fieldHtml).join('')}</div>`).join('');
    ($('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings')).append(`
        <div id="de_settings" class="extension_container">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${TITLE} <small class="de-beta">beta</small></b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    ${sections}
                    <div class="de-buttons">
                        <div class="menu_button" id="de_preview"><i class="fa-solid fa-eye"></i> Preview the note</div>
                        <div class="menu_button" id="de_reset">Reset everything to defaults</div>
                    </div>
                    <small>Draft Enhancer follows your active preset: it runs through SillyTavern's Impersonate, so your preset, its jailbreak, its impersonation prompt, lorebooks and history all apply. The result always goes into your message box.</small>
                </div>
            </div>
        </div>`);
    syncSettings();
    loadProfiles();

    $('#de_settings').on('focus', '[data-key="profile"]', loadProfiles); // profiles can be added at any time
    $('#de_settings').on('input change', '[data-key]', function () {
        const f = FIELDS.find((x) => x.key === this.dataset.key);
        let v = this.type === 'checkbox' ? this.checked : this.value;
        if (f.type === 'number') v = clamp(num(v, f.def), f.min, f.max);
        settings()[f.key] = v;
        save();
        for (const g of FIELDS) if (g.showIf) $(`#de_settings [data-row="${g.key}"]`).toggleClass('displayNone', !g.showIf(settings()));
        if (f.key === 'wandMenu') buildUI();
        else updateButton();
    });

    $('#de_settings').on('click', '.de-fill', function () {
        const kind = this.dataset.fill;
        const text = buildNote(kind, kind === 'enhance' ? '{{draft}}' : '{{direction}}', { ...settings(), templateEnhance: '', templateWrite: '' });
        $(`#de_settings [data-key="${this.dataset.target}"]`).val(text).trigger('input');
    });
    $('#de_preview').on('click', previewNote);
    $('#de_reset').on('click', () => {
        Object.assign(settings(), structuredClone(DEFAULTS));
        save();
        syncSettings();
        loadProfiles();
        buildUI();
        toastr.success('Settings reset', TITLE, { timeOut: 1500 });
    });
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

function registerCommands() {
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx();
    if (!SlashCommandParser) return console.warn(TAG, 'slash commands unavailable');
    const add = (name, alias, kind, helpString, argHelp) =>
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name,
            aliases: [alias],
            callback: async (args, value) => (await run(kind, String(value || '').trim() || undefined, args?.as ? String(args.as) : undefined)) ?? '',
            returns: 'the text placed in the message box',
            namedArgumentList: [SlashCommandNamedArgument.fromProps({
                name: 'as', description: 'who to write as, for this run only: user, char, narrator, or a group member\'s name', typeList: [ARGUMENT_TYPE.STRING],
            })],
            unnamedArgumentList: [SlashCommandArgument.fromProps({ description: argHelp, typeList: [ARGUMENT_TYPE.STRING] })],
            helpString,
        }));
    add('enhance-draft', 'enhance', 'enhance', 'Rewrites your draft into a finished message, following your preset.', 'draft (defaults to the message box)');
    add('write-for-me', 'writeforme', 'write', 'Writes the next message for you, following your preset.', 'optional direction (defaults to the message box)');
    add('continue-draft', 'continuedraft', 'continue', 'Finishes the draft you started, following your preset.', 'draft (defaults to the message box)');
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

globalThis.DraftEnhancer = {
    enhance: (text, as) => run('enhance', text, as),
    write: (direction, as) => run('write', direction, as),
    continue: (draft, as) => run('continue', draft, as),
    refine,
    undo,
    previewNote,
    getLastPrompt: () => state.lastPrompt,
    getLastOutput: () => state.lastOutput,
    getHistory: () => [...state.history],
    _internals: { settings, buildNote, clean, cleanPartial, trimUnfinished, joinContinuation, assemble, barAction, currentSubject, cycleSubject, subjectChoices, state, REFINES },
};

jQuery(() => {
    try {
        settings();
        buildSettings();
        buildUI();
        bindEvents();
        registerCommands();
        console.log(TAG, 'loaded');
    } catch (err) {
        console.error(TAG, 'failed to load', err);
    }
});

/*
 * Draft Enhancer (beta) — SillyTavern extension
 *
 * Janitor AI's "Enhance my draft" and "Write something for me", for SillyTavern.
 *
 * Everything is written into YOUR message box, as your own message. The request runs through
 * SillyTavern's Impersonate pipeline, so your active preset (main prompt, jailbreak, toggles,
 * impersonation prompt and prefill, impersonate-only prompts, user-input regex), lorebooks,
 * persona and chat history all apply. The extension only adds a short note describing the task.
 *
 * "Write as" chooses who your message is about: yourself, the character (you take over their
 * lines for this turn) or the narrator (scene and side characters). It never posts a reply as
 * the character; the text always lands in your box for you to edit and send.
 */

const MODULE = 'draftEnhancer';
const TAG = '[Draft Enhancer]';
const NOTE_KEY = 'draft_enhancer_note';
const SETTINGS_VERSION = 4;

/* ------------------------------------------------------------------ */
/* Settings schema (the panel and the defaults are both built from it) */
/* ------------------------------------------------------------------ */

const SUBJECTS = [
    ['user', 'You (your persona)'],
    ['char', "The character (their point of view and actions, never yours)"],
    ['narrator', 'Narrator (the scene, you and the character, or just the story)'],
];

const FIELDS = [
    { section: 'General' },
    { key: 'enabled', type: 'bool', def: true, label: 'Enabled' },
    { key: 'wandMenu', type: 'bool', def: true, label: 'Also show the actions in the Extensions (wand) menu' },
    { key: 'shortcuts', type: 'bool', def: true, label: 'Keyboard shortcuts in the message box (Alt+E, Alt+W, Alt+Z)' },
    { key: 'actionBar', type: 'bool', def: true, label: 'Show Keep / Regenerate / Discard after each result' },
    { key: 'autoSend', type: 'bool', def: false, label: 'Send automatically' },
    { key: 'debug', type: 'bool', def: false, label: 'Log every request to the browser console' },

    { section: 'Writing' },
    {
        key: 'subject', type: 'select', def: 'user', label: 'Write as', options: SUBJECTS, grid: true,
        hint: 'Who your message is about. The result always goes into your own message box.',
    },
    {
        key: 'length', type: 'select', def: 'flexible', label: 'Length', grid: true,
        options: [
            ['flexible', 'Flexible (fits your text)'],
            ['short', 'Short (30-80 words)'],
            ['medium', 'Medium (80-180 words)'],
            ['long', 'Long (180-350 words)'],
            ['custom', 'Custom range'],
        ],
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
    {
        key: 'language', type: 'select', def: 'auto', label: 'Language', grid: true,
        options: [['auto', 'Same as what I typed'], ['chat', 'Same as the chat'], ['custom', 'Custom']],
    },
    { key: 'languageName', type: 'text', def: '', label: 'Language name', placeholder: 'e.g. English', grid: true, showIf: (s) => s.language === 'custom' },
    {
        key: 'faithfulness', type: 'select', def: 'balanced', label: 'Enhance: faithfulness', grid: true,
        options: [['strict', 'Strict (only wording and detail)'], ['balanced', 'Balanced (small supporting beats)'], ['creative', 'Creative (develop the idea)']],
    },
    {
        key: 'tone', type: 'select', def: 'auto', label: 'Tone', grid: true,
        options: [
            ['auto', 'Auto (follow the chat)'], ['warm', 'Warm and gentle'], ['romantic', 'Romantic'], ['playful', 'Playful and teasing'],
            ['tense', 'Tense'], ['dark', 'Dark and serious'], ['calm', 'Calm and reflective'], ['angry', 'Angry'],
        ],
    },
    { key: 'voiceMatch', type: 'bool', def: true, label: 'Match my writing voice (uses a few of my recent messages as a style sample)' },
    { key: 'parenDirections', type: 'bool', def: true, label: 'Treat (parentheses) and [brackets] in my text as directions, not words to write' },
    { key: 'noRepeat', type: 'bool', def: true, label: 'Ask the model not to repeat recent messages' },
    { key: 'endOpen', type: 'bool', def: true, label: 'Stop where the other side would answer (leave the turn open)' },

    { section: 'Model compatibility' },
    {
        key: 'instructionStyle', type: 'select', def: 'full', label: 'Instruction style', grid: true,
        options: [['full', 'Full (best for large models)'], ['compact', 'Compact (small or local models)']],
        hint: 'Compact sends a shorter note with only the essential rules, which weaker models follow more reliably.',
    },
    {
        key: 'presetGuard', type: 'bool', def: true,
        label: "Tell the model to skip the preset's end-of-reply extras (trackers, status blocks, suggestions) and its \"who you may write for\" rules",
    },
    { key: 'retries', type: 'number', def: 1, label: 'Retries on an empty result', min: 0, max: 3, step: 1, grid: true },
    { key: 'emptyToWrite', type: 'bool', def: true, label: 'Enhance with an empty box writes something for me instead' },
    { key: 'trimUnfinished', type: 'bool', def: true, label: 'Cut a reply that was stopped mid-sentence back to its last full sentence' },

    { section: 'Instructions' },
    { key: 'notesEnhance', type: 'area', def: '', label: 'Your notes for Enhance my draft', placeholder: 'e.g. Keep sentences short, no purple prose.' },
    { key: 'notesWrite', type: 'area', def: '', label: 'Your notes for Write something for me', placeholder: 'e.g. Keep my character guarded and sarcastic.' },
    {
        key: 'templateEnhance', type: 'area', def: '', label: 'Custom instruction for Enhance (advanced)', fill: 'enhance',
        placeholder: 'Empty = the built-in instruction. Macros: {{draft}} {{rules}} {{notes}} {{subject}} {{other}} {{min}} {{max}}, plus SillyTavern macros such as {{user}} and {{char}}.',
    },
    {
        key: 'templateWrite', type: 'area', def: '', label: 'Custom instruction for Write (advanced)', fill: 'write',
        placeholder: 'Empty = the built-in instruction. Macros: {{direction}} {{rules}} {{notes}} {{subject}} {{other}} {{min}} {{max}}, plus SillyTavern macros.',
    },

    { section: 'Clean-up of the result' },
    { key: 'cleanReasoning', type: 'bool', def: true, label: 'Remove reasoning blocks (<think>, <checklist>, …)' },
    { key: 'cleanHeaders', type: 'bool', def: true, label: 'Remove scene headers ( [ time | day | place ] )' },
    { key: 'cleanPanels', type: 'bool', def: true, label: 'Remove status, tracker and internal-state panels (<details>, <tracker>, <svt>, …)' },
    { key: 'cleanHtml', type: 'bool', def: true, label: 'Remove any remaining HTML tags' },
    { key: 'cleanPreamble', type: 'bool', def: true, label: 'Remove chatty lead-ins ("Sure, here is…") and trailing notes' },
    { key: 'cleanCustom', type: 'area', def: '', label: 'Also remove (one regular expression per line)', placeholder: '/^\\[OOC:[^\\]]*\\]\\s*/gm' },
];

const DEFAULTS = { settingsVersion: SETTINGS_VERSION };
for (const f of FIELDS) if (f.key) DEFAULTS[f.key] = f.def;

const LENGTHS = { short: [30, 80], medium: [80, 180], long: [180, 350] };

const state = {
    busy: false,
    generating: false,
    cancelled: false,
    undo: null,
    lastRun: null, // { kind, text, subject, original } — what Regenerate and Discard act on
    history: [],   // results of the current Regenerate chain, so you can flip back to an earlier one
    hIdx: 0,
    lastPrompt: '',
    lastOutput: '',
};

class Cancelled extends Error {}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    const s = (all[MODULE] ??= {});
    if (Object.keys(s).length && (s.settingsVersion ?? 1) < SETTINGS_VERSION) migrate(s);
    for (const [k, v] of Object.entries(DEFAULTS)) if (s[k] === undefined) s[k] = v;
    return s;
}

/** Carries over what still exists; anything else falls back to the default. */
function migrate(s) {
    const old = { ...s };
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, DEFAULTS);
    const keep = (k, v) => { if (v !== undefined) s[k] = v; };
    keep('enabled', old.enabled);
    keep('autoSend', old.autoSend);
    keep('debug', old.debug);
    keep('subject', old.speaker === 'char' ? 'char' : old.speaker === 'user' ? 'user' : undefined);
    s.length = { polish: 'short', rich: 'long', flexible: 'flexible', short: 'short', medium: 'medium', long: 'long', custom: 'custom' }[old.length] || 'flexible';
    keep('pov', old.pov);
    keep('format', old.format === 'auto' || old.format === 'asterisks' || old.format === 'plain' ? old.format : undefined);
    keep('faithfulness', { faithful: 'strict', balanced: 'balanced', creative: 'creative' }[old.creativity]);
    const notes = [old.extra, old.enhanceExtra, old.writeExtra].map((x) => String(x || '').trim()).filter(Boolean);
    if (notes.length) { s.notesEnhance = notes.join('\n'); s.notesWrite = notes.join('\n'); }
    if (old.clean === false || old.cleanOutput === false) {
        s.cleanHeaders = s.cleanPanels = s.cleanHtml = false;
    }
}

const save = () => ctx().saveSettingsDebounced();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const words = (t) => (String(t || '').match(/\S+/g) || []).length;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

function names() {
    const c = ctx();
    return { user: c.name1 || 'User', char: c.name2 || 'the character' };
}

/** Who the message is about, and who must be left alone. */
function roles(s) {
    const { user, char } = names();
    if (s.subject === 'char') return { mode: 'char', who: char, other: user, piece: 'message', user, char };
    if (s.subject === 'narrator') return { mode: 'narrator', who: 'the narrator', other: user, piece: 'passage', user, char };
    return { mode: 'user', who: user, other: char, piece: 'message', user, char };
}

const box = () => document.getElementById('send_textarea');

function setBox(text, focus = true) {
    const ta = box();
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) {
        ta.focus();
        ta.setSelectionRange?.(text.length, text.length);
    }
}

const CLEAN_ALL = { cleanReasoning: true, cleanHeaders: true, cleanPanels: true, cleanHtml: true };

/** Average length of the last few messages from that side of the chat. */
function recentWords(fromUser) {
    const msgs = (ctx().chat || []).filter((m) => m && !m.is_system && !!m.is_user === fromUser).slice(-4);
    if (!msgs.length) return 0;
    return Math.round(msgs.reduce((n, m) => n + words(clean(m.mes, CLEAN_ALL)), 0) / msgs.length);
}

function replyIsRunning() {
    const stop = document.getElementById('mes_stop');
    return !!stop && stop.offsetParent !== null && getComputedStyle(stop).display !== 'none';
}

/* ------------------------------------------------------------------ */
/* The task note                                                       */
/* ------------------------------------------------------------------ */

/** Target word range. Flexible scales with your draft, or with how long that side usually writes. */
function lengthRange(kind, draftWords, s) {
    let lo, hi;
    if (s.length === 'custom') {
        lo = num(s.lengthMin, 60);
        hi = Math.max(num(s.lengthMax, 160), lo + 20);
    } else if (LENGTHS[s.length]) {
        [lo, hi] = LENGTHS[s.length];
    } else if (kind === 'enhance') {
        const d = draftWords;
        if (d < 15) [lo, hi] = [50, 120];            // a line or two: grow it into a full message
        else if (d < 60) [lo, hi] = [d * 1.6, d * 2.6]; // a short paragraph: about double
        else [lo, hi] = [d * 1.1, d * 1.6];          // already detailed: polish, little padding
    } else {
        const avg = recentWords(s.subject === 'user');
        [lo, hi] = avg ? [Math.max(30, avg * 0.8), Math.max(90, avg * 1.6)] : [60, 150];
    }
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
    warm: 'Tone: warm and gentle.',
    romantic: 'Tone: romantic.',
    playful: 'Tone: playful and teasing.',
    tense: 'Tone: tense.',
    dark: 'Tone: dark and serious.',
    calm: 'Tone: calm and reflective.',
    angry: 'Tone: angry.',
};

const HAS_DIRECTION = /\([^()\n]{2,}\)|\[[^\[\]\n]{2,}\]/;

/**
 * The rule list, built from the settings. Only rules that say something are included.
 * `core` holds the indexes of the rules kept by the compact instruction style.
 */
function buildRules(kind, text, s) {
    const r = roles(s);
    const [lo, hi] = lengthRange(kind, words(text), s);
    const rules = [];
    const core = new Set();
    const add = (rule, isCore = false) => {
        if (isCore) core.add(rules.length);
        rules.push(rule);
    };

    if (kind === 'enhance') {
        add(FAITH[s.faithfulness] || FAITH.balanced, true);
        if (r.mode === 'user') add(`If the draft already says what ${r.other} does or says, keep that as written. Otherwise do not write for ${r.other}.`, true);
        else if (r.mode === 'char') add(`Write only ${r.char}: their actions, words, thoughts and feelings. Never write ${r.user}'s actions, words, thoughts or reactions; ${r.char} can only react to what ${r.user} has already done in the chat.`, true);
        else add(`Keep everything the draft says about ${r.user} and ${r.char} as written, and add nothing the draft does not imply.`, true);
    } else if (r.mode === 'user') {
        add(`Write only ${r.who}. Leave ${r.other}'s words and actions to ${r.other}.`, true);
    } else if (r.mode === 'char') {
        add(`Write only ${r.char}: their own actions, words, thoughts and feelings, as ${r.char} would have them in this moment. Never write ${r.user}'s actions, words, thoughts or reactions; ${r.char} can only react to what ${r.user} has already done in the chat.`, true);
    } else {
        add(`Narrate this moment as an outside storyteller. Decide from the direction and the recent messages what it needs: it may show what both ${r.user} and ${r.char} do and say in the scene (and any side characters), or it may only narrate the setting, the atmosphere and the events, without either of them acting.`, true);
    }

    if (s.presetGuard) {
        add(
            `This is one message written for the player. Skip any tracker, status or state block, notes, summary, suggestions, options or other extra that the preset asks for at the end of replies, and ignore preset rules about who you may write for or what the player's role is (roleplay, director or persona modes): this task decides that.`,
            true,
        );
    }

    if (s.parenDirections && HAS_DIRECTION.test(text)) {
        add('Text in (parentheses) or [square brackets] is a direction to you, not words to write: follow it and leave the brackets out of the result.', true);
    }

    if (s.pov !== 'auto') add(POV[s.pov], true);
    else if (kind === 'enhance') add("Keep the draft's point of view and tense.");
    else if (r.mode === 'char') add(`Write from ${r.char}'s own point of view and in their voice, in the same person and tense as ${r.char}'s earlier messages.`, true);
    else if (r.mode === 'narrator') add('Narrate in the third person, as an outside storyteller, and keep the tense of the recent messages.', true);
    else add('Follow the point of view and tense of the recent messages.');

    if (s.format !== 'auto') add(FORMAT[s.format], true);
    else if (kind === 'enhance') add("Keep the draft's formatting style.");

    if (TONE[s.tone]) add(TONE[s.tone], true);

    if (s.language === 'custom' && String(s.languageName || '').trim()) add(`Write in ${String(s.languageName).trim()}.`, true);
    else if (s.language === 'chat') add('Write in the language used in this chat.', true);
    else if (kind === 'enhance') add('Write in the same language as the draft.', true);

    add(
        s.length === 'flexible'
            ? kind === 'enhance'
                ? `Length: as long as the draft's content needs, roughly ${lo}-${hi} words. A short draft becomes a full message; a detailed one is polished without padding.`
                : `Length: as long as this moment needs, roughly ${lo}-${hi} words.`
            : `Length: about ${lo}-${hi} words.`,
        true,
    );

    if (s.noRepeat) add('Do not repeat wording or descriptions from the recent messages.');
    if (s.endOpen) add(`Stop where ${r.mode === 'user' ? r.other : r.user} would answer, leaving the turn open.`, true);
    return { rules, core, lo, hi, r };
}

/** A few of the player's own recent messages, so the result sounds like them. */
function voiceSample(s, r) {
    if (!s.voiceMatch || r.mode === 'narrator') return '';
    const fromUser = r.mode === 'user';
    const msgs = (ctx().chat || []).filter((m) => m && !!m.is_user === fromUser && !m.is_system).slice(-3);
    const parts = msgs
        .map((m) => clean(m.mes, CLEAN_ALL))
        .filter((x) => words(x) >= 4)
        .map((x) => (x.length > 450 ? `${x.slice(0, 450).replace(/\s+\S*$/, '')}…` : x));
    if (!parts.length) return '';
    const who = fromUser ? r.user : r.char;
    return `How ${who} usually ${fromUser ? 'writes' : 'speaks and acts'} (match this voice and habits, never copy the content):\n<voice>\n${parts.join('\n---\n')}\n</voice>`;
}

/** Header lines that tell the model whose turn this is. */
function buildHeader(kind, s, r) {
    const title = kind === 'enhance' ? 'Enhance my draft' : 'Write something for me';
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

function applyMacros(template, map) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in map ? map[key] : whole));
}

/**
 * The note that is added as the last message. It says only what the preset cannot know:
 * the task, your text, the rules from your settings and your notes. Everything else is the preset's.
 */
function buildNote(kind, text, s) {
    const { rules, core, lo, hi, r } = buildRules(kind, text, s);
    const notes = String((kind === 'enhance' ? s.notesEnhance : s.notesWrite) || '').trim();
    const custom = String((kind === 'enhance' ? s.templateEnhance : s.templateWrite) || '').trim();

    if (custom) {
        const map = {
            draft: text, direction: text, rules: rules.map((x) => `- ${x}`).join('\n'), notes,
            subject: r.who, other: r.other, min: String(lo), max: String(hi),
        };
        const out = applyMacros(custom, map);
        return ctx().substituteParams ? ctx().substituteParams(out) : out;
    }

    const compact = s.instructionStyle === 'compact';
    const shown = compact ? rules.filter((_, i) => core.has(i)) : rules;
    const lines = [];

    if (compact) {
        const who = r.mode === 'user' ? `${r.user}'s` : r.mode === 'char' ? `${r.char}'s` : "the narrator's";
        const tag = kind === 'enhance' ? 'draft' : 'direction';
        lines.push(
            kind === 'enhance'
                ? `Rewrite this draft as ${who} finished ${r.piece}, in the style of this story:`
                : text ? `Write ${who} next ${r.piece}, following this direction:` : `Write ${who} next ${r.piece}, continuing naturally from the last message.`,
        );
        if (text) lines.push(`<${tag}>\n${text}\n</${tag}>`);
        lines.push(shown.join(' '));
        if (notes) lines.push(`Notes: ${notes}`);
        lines.push(`Output only the ${r.piece} itself.`);
        return lines.join('\n');
    }

    lines.push(...buildHeader(kind, s, r));
    if (kind === 'enhance') {
        lines.push(`The player drafted this:`, `<draft>\n${text}\n</draft>`, `Rewrite it into the finished ${r.piece}, following your instructions and the style of this story.`);
    } else {
        lines.push(text ? `Follow the player's direction closely:\n<direction>\n${text}\n</direction>` : 'Continue naturally from the last message.');
    }
    lines.push(shown.map((x) => `- ${x}`).join('\n'));
    const voice = voiceSample(s, r);
    if (voice) lines.push(voice);
    if (notes) lines.push(`Player's notes: ${notes}`);
    lines.push(`Output only the ${r.piece} itself: no scene header, status block, notes or reasoning.`);
    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Cleaning the result                                                 */
/* ------------------------------------------------------------------ */

const THINK = 'think|thinking|reasoning|thought|thoughts|checklist|cot|analysis|planning|internal_monologue';
// Panels and trackers that presets ask for at the end of every reply. The short ones (dy, ob, cs, ...) are
// the mini-tags of tag-based trackers such as <svt>, <trk> and <bst>; their content goes too, not only the tags.
const TRACKER_WRAPPERS = 'tracker|trackers|svt|trk|bst|world_activity|money_tracker|inventory|subtext|objective_tracker|plot_director|brainstormer|trope_spotter|chaos_suggester|plot_threads|narrative_mode|director_notes|story_notes';
const TRACKER_TAGS = 'dy|ob|ph|in|at|wl|hg|th|ai|cs|lc|tm|wx|bg|ch|sx|dt';
const PANELS = `details|summary|internal_states|internal_state|status|stats|style|script|table|ooc|${TRACKER_WRAPPERS}|${TRACKER_TAGS}`;
const reThinkPair = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
const reThinkBefore = new RegExp(`^[\\s\\S]*?<\\/(${THINK})>`, 'i'); // reasoning whose opening tag was a prefill
const reThinkOpen = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*$`, 'i'); // reasoning cut off at the end
const rePanelPair = new RegExp(`<(${PANELS})\\b[^>]*>(?:(?!<(?:${PANELS})\\b)[\\s\\S])*?<\\/\\1\\s*>`, 'gi');
const rePanelOpen = new RegExp(`<(${PANELS})\\b[\\s\\S]*$`, 'i');

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

// Tags that are normal formatting in a message; anything else at the very end is treated as an extra block.
const KEEP_TAGS = new Set('a b i u s em strong span p br hr sub sup sup small big mark del ins ul ol li blockquote code pre font center q cite'.split(' '));

/**
 * Presets differ in how they ask for trackers and notes. Whatever the format, the extras come at the very end,
 * wrapped in their own tag. Removes such blocks (innermost last) when the tag is not ordinary formatting.
 */
function stripTrailingBlocks(text) {
    let t = String(text).trimEnd();
    for (let i = 0; i < 6; i++) {
        const m = t.match(/<\/([a-z][\w-]*)\s*>$/i);
        if (!m || KEEP_TAGS.has(m[1].toLowerCase())) break;
        const open = new RegExp(`<${m[1]}\\b[^>]*>`, 'ig');
        let start = -1;
        for (let o; (o = open.exec(t)); ) start = o.index; // the last opening tag with that name
        if (start < 0) break;
        const before = t.slice(0, start).trimEnd();
        if (!before) break; // the whole message is that block: leave it to the other clean-up steps
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
        for (let i = 0, prev = null; i < 20 && prev !== t; i++) {
            prev = t;
            t = t.replace(rePanelPair, ''); // innermost first, so nested panels go too
        }
        t = t.replace(rePanelOpen, '');
        t = t.replace(/^[ \t]*💰[^\n]*$/gmu, ''); // "💰 Currency: 20" style one-line trackers
    }
    if (s.cleanPanels) t = stripTrailingBlocks(t);
    if (s.cleanHtml) t = t.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, '');
    if (s.cleanHeaders) t = t.replace(/^\s*\[[^\]\n]*\|[^\]\n]*\|[^\]\n]*\]\s*$/gm, '');
    for (const line of String(s.cleanCustom || '').split('\n')) {
        const re = parseRegex(line);
        if (re) t = t.replace(re, '');
    }
    t = t.replace(/<\/?(draft|direction|voice)>/gi, '');
    if (s.cleanPreamble) {
        t = t.replace(/^\s*\(answer\)[ \t]*\n?/i, ''); // placeholder some reasoning templates end with
        t = t.replace(/^\s*(?:sure|certainly|of course|okay|ok|alright|here(?:'s| is| are))\b[^\n]{0,160}:[ \t]*\n+/i, '');
        t = t.replace(/\n+[ \t]*[\[(*_]*(?:note|word count|author'?s note|n\.b\.)\s*[:：][^\n]*$/i, '');
    }
    t = t.replace(/^\s*(?:\*\*)?(?:rewritten|enhanced|revised|final)(?: (?:message|draft|reply|version))?(?:\*\*)?\s*:\s*(?:\*\*)?/i, '');
    const { user, char } = names();
    for (const n of [user, char]) t = t.replace(new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A reply that hit the token limit stops mid-sentence. Cut it back to the last full sentence,
 * but only when the unfinished tail is a small part of the text (at most 20%).
 */
function trimUnfinished(t) {
    const text = String(t || '').trimEnd();
    if (!/[\p{L}\p{N},;:\-–—]$/u.test(text)) return text; // ends in punctuation, a marker or an emoji: looks finished
    const m = [...text.matchAll(/[.!?…]+[*_"'”’»)\]]*(?=\s|$)/g)].pop();
    if (!m) return text;
    const cut = m.index + m[0].length;
    return cut >= text.length * 0.8 ? text.slice(0, cut).trimEnd() : text;
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Removes the preset's impersonation prompt ("Write as {{user}}, don't write as {{char}}") from a prompt that is
 * already assembled. Only used when writing as the character or the narrator, where it says the opposite of the task.
 */
function stripImpersonationPrompt(messages) {
    const c = ctx();
    const raw = String(c.chatCompletionSettings?.impersonation_prompt || '').trim();
    const needle = raw && c.substituteParams ? String(c.substituteParams(raw)).trim() : raw;
    if (!needle) return;
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (typeof m?.content !== 'string' || !m.content.includes(needle)) continue;
        m.content = m.content.split(needle).join('').trim();
        if (!m.content) messages.splice(i, 1);
    }
}

/**
 * One path for every mode: SillyTavern's Impersonate, with the note as the last message.
 * Chat Completion: the note is appended to the finished prompt, after every preset prompt, tracker and chain-of-thought
 * template, so nothing the preset adds at the end can outrank it. Other APIs: it is injected at depth 0.
 */
async function generate(note, stripImpersonation = false) {
    const c = ctx();
    state.lastPrompt = note;
    const event = c.eventTypes?.CHAT_COMPLETION_PROMPT_READY;
    const lastMessage = c.mainApi === 'openai' && !!event && typeof c.eventSource?.on === 'function';
    const inject = !lastMessage && typeof c.setExtensionPrompt === 'function';

    const onReady = (data) => {
        if (!data || data.dryRun || !Array.isArray(data.chat)) return;
        if (stripImpersonation) stripImpersonationPrompt(data.chat);
        data.chat.push({ role: 'user', content: note });
    };

    setBox('', false); // like /impersonate: start from an empty box (the draft is already saved)
    if (lastMessage) c.eventSource.on(event, onReady);
    if (inject) c.setExtensionPrompt(NOTE_KEY, note, 1 /* in chat */, 0 /* depth */, false, 1 /* user role */);
    try {
        const ret = await c.generate('impersonate', lastMessage || inject ? {} : { quiet_prompt: note, quietToLoud: true });
        const text = box()?.value ?? '';
        return text.trim() ? text : String(ret ?? '');
    } finally {
        if (lastMessage) (c.eventSource.removeListener ?? c.eventSource.off)?.call(c.eventSource, event, onReady);
        if (inject) c.setExtensionPrompt(NOTE_KEY, '', 1, 0, false, 1);
    }
}

function cancel() {
    if (!state.generating) return;
    state.cancelled = true;
    try {
        ctx().stopGeneration();
    } catch (err) {
        console.warn(TAG, err);
    }
}

/**
 * Enhance or Write.
 * opts.original       the text to restore on Discard (the draft before the first run)
 * opts.restoreOnError what to put back if this attempt fails
 * opts.fromBar        true when the Regenerate button started it
 */
async function run(kind, overrideText, overrideSubject, opts = {}) {
    const s = settings();
    if (!s.enabled) return null;
    if (state.busy) return cancel(), null;

    const c = ctx();
    if (c.characterId === undefined && !c.groupId) return toastr.warning('Open a chat first.', 'Draft Enhancer'), null;
    if (replyIsRunning()) return toastr.warning('Wait for the current reply to finish.', 'Draft Enhancer'), null;

    const original = opts.original ?? (box()?.value ?? '');
    const text = String(overrideText ?? original).trim();
    if (kind === 'enhance' && !text) {
        if (!s.emptyToWrite) return toastr.warning('Type a draft in the message box first.', 'Draft Enhancer'), null;
        kind = 'write'; // nothing to enhance: write the next message instead
    }
    const subject = overrideSubject || s.subject;

    state.busy = true;
    state.cancelled = false;
    state.generating = true;
    closeMenu();
    if (opts.fromBar) setBarWorking(true);
    else hideBar();
    updateButton();

    try {
        let result = '';
        const attempts = 1 + clamp(num(s.retries, 1), 0, 3);
        for (let i = 0; i < attempts && !result; i++) {
            let raw;
            try {
                raw = await generate(buildNote(kind, text, { ...s, subject }), subject !== 'user');
            } catch (err) {
                if (state.cancelled) throw new Cancelled();
                throw err;
            }
            if (state.cancelled) throw new Cancelled();

            state.lastOutput = String(raw ?? '');
            if (s.debug) console.log(TAG, `${kind}, as ${subject}, attempt ${i + 1}
--- note ---
${state.lastPrompt}
--- raw output ---
${state.lastOutput}`);
            result = clean(raw, s);
            if (result && s.trimUnfinished) result = trimUnfinished(result);
            if (!result && i + 1 < attempts) console.warn(TAG, 'empty result, retrying');
        }
        if (!result) throw new Error('The model returned nothing usable. Check the connection, or raise the response length if your model uses reasoning.');

        state.undo = original;
        state.lastRun = { kind, text, subject, original };
        if (opts.fromBar) state.history.push(result);
        else state.history = [result];
        state.history = state.history.slice(-8);
        state.hIdx = state.history.length - 1;
        setBox(result);
        if (s.autoSend) {
            hideBar();
            document.getElementById('send_but')?.click();
        } else if (s.actionBar) {
            showBar();
        } else {
            toastr.success(kind === 'enhance' ? 'Draft enhanced' : 'Message written', 'Draft Enhancer', { timeOut: 1500 });
        }
        return result;
    } catch (err) {
        setBox(opts.restoreOnError ?? original, false); // never lose what was in the box
        if (opts.fromBar) showBar(); // a failed Regenerate leaves the earlier result and the bar
        if (err instanceof Cancelled) toastr.info('Cancelled', 'Draft Enhancer', { timeOut: 1500 });
        else {
            console.error(TAG, err);
            toastr.error(String(err?.message || err), 'Draft Enhancer');
        }
        return null;
    } finally {
        state.busy = false;
        state.generating = false;
        setBarWorking(false);
        updateButton();
    }
}

/* ------------------------------------------------------------------ */
/* Keep / Regenerate / Discard bar                                     */
/* ------------------------------------------------------------------ */

const bar = () => document.getElementById('de_bar');

function updateHistoryUI() {
    const n = state.history.length;
    $('#de_bar .de-nav').toggleClass('displayNone', n < 2);
    $('#de_bar .de-count').text(`${state.hIdx + 1}/${n}`);
    $('#de_bar [data-bar="prev"]').toggleClass('de-disabled', state.hIdx <= 0);
    $('#de_bar [data-bar="next"]').toggleClass('de-disabled', state.hIdx >= n - 1);
}

function showBar() {
    if (!settings().actionBar) return;
    updateHistoryUI();
    syncAnim();
    $('#de_bar').removeClass('displayNone de-working');
    animateIn(bar());
}

function hideBar() {
    $('#de_bar').addClass('displayNone').removeClass('de-working');
}

function setBarWorking(on) {
    $('#de_bar').toggleClass('de-working', !!on);
}

function barAction(action) {
    const last = state.lastRun;
    if (action === 'keep') {
        hideBar();
        box()?.focus();
        return;
    }
    if (action === 'prev' || action === 'next') {
        const i = state.hIdx + (action === 'next' ? 1 : -1);
        if (i < 0 || i >= state.history.length) return;
        state.hIdx = i;
        setBox(state.history[i]);
        return updateHistoryUI();
    }
    if (action === 'discard') {
        state.history = [];
        setBox(last ? last.original : '');
        state.undo = null;
        hideBar();
        return;
    }
    if (!last) return hideBar();
    return run(last.kind, last.text, last.subject, { original: last.original, restoreOnError: box()?.value ?? '', fromBar: true });
}

function undo() {
    closeMenu();
    hideBar();
    if (state.undo === null) return toastr.info('Nothing to undo.', 'Draft Enhancer', { timeOut: 1500 });
    setBox(state.undo);
    state.undo = null;
}

function cycleSubject() {
    const s = settings();
    const i = SUBJECTS.findIndex(([v]) => v === s.subject);
    s.subject = SUBJECTS[(i + 1) % SUBJECTS.length][0];
    save();
    refreshMenu();
    $('#de_settings [data-key="subject"]').val(s.subject);
}

/** The label shown in the menu for the current "Write as" choice. */
function subjectLabel(s) {
    const { user, char } = names();
    return { user, char, narrator: 'Narrator' }[s.subject] ?? user;
}

/* ------------------------------------------------------------------ */
/* Button and menu                                                     */
/* ------------------------------------------------------------------ */

const menu = () => document.getElementById('de_menu');
const menuOpen = () => !!menu()?.hasAttribute('open');

/*
 * The menu fades in and out like SillyTavern's own options and wand menus: 125 ms, and nothing at all
 * when reduced motion is on. The duration lives in a CSS variable so the stylesheet and the timer agree.
 */
const ANIM_MS = 125;

function animMs() {
    const reduced =
        document.body?.classList?.contains('reduced-motion') ||
        (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    return reduced ? 0 : ANIM_MS;
}

function syncAnim() {
    const ms = animMs();
    document.documentElement?.style?.setProperty?.('--de-anim', `${ms}ms`);
    return ms;
}

/** Restarts the appear animation on an element that is already in the page. */
function animateIn(el) {
    if (!el?.classList) return;
    el.classList.remove('de-in', 'de-out');
    void el.offsetWidth; // forces the browser to replay the animation
    el.classList.add('de-in');
}

/*
 * The menu and the preview are <dialog> elements opened with showModal(), which puts them in the
 * browser's top layer, positioned against the screen. Themes that transform the page cannot push
 * them off-screen that way.
 */
function openDialog(el) {
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
}

function closeDialog(el) {
    if (!el?.hasAttribute('open')) return;
    if (typeof el.close === 'function') el.close();
    else el.removeAttribute('open');
}

let menuCloseTimer = null;

function closeMenu(instant = false) {
    const m = menu();
    if (!m?.hasAttribute('open')) return;
    clearTimeout(menuCloseTimer);
    const ms = instant ? 0 : syncAnim();
    if (!ms) {
        m.classList.remove('de-in', 'de-out');
        return closeDialog(m);
    }
    m.classList.remove('de-in');
    m.classList.add('de-out');
    menuCloseTimer = setTimeout(() => {
        m.classList.remove('de-out');
        closeDialog(m);
    }, ms);
}

function updateButton() {
    const on = !!settings().enabled;
    if (!on) hideBar();
    $('#de_button')
        .toggleClass('displayNone', !on)
        .toggleClass('fa-feather-pointed', !state.generating)
        .toggleClass('fa-spinner fa-spin de-busy', state.generating)
        .attr('title', state.generating ? 'Working… tap to cancel' : 'Draft Enhancer');
    $('#de_ext_enhance, #de_ext_write').toggleClass('displayNone', !on);
}

function refreshMenu() {
    const s = settings();
    $('#de_menu .de-subject').text(`Writing as: ${subjectLabel(s)}`);
    $('#de_menu [data-action="undo"]').toggleClass('de-disabled', state.undo === null);
    $('#de_menu .de-item kbd').toggleClass('displayNone', !s.shortcuts);
}

/** Small popup above the feather button, kept inside the screen. Same on phone and desktop. */
function toggleMenu() {
    const m = menu();
    if (!m) return;
    if (m.classList.contains('de-out')) {
        // caught it on the way out: bring it straight back
        clearTimeout(menuCloseTimer);
        refreshMenu();
        return animateIn(m);
    }
    if (menuOpen()) return closeMenu();

    syncAnim();
    refreshMenu();
    m.classList.toggle('de-touch', matchMedia('(pointer: coarse)').matches);
    m.style.cssText = 'visibility:hidden;left:0;top:0';
    openDialog(m);

    const r = document.getElementById('de_button').getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const left = clamp(r.left, 8, Math.max(8, vw - m.offsetWidth - 8));
    let top = r.top - m.offsetHeight - 8;
    if (top < 8) top = clamp(r.bottom + 8, 8, Math.max(8, innerHeight - m.offsetHeight - 8)); // no room above
    m.style.cssText = `left:${Math.round(left)}px;top:${Math.round(top)}px`;
    animateIn(m);
}

function buildUI() {
    closeMenu(true);
    $('#de_button, #de_menu, #de_bar, #de_ext_enhance, #de_ext_write').remove();

    // Sits right above the message box, where SillyTavern puts its own confirm bar.
    const barHtml = `
        <div id="de_bar" class="de-bar displayNone">
            <div class="de-nav displayNone"><div class="de-bar-btn de-bar-nav" data-bar="prev" title="Previous result"><i class="fa-solid fa-chevron-left"></i></div><span class="de-count"></span><div class="de-bar-btn de-bar-nav" data-bar="next" title="Next result"><i class="fa-solid fa-chevron-right"></i></div></div>
            <div class="de-bar-btn de-bar-keep" data-bar="keep"><i class="fa-solid fa-check"></i><span>Keep</span></div>
            <div class="de-bar-btn" data-bar="regenerate"><i class="fa-solid fa-rotate"></i><span>Regenerate</span></div>
            <div class="de-bar-btn de-bar-discard" data-bar="discard"><i class="fa-solid fa-xmark"></i><span>Discard</span></div>
        </div>`;
    if ($('#send_form').length) $('#send_form').before(barHtml);
    else $('#form_sheld, body').first().append(barHtml);

    ($('#leftSendForm').length ? $('#leftSendForm') : $('#send_form')).append(
        '<div id="de_button" class="fa-solid fa-feather-pointed interactable" tabindex="0" role="button" title="Draft Enhancer"></div>',
    );

    $('body').append(`
        <dialog id="de_menu" class="de-menu" aria-label="Draft Enhancer">
            <div class="de-menu-inner">
                <div class="de-item" data-action="enhance"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Enhance my draft</span><kbd>Alt+E</kbd></div>
                <div class="de-item" data-action="write"><i class="fa-solid fa-pen-nib"></i><span>Write something for me</span><kbd>Alt+W</kbd></div>
                <div class="de-sep"></div>
                <div class="de-item" data-action="subject" title="Who the message is about"><i class="fa-solid fa-masks-theater"></i><span class="de-subject"></span></div>
                <div class="de-item" data-action="undo"><i class="fa-solid fa-rotate-left"></i><span>Undo last change</span><kbd>Alt+Z</kbd></div>
            </div>
        </dialog>
    `);

    if (settings().wandMenu) {
        const item = (id, icon, label) =>
            `<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0">` +
            `<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span></div>`;
        $('#extensionsMenu').append(item('de_ext_enhance', 'fa-wand-magic-sparkles', 'Enhance my draft'), item('de_ext_write', 'fa-pen-nib', 'Write something for me'));
    }
    updateButton();
}

let lastTap = { key: '', at: 0 };
/**
 * Touch screens can deliver the same tap twice; ignore the echo. The window is short for controls
 * that are meant to be tapped repeatedly (the "Write as" cycler) and long for the ones that start work.
 */
function duplicateTap(key, within = 300) {
    const now = Date.now();
    if (lastTap.key === key && now - lastTap.at < within) return true;
    lastTap = { key, at: now };
    return false;
}

let handlers = null;
function bindEvents() {
    if (handlers) {
        window.removeEventListener('click', handlers.click, true);
        window.removeEventListener('mousedown', handlers.down, true);
    }
    $(document).off('.de');

    // Capture phase on window: runs before anything in the page can swallow the tap.
    const click = (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;

        if (t.closest('#de_button')) {
            if (duplicateTap('button')) return;
            return state.generating ? cancel() : toggleMenu();
        }
        const item = t.closest('#de_menu .de-item');
        if (item) {
            const action = item.dataset.action;
            if (item.classList.contains('de-disabled') || duplicateTap(action, action === 'subject' ? 60 : 300)) return;
            if (action === 'subject') return cycleSubject(); // the menu stays open
            if (action === 'undo') return undo();
            return run(action);
        }
        const barBtn = t.closest('#de_bar [data-bar]');
        if (barBtn) {
            if (duplicateTap(`bar:${barBtn.dataset.bar}`)) return;
            return barAction(barBtn.dataset.bar);
        }
        if (t.closest('#send_but')) hideBar(); // the message is on its way out

        const ext = t.closest('#de_ext_enhance, #de_ext_write');
        if (ext) {
            if (duplicateTap(ext.id)) return;
            $('#extensionsMenu').hide();
            return run(ext.id === 'de_ext_write' ? 'write' : 'enhance');
        }
        // A tap outside the popup lands on its invisible backdrop, which is the <dialog> itself.
        if (menuOpen() && (t.id === 'de_menu' || !t.closest('#de_menu'))) closeMenu();
    };
    // Keep the focus (and the phone keyboard) in the message box when pressing the button.
    const down = (e) => {
        if (e.target instanceof Element && e.target.closest('#de_button, #de_ext_enhance, #de_ext_write')) e.preventDefault();
    };
    window.addEventListener('click', click, true);
    window.addEventListener('mousedown', down, true);
    handlers = { click, down };

    try {
        const c = ctx();
        c.eventSource?.on?.(c.eventTypes?.CHAT_CHANGED ?? 'chat_id_changed', hideBar);
    } catch (err) {
        console.warn(TAG, err);
    }

    $(document).on('keydown.de', '#de_button', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMenu();
        }
    });
    // Shortcuts inside the message box. Physical key positions, so any keyboard layout works.
    $(document).on('keydown.de', '#send_textarea', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) hideBar(); // sending
        if (!settings().shortcuts || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const fn = { KeyE: () => run('enhance'), KeyW: () => run('write'), KeyZ: undo }[e.code];
        if (fn) {
            e.preventDefault();
            fn();
        }
    });
}

/* ------------------------------------------------------------------ */
/* Settings panel (built from FIELDS)                                  */
/* ------------------------------------------------------------------ */

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fieldHtml(f) {
    if (f.section) return `</div><h4 class="de-section">${esc(f.section)}</h4><div class="de-fields">`;
    const row = (inner) => `<div class="de-row${f.grid ? ' de-col' : ''}" data-row="${f.key}">${inner}</div>`;
    const hint = f.hint ? `<small>${esc(f.hint)}</small>` : '';
    const label = `<label>${esc(f.label)}</label>`;
    const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';

    switch (f.type) {
        case 'bool':
            return `<label class="checkbox_label de-check" data-row="${f.key}"><input type="checkbox" data-key="${f.key}"><span>${esc(f.label)}</span></label>`;
        case 'select':
            return row(`${label}<select class="text_pole" data-key="${f.key}">${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>${hint}`);
        case 'number':
            return row(`${label}<input type="number" class="text_pole" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}">${hint}`);
        case 'text':
            return row(`${label}<input type="text" class="text_pole" data-key="${f.key}"${ph}>${hint}`);
        case 'area':
            return row(
                `${label}<textarea class="text_pole" data-key="${f.key}"${ph}></textarea>` +
                    (f.fill ? `<div class="menu_button de-fill" data-fill="${f.fill}" data-target="${f.key}">Insert the built-in instruction</div>` : '') +
                    hint,
            );
        default:
            return '';
    }
}

function applyVisibility() {
    const s = settings();
    for (const f of FIELDS) if (f.showIf) $(`#de_settings [data-row="${f.key}"]`).toggleClass('displayNone', !f.showIf(s));
}

function buildSettings() {
    $('#de_settings').remove();
    const html = `
<div id="de_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Draft Enhancer <small class="de-beta">beta</small></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="de-fields">${FIELDS.map(fieldHtml).join('')}</div>
      <div class="de-row"><div class="menu_button" id="de_reset">Reset everything to defaults</div></div>
      <small>Draft Enhancer follows your active preset: it runs through SillyTavern's Impersonate, so your preset, its jailbreak, its impersonation prompt, lorebooks and history all apply. The result always goes into your message box.</small>
    </div>
  </div>
</div>`;
    ($('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings')).append(html);
    syncSettings();

    $('#de_settings').on('input change', '[data-key]', function () {
        const f = FIELDS.find((x) => x.key === this.dataset.key);
        let v = this.type === 'checkbox' ? this.checked : this.value;
        if (f?.type === 'number') v = clamp(num(v, f.def), f.min, f.max);
        settings()[this.dataset.key] = v;
        save();
        applyVisibility();
        updateButton();
        if (this.dataset.key === 'wandMenu') buildUI();
    });

    $('#de_settings').on('click', '.de-fill', function () {
        const kind = this.dataset.fill;
        const text = buildNote(kind, kind === 'enhance' ? '{{draft}}' : '{{direction}}', { ...settings(), [kind === 'enhance' ? 'templateEnhance' : 'templateWrite']: '' });
        $(`#de_settings [data-key="${this.dataset.target}"]`).val(text).trigger('input');
    });

    $('#de_reset').on('click', () => {
        Object.assign(settings(), DEFAULTS);
        save();
        syncSettings();
        buildUI();
        toastr.success('Settings reset', 'Draft Enhancer', { timeOut: 1500 });
    });
}

function syncSettings() {
    const s = settings();
    $('#de_settings [data-key]').each((_, el) => {
        if (el.type === 'checkbox') el.checked = !!s[el.dataset.key];
        else el.value = s[el.dataset.key] ?? '';
    });
    applyVisibility();
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

async function registerCommands() {
    try {
        const [{ SlashCommandParser }, { SlashCommand }, { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument }] = await Promise.all([
            import('../../../slash-commands/SlashCommandParser.js'),
            import('../../../slash-commands/SlashCommand.js'),
            import('../../../slash-commands/SlashCommandArgument.js'),
        ]);
        const add = (name, alias, kind, help, argHelp) =>
            SlashCommandParser.addCommandObject(
                SlashCommand.fromProps({
                    name,
                    aliases: [alias],
                    callback: async (args, value) => (await run(kind, String(value || '').trim() || undefined, args?.as ? String(args.as) : undefined)) ?? '',
                    returns: 'the text placed in the message box',
                    namedArgumentList: [
                        SlashCommandNamedArgument.fromProps({
                            name: 'as',
                            description: 'who to write as, for this run only',
                            typeList: [ARGUMENT_TYPE.STRING],
                            isRequired: false,
                            enumList: SUBJECTS.map(([v]) => v),
                        }),
                    ],
                    unnamedArgumentList: [SlashCommandArgument.fromProps({ description: argHelp, typeList: [ARGUMENT_TYPE.STRING], isRequired: false })],
                    helpString: help,
                }),
            );
        add('enhance-draft', 'enhance', 'enhance', 'Rewrites your draft into a finished message, following your preset.', 'draft (defaults to the message box)');
        add('write-for-me', 'writeforme', 'write', 'Writes the next message for you, following your preset.', 'optional direction (defaults to the message box)');
    } catch (err) {
        console.warn(TAG, 'slash commands unavailable', err);
    }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

globalThis.DraftEnhancer = {
    enhance: (text, as) => run('enhance', text, as),
    write: (direction, as) => run('write', direction, as),
    undo,
    getLastPrompt: () => state.lastPrompt,
    getLastOutput: () => state.lastOutput,
    getHistory: () => [...state.history],
    _internals: { settings, buildNote, buildRules, lengthRange, clean, trimUnfinished, roles, barAction, state, FIELDS, DEFAULTS },
};

jQuery(async () => {
    try {
        settings();
        syncAnim();
        buildSettings();
        buildUI();
        bindEvents();
        await registerCommands();
        console.log(TAG, 'loaded');
    } catch (err) {
        console.error(TAG, 'failed to load', err);
    }
});

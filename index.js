/*
 * Draft Enhancer — SillyTavern extension
 *
 *  • Enhance my draft        : rewrites whatever is in the message box (even a few words) into a full,
 *                              polished roleplay message that fits the chat.
 *  • Write something for me  : writes {{user}}'s next message (optionally steered by what you typed).
 *
 * Generation modes:
 *  • "Preset" (default): runs through SillyTavern's own Impersonate pipeline, the same one the
 *    Impersonate button uses. Your preset (main prompt, jailbreak, post-history instructions, all enabled
 *    toggles), its Impersonation prompt and impersonation prefill, lorebooks, author's note, persona and
 *    chat history are all applied, plus a short instruction for the task. Streams into the message box.
 *  • "Background": a quiet request with the full context but without the preset's impersonation settings.
 *  • "Lightweight": sends only a compact context (card + persona + last few messages).
 */

const MODULE_NAME = 'draftEnhancer';
const TAG = '[Draft Enhancer]';
const SETTINGS_VERSION = 2;

const DEFAULTS = {
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    mode: 'preset', // 'preset' | 'context' | 'raw'
    preview: false,
    autoSend: false,
    shortcuts: true,
    extMenu: true, // also list the actions in SillyTavern's Extensions (wand) menu
    debug: false,

    length: 'balanced', // 'polish' | 'balanced' | 'rich' | 'match'
    creativity: 'balanced', // 'faithful' | 'balanced' | 'creative'
    minWords: 60,
    maxWords: 450,
    pov: 'auto', // 'auto' | 'first' | 'second' | 'third'
    format: 'auto', // 'auto' | 'asterisks' | 'plain'
    language: 'draft', // 'draft' | 'chat' | 'custom'
    customLanguage: '',
    enhanceExtra: '',

    writeWords: 0, // 0 = automatic (based on your own recent messages)
    writeExtra: '',

    cleanOutput: true, // remove headers, status/tracker panels, HTML and reasoning from the result
    instructionDetail: 'auto', // 'auto' | 'full' | 'lean' (Preset mode)
    instructionPlacement: 'chat', // 'chat' (your message at the end of the chat) | 'system' (final system note)
    historyDepth: 6,
    maxTokens: 0, // 0 = automatic (Background and Lightweight modes)
};

const state = {
    busy: false, // a task is active (including while the preview is open)
    generating: false, // a request is in flight
    cancelled: false,
    modalOpen: false,
    undoText: null,
    lastPrompt: '',
    lastOutput: '',
};

class CancelledError extends Error {
    constructor() {
        super('Cancelled');
        this.name = 'CancelledError';
    }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ctx = () => SillyTavern.getContext();
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const wordCount = (t) => (String(t || '').trim().match(/\S+/g) || []).length;
const cut = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
    const s = extensionSettings[MODULE_NAME];

    // Migration: 1.0.x saved 'context' as the default mode. Move those users to the new preset mode once.
    if (Object.keys(s).length && (s.settingsVersion ?? 1) < 2) {
        if (s.mode === 'context' || s.mode === undefined) s.mode = 'preset';
        s.settingsVersion = SETTINGS_VERSION;
    }

    for (const key of Object.keys(DEFAULTS)) {
        if (s[key] === undefined) s[key] = DEFAULTS[key];
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

const REASONING_TAGS = 'think|thinking|reasoning|thought|thoughts|cot|analysis|planning|checklist|internal_monologue';

function stripReasoning(text) {
    const pair = new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
    const orphanClose = new RegExp(`^[\\s\\S]*?<\\/(${REASONING_TAGS})>`, 'i');
    const unclosed = new RegExp(`<(${REASONING_TAGS})\\b[^>]*>[\\s\\S]*$`, 'i');
    return String(text ?? '').replace(pair, '').replace(orphanClose, '').replace(unclosed, '');
}

/** Message text with reasoning blocks and HTML tags removed (keeps line breaks). */
function messageText(m) {
    return stripReasoning(m.mes).replace(/<[^>]+>/g, '').trim();
}

function chatMessages() {
    return (ctx().chat || []).filter((m) => m && !m.is_system && typeof m.mes === 'string');
}

function lastCharacterWords() {
    const msgs = chatMessages();
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (!msgs[i].is_user) return wordCount(messageText(msgs[i]));
    }
    return 0;
}

/** Average length of the user's last few messages (0 if none). */
function userAverageWords(count = 4) {
    const mine = chatMessages().filter((m) => m.is_user).slice(-count);
    if (!mine.length) return 0;
    return Math.round(mine.reduce((sum, m) => sum + wordCount(messageText(m)), 0) / mine.length);
}

function names() {
    const c = ctx();
    const group = !!c.groupId;
    return {
        u: c.name1 || 'User',
        c: group ? 'the other characters' : c.name2 || 'the character',
    };
}

function detectFormat(draft) {
    const msgs = chatMessages();
    let sample = [draft, ...msgs.filter((m) => m.is_user).slice(-6).map((m) => m.mes)];
    if (sample.length === 1) sample = sample.concat(msgs.slice(-3).map((m) => m.mes));
    return /\*[^*\n]{2,}\*/.test(sample.join('\n')) ? 'asterisks' : 'plain';
}

/** Call a SillyTavern function that changed from positional args (old) to an options object (new). */
function callCompat(fn, options, legacyArgs) {
    if (typeof fn !== 'function') {
        throw new Error('This SillyTavern version is too old for Draft Enhancer. Please update SillyTavern.');
    }
    return fn.length >= 2 ? fn(...legacyArgs) : fn(options);
}

function mainGenerationRunning() {
    try {
        const el = document.getElementById('mes_stop');
        return !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* Prompt building                                                     */
/* ------------------------------------------------------------------ */

function computeTarget(kind, draftWords, s) {
    const lastWords = lastCharacterWords();
    const maxW = Math.max(Number(s.maxWords) || 450, kind === 'enhance' ? Math.round(draftWords * 1.5) : 0);
    const minW = Number(s.minWords) || 0;
    let target;

    if (kind === 'write') {
        if (Number(s.writeWords) > 0) {
            target = Number(s.writeWords);
        } else {
            // Automatic: a bit richer than your own recent turns, never tiny, never a whole narrator reply.
            const avg = userAverageWords();
            target = avg ? Math.max(avg * 1.3, minW + 20) : 120;
        }
        target = clamp(Math.round(target), 20, maxW);
    } else {
        switch (s.length) {
            case 'polish':
                target = draftWords * 1.25;
                break;
            case 'rich':
                target = Math.max(draftWords * 3.5, minW * 2);
                break;
            case 'match':
                target = lastWords || Math.max(draftWords * 2, minW);
                break;
            default:
                target = Math.max(draftWords * 2.2, minW);
        }
        target = Math.round(clamp(Math.max(target, draftWords * 1.1), 10, maxW));
    }

    return { target, lo: Math.round(target * 0.8), hi: Math.round(target * 1.25) };
}

function lengthRule(kind, s, t) {
    if (kind === 'enhance' && s.length === 'polish') {
        return `Light polish: stay close to the draft's length (about ${t.target} words). Fix wording, flow and clarity and add only a touch of detail.`;
    }
    const never = kind === 'enhance' ? ' Expand a short draft fully to this size; never end up shorter than the draft.' : '';
    return `Aim for about ${t.target} words (acceptable range ${t.lo}-${t.hi}).${never}`;
}

function povRule(kind, s, u) {
    if (s.pov === 'first') return `Write ${u}'s side in the first person ("I").`;
    if (s.pov === 'second') return `Write ${u}'s side in the second person ("you").`;
    if (s.pov === 'third') return `Write ${u}'s side in the third person (he/she/they or ${u}'s name).`;
    return kind === 'enhance'
        ? `Keep the draft's perspective and tense. If the draft is fragmentary or unclear, follow the perspective and tense of ${u}'s earlier messages in this chat, or else the narration style of the chat.`
        : `Follow the perspective and tense of ${u}'s earlier messages in this chat, or else the narration style of the chat.`;
}

function formatRule(s, draft) {
    const fmt = s.format === 'auto' ? detectFormat(draft) : s.format;
    return fmt === 'asterisks'
        ? 'Formatting: put actions, narration and thoughts inside *single asterisks* and spoken dialogue inside "double quotes". No other markup, headings or lists.'
        : 'Formatting: plain prose paragraphs with spoken dialogue in "double quotes". No asterisks, headings or lists.';
}

function languageRule(kind, s) {
    const custom = String(s.customLanguage || '').trim();
    if (s.language === 'custom' && custom) return `Write in ${custom}.`;
    if (s.language === 'chat') {
        return kind === 'enhance'
            ? 'Write in the language used by the rest of this chat. If the draft is in another language, translate it naturally instead of transliterating.'
            : 'Write in the language used by the rest of this chat.';
    }
    return kind === 'enhance'
        ? 'Write in the same language as the draft, even if earlier messages are in a different language.'
        : "Write in the same language as the player's direction; if there is none, use the language of this chat.";
}

const CREATIVITY_RULES = {
    faithful:
        'Do not add actions, events, decisions or dialogue content the draft does not already imply. Expand only through HOW things are done: sensory detail, body language, tone of voice, inner feeling and atmosphere.',
    balanced:
        'Keep every action and line of dialogue from the draft, in the same order. You may add small supporting beats (gestures, expressions, reactions to the surroundings, natural connecting phrases) but nothing that changes what the character does, decides or says, and no major new events.',
    creative:
        'Treat the draft as a skeleton: keep its intent and key beats, but you may develop them with richer dialogue, inner thoughts and vivid detail, as long as nothing contradicts the draft.',
};

/* ------------------------------------------------------------------ */
/* Preset awareness                                                    */
/* ------------------------------------------------------------------ */

/**
 * Looks at the active Chat Completion preset. Some presets are written for impersonation: they have prompts
 * that fire only on Impersonate (their own "write the user's turn" instructions) and/or switch their narrator
 * rules (headers, trackers, "never act for the user") off during Impersonate. For those, Draft Enhancer only
 * adds what the preset cannot know (the draft, the direction, your settings) and lets the preset lead.
 */
function getPresetInfo() {
    const c = ctx();
    const info = { api: c.mainApi || '', name: '', impersonationAware: false, impersonateOnlyPrompts: 0, narratorOnlyPrompts: 0 };
    try {
        info.name = c.getPresetManager?.()?.getSelectedPresetName?.() || '';
    } catch {
        /* ignore */
    }
    const oai = c.chatCompletionSettings;
    if (info.api !== 'openai' || !oai || !Array.isArray(oai.prompts)) return info;

    const orders = Array.isArray(oai.prompt_order) ? oai.prompt_order : [];
    const order = (orders.find((o) => String(o.character_id) === '100001') || orders[0])?.order || [];
    const enabled = new Set(order.filter((o) => o.enabled).map((o) => o.identifier));

    for (const pr of oai.prompts) {
        if (!enabled.has(pr.identifier)) continue;
        const trig = Array.isArray(pr.injection_trigger) ? pr.injection_trigger : [];
        if (!trig.length) continue;
        if (trig.includes('impersonate') && !trig.includes('normal')) info.impersonateOnlyPrompts++;
        if (!trig.includes('impersonate')) info.narratorOnlyPrompts++;
    }
    info.impersonationAware = info.impersonateOnlyPrompts > 0 || info.narratorOnlyPrompts > 0;
    return info;
}

/** 'full' = complete instruction; 'lean' = only what the preset cannot know. */
function resolveDetail(s, viaPreset) {
    if (!viaPreset) return 'full';
    if (s.instructionDetail === 'full' || s.instructionDetail === 'lean') return s.instructionDetail;
    return getPresetInfo().impersonationAware ? 'lean' : 'full';
}

/**
 * Presets usually tell the model never to act for {{user}} and to wrap every reply in extras (time/location
 * headers, status trackers, HTML panels, dice rolls). This lifts the first rule for this one reply and
 * keeps the extras out, while keeping the preset's style rules in force.
 */
function turnGuard(u, c) {
    return [
        `This reply is ${u}'s own message, written on the player's behalf. Any instruction not to act, speak, think or decide for ${u} is lifted for this reply only.`,
        `Keep following your other instructions for prose style, tone, vocabulary, banned words and content.`,
        `Leave out everything that belongs only to ${c}'s or the narrator's replies: response headers (time, date, location, weather), status panels, internal-state or tracker blocks, HTML, dice rolls, NPC actions and OOC notes. Response-length targets for ${c}'s replies do not apply here.`,
        'If you reason first, keep all reasoning inside think tags and put only the finished message after them.',
    ].join(' ');
}

/** Settings the user changed from Auto, phrased as short rules (used by the lean instruction). */
function forcedStyleRules(kind, s, draft) {
    const { u } = names();
    const rules = [];
    if (s.pov !== 'auto') rules.push(`Perspective: ${povRule(kind, s, u)}`);
    if (s.format !== 'auto') rules.push(formatRule(s, draft));
    return rules;
}

function normalizeOpts(opts) {
    if (typeof opts === 'boolean') return { viaPreset: opts, detail: 'full' };
    return { viaPreset: !!opts?.viaPreset, detail: opts?.detail || 'full' };
}

function buildEnhanceTask(draft, s, opts = {}) {
    const { viaPreset, detail } = normalizeOpts(opts);
    const { u, c } = names();
    const t = computeTarget('enhance', wordCount(draft), s);
    const extra = String(s.enhanceExtra || '').trim();

    if (viaPreset && detail === 'lean') {
        const rules = [
            `Faithfulness: ${CREATIVITY_RULES[s.creativity] || CREATIVITY_RULES.balanced} Never contradict the draft. Keep its meaning, tone and intensity.`,
            `Length: ${lengthRule('enhance', s, t)}`,
            `Language: ${languageRule('enhance', s)}`,
            ...forcedStyleRules('enhance', s, draft),
        ];
        if (extra) rules.push(`Player's notes: ${extra}`);
        const prompt = [
            `[${u}'s turn: the player wrote a rough draft of ${u}'s next message. Turn it into ${u}'s finished message, following all of your instructions for ${u}'s turn.]`,
            `<draft>\n${draft}\n</draft>`,
            rules.map((r) => `- ${r}`).join('\n'),
            `Output only ${u}'s finished message, starting with ${u}'s first word or action.`,
        ].join('\n\n');
        return { kind: 'enhance', prompt, t, draft, detail };
    }

    const head = viaPreset
        ? [
              `[OOC: ${u}'s turn. Rewrite the player's rough draft below into the finished message ${u} sends next. Do not reply to it or continue the story as ${c}.]`,
              turnGuard(u, c),
              `<draft>\n${draft}\n</draft>`,
          ]
        : [
              `[OOC TASK: REWRITE. This is NOT a roleplay turn. Do not reply to or continue the story as ${c}. Write no commentary, notes or explanations.]`,
              `The player typed a rough draft of ${u}'s next message. Rewrite it into the finished message ${u} sends in this roleplay. Use everything you know about this chat (scene, setting, characters, relationships, established tone and writing style) so the result fits seamlessly.`,
              `<draft>\n${draft}\n</draft>`,
          ];
    const reqs = [
        'Requirements:',
        `1. Faithfulness: ${CREATIVITY_RULES[s.creativity] || CREATIVITY_RULES.balanced} Never contradict the draft or the established story. Preserve the draft's meaning, tone and level of intensity; do not editorialize or add disclaimers.`,
        `2. Length: ${lengthRule('enhance', s, t)}`,
        `3. Perspective: ${povRule('enhance', s, u)}`,
        `4. ${formatRule(s, draft)}`,
        `5. Voice: match ${u}'s established voice (diction, personality, formality) from their earlier messages, and bring the descriptive richness of the chat's best writing without copying phrases from earlier messages.`,
        `6. Boundaries: write ONLY ${u}. Never write ${c}'s dialogue, actions, thoughts, feelings or reactions, and never resolve the moment for them. Stop where the draft stops, leaving room for ${c} to respond.`,
        `7. Language: ${languageRule('enhance', s)}`,
        '8. Quality: vary sentence rhythm, use concrete sensory detail and natural dialogue, avoid cliches and filler, and avoid repeating recent messages.',
    ];
    const tail = [];
    if (extra) tail.push(`Additional instructions from the player: ${extra}`);
    tail.push('Output ONLY the finished message text: no preface, labels, notes, <draft> tags, or quotation marks wrapped around the whole message.');

    const prompt = [...head, reqs.join('\n'), ...tail].join('\n\n');
    return { kind: 'enhance', prompt, t, draft, detail: 'full' };
}

function buildWriteTask(direction, s, opts = {}) {
    const { viaPreset, detail } = normalizeOpts(opts);
    const { u, c } = names();
    const t = computeTarget('write', wordCount(direction), s);
    const extra = String(s.writeExtra || '').trim();
    const dir = String(direction || '').trim();

    if (viaPreset && detail === 'lean') {
        // The preset already knows how to write the user's turn. Add only what it cannot know.
        const rules = [...forcedStyleRules('write', s, dir)];
        if (Number(s.writeWords) > 0) rules.push(`Length: ${lengthRule('write', s, t)}`);
        if (s.language !== 'draft') rules.push(`Language: ${languageRule('write', s)}`);
        if (extra) rules.push(`Player's notes: ${extra}`);
        if (!dir && !rules.length) return { kind: 'write', prompt: '', t, draft: dir, detail }; // pure native Impersonate
        const parts = [`[${u}'s turn: write ${u}'s next message.]`];
        if (dir) parts.push(`What ${u} does or says next (follow it closely):\n<direction>\n${dir}\n</direction>`);
        if (rules.length) parts.push(rules.map((r) => `- ${r}`).join('\n'));
        parts.push(`Output only ${u}'s message, starting with ${u}'s first word or action.`);
        return { kind: 'write', prompt: parts.join('\n\n'), t, draft: dir, detail };
    }

    const head = viaPreset
        ? [`[OOC: ${u}'s turn. Write ${u}'s next message, continuing naturally from the latest events.]`, turnGuard(u, c)]
        : [
              `[OOC TASK: WRITE ${u.toUpperCase()}'S TURN. Do not write as ${c}. Write no commentary, notes or explanations.]`,
              `Write ${u}'s next message in this roleplay, as ${u}, continuing naturally from the latest events. Use everything you know about this chat (scene, setting, characters, relationships, established tone and writing style) so it fits seamlessly.`,
          ];
    head.push(
        dir
            ? `The player's direction (follow it closely; it is what ${u} wants to do or say next):\n<direction>\n${dir}\n</direction>`
            : `No direction was given. Choose a natural, in-character next move for ${u} that fits the scene, moves the story forward and gives ${c} something to respond to.`,
    );
    const reqs = [
        'Requirements:',
        `1. Voice: match ${u}'s established voice (diction, personality, formality) from their earlier messages, with the descriptive richness of the chat's best writing, without copying earlier phrases.`,
        `2. Length: ${lengthRule('write', s, t)}`,
        `3. Perspective: ${povRule('write', s, u)}`,
        `4. ${formatRule(s, dir)}`,
        `5. Boundaries: write ONLY ${u}. Never write ${c}'s dialogue, actions, thoughts, feelings or reactions, and never resolve the moment for them. Leave room for ${c} to respond.`,
        `6. Language: ${languageRule('write', s)}`,
        '7. Quality: vary sentence rhythm, use concrete sensory detail and natural dialogue, avoid cliches and filler, and avoid repeating recent messages.',
    ];
    const tail = [];
    if (extra) tail.push(`Additional instructions from the player: ${extra}`);
    tail.push('Output ONLY the finished message text: no preface, labels, notes, <direction> tags, or quotation marks wrapped around the whole message.');

    const prompt = [...head, reqs.join('\n'), ...tail].join('\n\n');
    return { kind: 'write', prompt, t, draft: dir, detail: 'full' };
}

/** Compact context used by the lightweight (raw) mode. */
function buildRawContext(s) {
    const c = ctx();
    const { u, c: other } = names();
    const sub = (t) => (typeof c.substituteParams === 'function' ? c.substituteParams(String(t || '')) : String(t || ''));
    const out = [];

    const char = (c.characters || [])[c.characterId];
    if (char && !c.groupId) {
        const field = (k) => char.data?.[k] ?? char[k];
        const block = [
            ['Description', field('description')],
            ['Personality', field('personality')],
            ['Scenario', field('scenario')],
        ]
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => `${k}: ${cut(sub(v), 4000)}`)
            .join('\n');
        if (block) out.push(`### ${char.name || other} (character card)\n${block}`);
    }

    const persona = c.powerUserSettings?.persona_description;
    if (persona && String(persona).trim()) out.push(`### ${u} (the player's persona)\n${cut(sub(persona), 3000)}`);

    const depth = clamp(Number(s.historyDepth) || 0, 0, 30);
    const msgs = depth > 0 ? chatMessages().slice(-depth) : [];
    if (msgs.length) {
        out.push(
            '### Recent messages\n' +
                msgs.map((m) => `${m.name || (m.is_user ? u : other)}: ${cut(messageText(m), 1500)}`).join('\n\n'),
        );
    }
    return out.join('\n\n');
}

const RAW_SYSTEM =
    'You are a skilled roleplay co-writer and editor. You follow the task precisely and output only the requested text.';

/* ------------------------------------------------------------------ */
/* Output cleanup                                                      */
/* ------------------------------------------------------------------ */

// Blocks that never belong in the player's message: removed together with their content.
const DROP_BLOCKS = 'details|summary|internal_states|internal_state|status|stats|tracker|trackers|style|script|table|header|gm_notes|ooc';

function removePairedBlocks(text, tags) {
    // Innermost first, repeated, so nested panels (<details> inside <details>) are fully removed.
    const re = new RegExp(`<(${tags})\\b[^>]*>(?:(?!<(?:${tags})\\b)[\\s\\S])*?<\\/\\1\\s*>`, 'gi');
    let prev;
    let guard = 0;
    do {
        prev = text;
        text = text.replace(re, '');
    } while (text !== prev && ++guard < 20);
    return text;
}

/** Removes preset extras (headers, panels, HTML, reasoning) and wrapper noise from the model output. */
function cleanOutput(raw, { deep = true } = {}) {
    let t = stripReasoning(raw).trim();
    t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');

    if (deep) {
        t = t.replace(/<!--[\s\S]*?-->/g, '');
        t = removePairedBlocks(t, DROP_BLOCKS);
        t = t.replace(new RegExp(`<(${DROP_BLOCKS})\\b[\\s\\S]*$`, 'i'), ''); // cut-off panel at the end
        const withoutTags = t.replace(/<\/?[a-z][\w-]*(\s[^<>]*)?\/?>/gi, ''); // keep text inside other tags (e.g. <font>)
        t = withoutTags;
        // Status headers such as "[ 🕰️ 08:15 AM | Day 3 | 📍 Tavern | ☀️ 70°F ]"
        t = t.replace(/^\s*\[[^\]\n]*\|[^\]\n]*\|[^\]\n]*\]\s*$/gm, '');
    }

    t = t.replace(/<\/?(draft|direction|rewrite|rewritten|output)>/gi, '');
    t = t.replace(/^\s*(\*\*)?(rewritten|enhanced|revised|final)(\s+(message|draft|version|text))?(\*\*)?\s*[:：-]\s*(\*\*)?\s*/i, '');
    const { u } = names();
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\s*${esc}\\s*:\\s*`, 'i'), '');
    t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    return t.trim();
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

const INJECT_KEY = 'draft_enhancer_instruction';
const IN_CHAT = 1; // extension_prompt_types.IN_CHAT
const ROLE_USER = 1; // extension_prompt_roles.USER

/**
 * Preset mode: SillyTavern's Impersonate pipeline. The instruction is added either as a user message at the
 * end of the chat (merged with the preset's own impersonation message, if it has one) or as SillyTavern's
 * final quiet prompt (system role). With nothing to add, it is a plain Impersonate.
 */
async function generateViaPreset(task, s) {
    const c = ctx();
    if (typeof c.generate !== 'function') {
        throw new Error('This SillyTavern version does not support Preset mode. Update SillyTavern or switch the mode in the Draft Enhancer settings.');
    }
    state.lastPrompt = task.prompt;

    const useChat = task.prompt && s.instructionPlacement !== 'system' && typeof c.setExtensionPrompt === 'function';
    const options = {};
    if (task.prompt && !useChat) Object.assign(options, { quiet_prompt: task.prompt, quietToLoud: true });

    // Same as SillyTavern's /impersonate: start from an empty box (the draft is already captured).
    setBoxText('', false);

    let ret;
    try {
        if (useChat) c.setExtensionPrompt(INJECT_KEY, task.prompt, IN_CHAT, 0, false, ROLE_USER);
        ret = await c.generate('impersonate', options);
    } catch (err) {
        if (state.cancelled) throw new CancelledError();
        throw err;
    } finally {
        if (useChat) {
            try {
                c.setExtensionPrompt(INJECT_KEY, '', IN_CHAT, 0, false, ROLE_USER);
            } catch {
                /* ignore */
            }
        }
    }
    if (state.cancelled) throw new CancelledError();

    const boxText = String(document.getElementById('send_textarea')?.value ?? '');
    const retText = typeof ret === 'string' || ret instanceof String ? String(ret) : '';
    return boxText.trim() ? boxText : retText;
}

/** Background and Lightweight modes: a separate request that does not touch the message box. */
async function generateDetached(task, s) {
    const c = ctx();
    const maxTokens = Number(s.maxTokens) > 0 ? Number(s.maxTokens) : clamp(Math.round(task.t.hi * 4) + 150, 300, 3000);

    if (s.mode === 'raw') {
        const context = buildRawContext(s);
        const prompt = (context ? context + '\n\n' : '') + task.prompt;
        state.lastPrompt = `${RAW_SYSTEM}\n\n${prompt}`;
        return await callCompat(
            c.generateRaw,
            { prompt, api: null, instructOverride: false, quietToLoud: false, systemPrompt: RAW_SYSTEM, responseLength: maxTokens },
            [prompt, null, false, false, RAW_SYSTEM, maxTokens],
        );
    }

    state.lastPrompt = task.prompt;
    return await callCompat(
        c.generateQuietPrompt,
        { quietPrompt: task.prompt, quietToLoud: false, skipWIAN: false, responseLength: maxTokens, removeReasoning: true },
        [task.prompt, false, false, null, null, maxTokens],
    );
}

async function generate(task) {
    const s = getSettings();
    state.cancelled = false;
    state.generating = true;
    updateButton();

    try {
        const out = s.mode === 'preset' ? await generateViaPreset(task, s) : await generateDetached(task, s);
        if (state.cancelled) throw new CancelledError();

        state.lastOutput = String(out ?? '');
        if (s.debug) console.log(TAG, `mode=${s.mode} detail=${task.detail} preset=${JSON.stringify(getPresetInfo())}\nprompt:\n${state.lastPrompt || '(none: plain Impersonate)'}\n\noutput:\n${state.lastOutput}`);

        const cleaned = cleanOutput(out, { deep: !!s.cleanOutput });
        if (!cleaned) {
            throw new Error('The model returned an empty response. Check the API connection, or raise the response length (max tokens) if you use a reasoning model.');
        }
        return cleaned;
    } catch (err) {
        if (state.cancelled) throw new CancelledError();
        throw err;
    } finally {
        state.generating = false;
        updateButton();
    }
}

function cancelGeneration() {
    if (!state.generating) return;
    state.cancelled = true;
    try {
        ctx().stopGeneration?.();
    } catch (e) {
        console.warn(TAG, 'stopGeneration failed', e);
    }
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

function setBoxText(text, focus = true) {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (!focus) return;
    ta.focus();
    try {
        ta.setSelectionRange(text.length, text.length);
    } catch {
        /* ignore */
    }
}

async function runTask(kind, overrideText) {
    const s = getSettings();
    if (!s.enabled) return null;
    if (state.busy || state.modalOpen) {
        cancelGeneration();
        return null;
    }

    const c = ctx();
    if (c.characterId === undefined && !c.groupId) {
        toastr.warning('Open a chat with a character first.', 'Draft Enhancer');
        return null;
    }
    if (mainGenerationRunning()) {
        toastr.warning('Wait for the current reply to finish first.', 'Draft Enhancer');
        return null;
    }

    const original = String($('#send_textarea').val() ?? '');
    const input = String(overrideText ?? original).trim();
    if (kind === 'enhance' && !input) {
        toastr.warning('Type a draft in the message box first.', 'Draft Enhancer');
        return null;
    }

    const viaPreset = s.mode === 'preset';
    state.busy = true;
    closeMenu();
    updateButton();

    try {
        let result;
        for (;;) {
            const opts = { viaPreset, detail: resolveDetail(s, viaPreset) };
            const task = kind === 'enhance' ? buildEnhanceTask(input, s, opts) : buildWriteTask(input, s, opts);
            result = await generate(task);
            if (!s.preview) break;

            if (viaPreset) setBoxText(original, false);
            const decision = await showPreview(input, result, kind);
            if (decision.action === 'retry') continue;
            if (decision.action === 'cancel') return null;
            result = decision.text.trim();
            break;
        }
        if (!result) {
            if (viaPreset) setBoxText(original, false);
            return null;
        }

        state.undoText = original;
        setBoxText(result);
        toastr.success(kind === 'enhance' ? 'Draft enhanced' : 'Message written', 'Draft Enhancer', { timeOut: 1800 });
        if (s.autoSend) $('#send_but').trigger('click');
        return result;
    } catch (err) {
        if (viaPreset) setBoxText(original, false); // never lose the draft
        if (err instanceof CancelledError) {
            toastr.info('Cancelled', 'Draft Enhancer', { timeOut: 1500 });
        } else {
            console.error(TAG, err);
            toastr.error(String(err?.message || err), 'Draft Enhancer');
        }
        return null;
    } finally {
        state.busy = false;
        state.generating = false;
        updateButton();
    }
}

function undoLast() {
    if (state.undoText === null) {
        toastr.info('Nothing to undo.', 'Draft Enhancer', { timeOut: 1500 });
        return;
    }
    setBoxText(state.undoText);
    state.undoText = null;
    closeMenu();
}

/* ------------------------------------------------------------------ */
/* UI: send-form button + menu                                         */
/* ------------------------------------------------------------------ */

function updateButton() {
    const enabled = !!getSettings().enabled;
    const $b = $('#de_button');
    if ($b.length) {
        $b.toggleClass('de-busy', state.generating);
        $b.toggleClass('fa-feather-pointed', !state.generating);
        $b.toggleClass('fa-spinner fa-spin', state.generating);
        $b.attr('title', state.generating ? 'Working… tap to cancel' : 'Draft Enhancer');
        $b.toggleClass('displayNone', !enabled);
    }
    $('#de_ext_enhance, #de_ext_write').toggleClass('displayNone', !enabled);
}

/** Touch screens get slightly larger menu rows (same popup position as on desktop). */
function isTouchLayout() {
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch {
        return false;
    }
}

/*
 * The menu and the preview window are native <dialog> elements opened with showModal(). That puts them in
 * the browser's top layer, positioned against the screen itself, so they stay on-screen even when a theme
 * or another extension transforms or resizes the page (which breaks normal position:fixed elements).
 */
function openDialog(el, modal = true) {
    try {
        if (modal && typeof el.showModal === 'function') return el.showModal();
        if (typeof el.show === 'function') return el.show();
    } catch (err) {
        console.warn(TAG, 'dialog open failed, using fallback', err);
    }
    el.setAttribute('open', '');
}

function closeDialog(el) {
    if (!el || !el.hasAttribute('open')) return;
    try {
        if (typeof el.close === 'function') return el.close();
    } catch {
        /* ignore */
    }
    el.removeAttribute('open');
}

const menuEl = () => document.getElementById('de_menu');
const isMenuOpen = () => !!menuEl()?.hasAttribute('open');

function closeMenu() {
    closeDialog(menuEl());
}

/** Small popup anchored above the feather button, kept inside the screen. Same on phone and desktop. */
function positionMenu(m) {
    const btn = document.getElementById('de_button');
    const rect = btn ? btn.getBoundingClientRect() : { left: 8, top: window.innerHeight - 8 };
    const width = m.offsetWidth;
    const height = m.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const left = clamp(rect.left, 8, Math.max(8, vw - width - 8));
    let top = rect.top - height - 8;
    if (top < 8) top = clamp((rect.bottom ?? rect.top) + 8, 8, Math.max(8, vh - height - 8)); // no room above: open below
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
    m.style.visibility = 'visible';
}

function toggleMenu() {
    const m = menuEl();
    if (!m) return;
    if (isMenuOpen()) return closeMenu();

    $(m).find('[data-action="undo"]').toggleClass('de-disabled', state.undoText === null);
    m.classList.toggle('de-touch', isTouchLayout());
    m.style.cssText = 'visibility:hidden;left:0;top:0';
    openDialog(m, true);
    positionMenu(m);
}

function runAction(action) {
    closeMenu();
    if (action === 'enhance') runTask('enhance');
    else if (action === 'write') runTask('write');
    else if (action === 'undo') undoLast();
}

function buildUI() {
    closeMenu();
    $('#de_button, #de_menu, #de_ext_enhance, #de_ext_write').remove();

    const host = $('#leftSendForm').length ? $('#leftSendForm') : $('#send_form');
    host.append(
        '<div id="de_button" class="fa-solid fa-feather-pointed interactable" tabindex="0" role="button" title="Draft Enhancer"></div>',
    );

    $('body').append(`
        <dialog id="de_menu" class="de-menu" aria-label="Draft Enhancer">
            <div class="de-menu-inner">
                <div class="de-item" data-action="enhance"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Enhance my draft</span><kbd>Alt+E</kbd></div>
                <div class="de-item" data-action="write"><i class="fa-solid fa-pen-nib"></i><span>Write something for me</span><kbd>Alt+W</kbd></div>
                <div class="de-sep"></div>
                <div class="de-item" data-action="undo"><i class="fa-solid fa-rotate-left"></i><span>Undo last change</span><kbd>Alt+Z</kbd></div>
            </div>
        </dialog>
    `);

    // Second entry point: SillyTavern's own Extensions (wand) menu.
    const $ext = $('#extensionsMenu');
    if ($ext.length && getSettings().extMenu) {
        const item = (id, icon, label) =>
            `<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="${label}">` +
            `<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span></div>`;
        $ext.append(item('de_ext_enhance', 'fa-wand-magic-sparkles', 'Enhance my draft'));
        $ext.append(item('de_ext_write', 'fa-pen-nib', 'Write something for me'));
    }
    updateButton();
}

let lastTap = { key: '', at: 0 };
let windowHandlers = null;

/** True if the same control was activated moments ago (touch + synthesized click can both arrive). */
function isDuplicateTap(key) {
    const now = Date.now();
    if (lastTap.key === key && now - lastTap.at < 300) return true;
    lastTap = { key, at: now };
    return false;
}

function onButtonActivate() {
    if (isDuplicateTap('button')) return;
    if (state.generating) cancelGeneration();
    else toggleMenu();
}

function bindGlobalEvents() {
    $(document).off('.de');
    if (windowHandlers) {
        window.removeEventListener('click', windowHandlers.click, true);
        window.removeEventListener('mousedown', windowHandlers.mousedown, true);
    }

    // Capture-phase listeners on window: they run before any other handler, so nothing in the page can swallow the tap.
    const click = (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (!t) return;

        if (t.closest('#de_button')) return onButtonActivate();

        const item = t.closest('#de_menu .de-item');
        if (item) {
            if (item.classList.contains('de-disabled') || isDuplicateTap(`item:${item.dataset.action}`)) return;
            return runAction(item.dataset.action);
        }

        const ext = t.closest('#de_ext_enhance, #de_ext_write');
        if (ext) {
            if (isDuplicateTap(`ext:${ext.id}`)) return;
            try {
                $('#extensionsMenu').hide();
            } catch {
                /* ignore */
            }
            return runTask(ext.id === 'de_ext_write' ? 'write' : 'enhance');
        }

        // A click outside the popup lands on its (invisible) backdrop, which targets the <dialog> itself.
        if (isMenuOpen() && (t.id === 'de_menu' || !t.closest('#de_menu'))) closeMenu();
    };

    // Do not steal focus from the message box when pressing the feather button.
    const mousedown = (e) => {
        const t = e.target instanceof Element ? e.target : null;
        if (t && t.closest('#de_button, #de_ext_enhance, #de_ext_write')) e.preventDefault();
    };

    window.addEventListener('click', click, true);
    window.addEventListener('mousedown', mousedown, true);
    windowHandlers = { click, mousedown };

    $(document).on('keydown.de', '#de_button', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onButtonActivate();
        }
    });

    // Reposition / close the popup when the screen changes (rotation, on-screen keyboard).
    $(window).off('.de').on('resize.de', () => {
        if (isMenuOpen()) positionMenu(menuEl());
    });

    // Keyboard shortcuts (based on physical key positions, so they work with any keyboard layout).
    $(document).on('keydown.de', '#send_textarea', (e) => {
        if (!getSettings().shortcuts || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const map = { KeyE: () => runTask('enhance'), KeyW: () => runTask('write'), KeyZ: undoLast };
        const fn = map[e.code];
        if (fn) {
            e.preventDefault();
            fn();
        }
    });
}

/* ------------------------------------------------------------------ */
/* UI: preview window                                                  */
/* ------------------------------------------------------------------ */

function showPreview(original, result, kind) {
    return new Promise((resolve) => {
        closeMenu();
        state.modalOpen = true;

        const $m = $(`
            <dialog class="de-modal" id="de_modal" aria-label="Draft Enhancer preview">
                <div class="de-modal-box">
                    <div class="de-modal-title"></div>
                    <details class="de-original">
                        <summary></summary>
                        <pre class="de-original-text" dir="auto"></pre>
                    </details>
                    <textarea id="de_preview_text" class="text_pole" dir="auto"></textarea>
                    <div class="de-modal-actions">
                        <div class="menu_button" data-act="cancel">Cancel</div>
                        <div class="menu_button" data-act="retry"><i class="fa-solid fa-rotate"></i> Retry</div>
                        <div class="menu_button" data-act="use"><i class="fa-solid fa-check"></i> Use this</div>
                    </div>
                </div>
            </dialog>
        `);

        $m.find('.de-modal-title').text(kind === 'write' ? 'Write something for me' : 'Enhance my draft');
        $m.find('summary').text(kind === 'write' ? 'Your direction' : 'Original draft');
        $m.find('.de-original-text').text(original || '(none)');
        $m.find('#de_preview_text').val(result);

        let finished = false;
        const done = (action) => {
            if (finished) return;
            finished = true;
            const text = String($m.find('#de_preview_text').val() ?? '');
            closeDialog($m[0]);
            $m.remove();
            state.modalOpen = false;
            resolve({ action, text });
        };

        $m.on('click', '[data-act]', function () {
            done(this.dataset.act);
        });
        // A press on the backdrop targets the <dialog> itself (the box covers the rest). mousedown, not click,
        // so selecting text in the box and releasing outside does not close it.
        $m.on('mousedown', (e) => {
            if (e.target === $m[0]) done('cancel');
        });
        // Escape key / Android back gesture
        $m.on('cancel', (e) => {
            e.preventDefault();
            done('cancel');
        });

        $('body').append($m);
        openDialog($m[0], true);
        $m.find('#de_preview_text').trigger('focus');
    });
}

/* ------------------------------------------------------------------ */
/* UI: settings panel                                                  */
/* ------------------------------------------------------------------ */

const SETTINGS_HTML = `
<div id="de_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Draft Enhancer</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">

      <label class="checkbox_label"><input type="checkbox" data-key="enabled"><span>Enable Draft Enhancer</span></label>

      <h4>General</h4>
      <div class="de-row">
        <label>Generation mode</label>
        <select class="text_pole" data-key="mode">
          <option value="preset">Preset (recommended): same pipeline as Impersonate</option>
          <option value="context">Background: full context, no impersonation settings</option>
          <option value="raw">Lightweight: card + persona + last messages only</option>
        </select>
        <small>Preset mode uses everything the Impersonate button uses: your preset with its jailbreak and toggles, its Impersonation prompt and prefill, lorebooks and chat history. The result streams into the message box. Use the other modes only if a preset misbehaves.</small>
      </div>
      <div class="de-grid">
        <div class="de-row">
          <label>Instruction detail (Preset mode)</label>
          <select class="text_pole" data-key="instructionDetail">
            <option value="auto">Auto: adapt to the preset</option>
            <option value="lean">Lean: let the preset lead</option>
            <option value="full">Full: complete instruction</option>
          </select>
        </div>
        <div class="de-row">
          <label>Instruction placement (Preset mode)</label>
          <select class="text_pole" data-key="instructionPlacement">
            <option value="chat">As your message at the end of the chat</option>
            <option value="system">As a final system note</option>
          </select>
        </div>
      </div>
      <small>Auto uses a short instruction when the preset has its own Impersonate prompts, and a full one when it does not. With Lean and nothing typed, "Write something for me" is a plain Impersonate.</small>
      <label class="checkbox_label"><input type="checkbox" data-key="preview"><span>Preview before applying (Use / Retry / Cancel)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="autoSend"><span>Send automatically after generating</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="cleanOutput"><span>Clean preset extras from the result (headers, status panels, HTML, reasoning)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="shortcuts"><span>Keyboard shortcuts in the message box (Alt+E enhance, Alt+W write, Alt+Z undo)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="extMenu"><span>Also show the actions in the Extensions (wand) menu</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="debug"><span>Log prompts and outputs to the browser console</span></label>

      <h4>Enhance my draft</h4>
      <div class="de-grid">
        <div class="de-row">
          <label>Length</label>
          <select class="text_pole" data-key="length">
            <option value="polish">Light polish (about 1.25x)</option>
            <option value="balanced">Balanced (about 2x)</option>
            <option value="rich">Rich (about 3.5x)</option>
            <option value="match">Match the last character message</option>
          </select>
        </div>
        <div class="de-row">
          <label>Creativity</label>
          <select class="text_pole" data-key="creativity">
            <option value="faithful">Faithful (no new content)</option>
            <option value="balanced">Balanced</option>
            <option value="creative">Creative (develop the idea)</option>
          </select>
        </div>
        <div class="de-row">
          <label>Perspective</label>
          <select class="text_pole" data-key="pov">
            <option value="auto">Auto (follow my draft/history)</option>
            <option value="first">First person</option>
            <option value="second">Second person</option>
            <option value="third">Third person</option>
          </select>
        </div>
        <div class="de-row">
          <label>Formatting</label>
          <select class="text_pole" data-key="format">
            <option value="auto">Auto-detect from chat</option>
            <option value="asterisks">*Actions* and "dialogue"</option>
            <option value="plain">Plain prose and "dialogue"</option>
          </select>
        </div>
        <div class="de-row">
          <label>Minimum words for short drafts</label>
          <input type="number" class="text_pole" data-key="minWords" min="0" max="1000" step="10">
        </div>
        <div class="de-row">
          <label>Maximum words</label>
          <input type="number" class="text_pole" data-key="maxWords" min="50" max="3000" step="25">
        </div>
        <div class="de-row">
          <label>Output language</label>
          <select class="text_pole" data-key="language">
            <option value="draft">Same as my draft</option>
            <option value="chat">Same as the chat</option>
            <option value="custom">Custom…</option>
          </select>
        </div>
        <div class="de-row">
          <label>Custom language</label>
          <input type="text" class="text_pole" data-key="customLanguage" placeholder="e.g. English">
        </div>
      </div>
      <div class="de-row">
        <label>Extra instructions</label>
        <textarea class="text_pole" data-key="enhanceExtra" placeholder="e.g. Keep sentences short. Avoid purple prose."></textarea>
      </div>

      <h4>Write something for me</h4>
      <div class="de-row">
        <label>Target words (0 = automatic)</label>
        <input type="number" class="text_pole" data-key="writeWords" min="0" max="1500" step="10">
        <small>Automatic is based on the length of your own recent messages. Anything you typed in the message box is used as the direction.</small>
      </div>
      <div class="de-row">
        <label>Extra instructions</label>
        <textarea class="text_pole" data-key="writeExtra" placeholder="e.g. Keep my character guarded and sarcastic."></textarea>
      </div>

      <h4>Advanced</h4>
      <div class="de-grid">
        <div class="de-row">
          <label>Messages of history (Lightweight mode)</label>
          <input type="number" class="text_pole" data-key="historyDepth" min="0" max="30" step="1">
        </div>
        <div class="de-row">
          <label>Max tokens (0 = automatic)</label>
          <input type="number" class="text_pole" data-key="maxTokens" min="0" max="8000" step="50">
          <small>Background and Lightweight modes only. Preset mode uses your preset's response length.</small>
        </div>
      </div>
      <div class="menu_button" id="de_reset">Reset to defaults</div>
    </div>
  </div>
</div>`;

function syncSettingsUI() {
    const s = getSettings();
    $('#de_settings')
        .find('[data-key]')
        .each((_, el) => {
            const v = s[el.dataset.key];
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v ?? '';
        });
}

function buildSettingsPanel() {
    $('#de_settings').remove();
    const host = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    host.append(SETTINGS_HTML);
    syncSettingsUI();

    $('#de_settings').on('input change', '[data-key]', function () {
        const s = getSettings();
        const key = this.dataset.key;
        let v;
        if (this.type === 'checkbox') {
            v = this.checked;
        } else if (this.type === 'number') {
            v = Number(this.value);
            if (!Number.isFinite(v)) v = DEFAULTS[key];
            v = clamp(v, Number(this.min) || 0, Number(this.max) || Number.MAX_SAFE_INTEGER);
        } else {
            v = this.value;
        }
        s[key] = v;
        saveSettings();
        if (key === 'enabled') updateButton();
        if (key === 'extMenu') buildUI();
    });

    $('#de_reset').on('click', () => {
        Object.assign(getSettings(), DEFAULTS);
        saveSettings();
        syncSettingsUI();
        buildUI();
        toastr.success('Settings reset', 'Draft Enhancer', { timeOut: 1500 });
    });
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

async function registerSlashCommands() {
    try {
        const [{ SlashCommandParser }, { SlashCommand }, { ARGUMENT_TYPE, SlashCommandArgument }] = await Promise.all([
            import('../../../slash-commands/SlashCommandParser.js'),
            import('../../../slash-commands/SlashCommand.js'),
            import('../../../slash-commands/SlashCommandArgument.js'),
        ]);

        const arg = (description) => [
            SlashCommandArgument.fromProps({ description, typeList: [ARGUMENT_TYPE.STRING], isRequired: false }),
        ];

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'enhance-draft',
                aliases: ['enhance'],
                callback: async (_args, value) => (await runTask('enhance', String(value || '').trim() || undefined)) ?? '',
                returns: 'the enhanced message (also placed in the message box)',
                unnamedArgumentList: arg('draft text (defaults to the message box)'),
                helpString: 'Rewrites your draft into a polished message that fits the chat, and puts it in the message box.',
            }),
        );

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'write-for-me',
                aliases: ['writeforme'],
                callback: async (_args, value) => (await runTask('write', String(value || '').trim() || undefined)) ?? '',
                returns: 'the generated message (also placed in the message box)',
                unnamedArgumentList: arg('optional direction (defaults to the message box)'),
                helpString: "Writes the user's next message, optionally steered by a direction, and puts it in the message box.",
            }),
        );
    } catch (err) {
        console.warn(TAG, 'Slash commands unavailable:', err);
    }
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

// Small public surface for debugging / other extensions.
globalThis.DraftEnhancer = {
    enhance: (text) => runTask('enhance', text),
    write: (direction) => runTask('write', direction),
    undo: undoLast,
    getLastPrompt: () => state.lastPrompt,
    getLastOutput: () => state.lastOutput,
    _internals: {
        getSettings,
        computeTarget,
        buildEnhanceTask,
        buildWriteTask,
        buildRawContext,
        getPresetInfo,
        resolveDetail,
        cleanOutput,
        stripReasoning,
        detectFormat,
        state,
    },
};

jQuery(async () => {
    try {
        getSettings();
        buildSettingsPanel();
        buildUI();
        bindGlobalEvents();
        await registerSlashCommands();
        console.log(`${TAG} loaded`);
    } catch (err) {
        console.error(`${TAG} failed to initialise`, err);
    }
});

/*
 * Draft Enhancer — SillyTavern extension
 *
 *  • Enhance my draft   : takes whatever is in the message box (even a few words) and rewrites it
 *                         into a full, polished roleplay message that fits the chat.
 *  • Write something for me : writes {{user}}'s next message for you (optionally steered by what you typed).
 *
 * Two generation modes:
 *  • "Full context" (default): uses SillyTavern's normal prompt pipeline (your preset, character card,
 *    persona, lorebook, author's note, chat history) plus a rewrite instruction. Results follow the
 *    model and preset you're using.
 *  • "Lightweight": sends only a compact context (card + persona + last few messages). Fast and cheap,
 *    and immune to presets that force the model to "continue the roleplay" instead of rewriting.
 */

const MODULE_NAME = 'draftEnhancer';
const TAG = '[Draft Enhancer]';

const DEFAULTS = {
    enabled: true,
    mode: 'context', // 'context' | 'raw'
    preview: false,
    autoSend: false,
    shortcuts: true,
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

    writeWords: 0, // 0 = match the length of the last character message
    writeExtra: '',

    historyDepth: 6,
    maxTokens: 0, // 0 = automatic
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
const hasArabic = (t) => /[؀-ۿ]/.test(String(t || ''));
const cut = (t, n) => (t.length > n ? t.slice(0, n) + '…' : t);

function getSettings() {
    const { extensionSettings } = ctx();
    if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
    const s = extensionSettings[MODULE_NAME];
    for (const key of Object.keys(DEFAULTS)) {
        if (s[key] === undefined) s[key] = DEFAULTS[key];
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

function stripReasoning(text) {
    return String(text ?? '')
        .replace(/<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi, '')
        .replace(/^[\s\S]*?<\/(think|thinking|reasoning|thought)>/i, '')
        .replace(/<(think|thinking|reasoning|thought)>[\s\S]*$/i, '');
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
        target = Number(s.writeWords) > 0 ? Number(s.writeWords) : lastWords || 120;
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
        "Do not add actions, events, decisions or dialogue content the draft does not already imply. Expand only through HOW things are done: sensory detail, body language, tone of voice, inner feeling and atmosphere.",
    balanced:
        "Keep every action and line of dialogue from the draft, in the same order. You may add small supporting beats (gestures, expressions, reactions to the surroundings, natural connecting phrases) but nothing that changes what the character does, decides or says, and no major new events.",
    creative:
        "Treat the draft as a skeleton: keep its intent and key beats, but you may develop them with richer dialogue, inner thoughts and vivid detail, as long as nothing contradicts the draft.",
};

function buildEnhanceTask(draft, s) {
    const { u, c } = names();
    const t = computeTarget('enhance', wordCount(draft), s);
    const extra = String(s.enhanceExtra || '').trim();

    const head = [
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
    return { kind: 'enhance', prompt, t, draft };
}

function buildWriteTask(direction, s) {
    const { u, c } = names();
    const t = computeTarget('write', wordCount(direction), s);
    const extra = String(s.writeExtra || '').trim();
    const dir = String(direction || '').trim();

    const head = [
        `[OOC TASK: WRITE ${u.toUpperCase()}'S TURN. Do not write as ${c}. Write no commentary, notes or explanations.]`,
        `Write ${u}'s next message in this roleplay, as ${u}, continuing naturally from the latest events. Use everything you know about this chat (scene, setting, characters, relationships, established tone and writing style) so it fits seamlessly.`,
        dir
            ? `The player's direction (follow it closely; it is what ${u} wants to do or say next):\n<direction>\n${dir}\n</direction>`
            : `No direction was given. Choose a natural, in-character next move for ${u} that fits the scene, moves the story forward and gives ${c} something to respond to.`,
    ];
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
    return { kind: 'write', prompt, t, draft: dir };
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
/* Generation                                                          */
/* ------------------------------------------------------------------ */

function cleanOutput(raw) {
    let t = stripReasoning(raw).trim();
    t = t.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
    t = t.replace(/<\/?(draft|direction|rewrite|rewritten|output)>/gi, '');
    t = t.replace(/^\s*(\*\*)?(rewritten|enhanced|revised|final)(\s+(message|draft|version|text))?(\*\*)?\s*[:：-]\s*(\*\*)?\s*/i, '');
    const { u } = names();
    const esc = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\s*${esc}\\s*:\\s*`, 'i'), '');
    return t.trim();
}

async function generate(task) {
    const c = ctx();
    const s = getSettings();
    const arabic = hasArabic(task.draft) || hasArabic(chatMessages().slice(-2).map((m) => m.mes).join(' '));
    const maxTokens =
        Number(s.maxTokens) > 0
            ? Number(s.maxTokens)
            : clamp(Math.round(task.t.hi * (arabic ? 4.5 : 3)) + 150, 300, 3000);

    state.cancelled = false;
    state.generating = true;
    updateButton();

    try {
        let out;
        if (s.mode === 'raw') {
            const context = buildRawContext(s);
            const prompt = (context ? context + '\n\n' : '') + task.prompt;
            state.lastPrompt = `${RAW_SYSTEM}\n\n${prompt}`;
            out = await callCompat(
                c.generateRaw,
                { prompt, api: null, instructOverride: false, quietToLoud: false, systemPrompt: RAW_SYSTEM, responseLength: maxTokens },
                [prompt, null, false, false, RAW_SYSTEM, maxTokens],
            );
        } else {
            state.lastPrompt = task.prompt;
            out = await callCompat(
                c.generateQuietPrompt,
                {
                    quietPrompt: task.prompt,
                    quietToLoud: false,
                    skipWIAN: false,
                    responseLength: maxTokens,
                    removeReasoning: true,
                },
                [task.prompt, false, false, null, null, maxTokens],
            );
        }

        if (state.cancelled) throw new CancelledError();

        state.lastOutput = String(out ?? '');
        if (s.debug) console.log(TAG, 'prompt:\n' + state.lastPrompt, '\noutput:\n' + state.lastOutput);

        const cleaned = cleanOutput(out);
        if (!cleaned) {
            throw new Error(
                'The model returned an empty response. If you use a reasoning model, raise "Max tokens" in the Draft Enhancer settings.',
            );
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

function setBoxText(text) {
    const ta = document.getElementById('send_textarea');
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
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

    state.busy = true;
    closeMenu();
    updateButton();

    try {
        let result;
        for (;;) {
            const task = kind === 'enhance' ? buildEnhanceTask(input, s) : buildWriteTask(input, s);
            result = await generate(task);
            if (!s.preview) break;

            const decision = await showPreview(input, result, kind);
            if (decision.action === 'retry') continue;
            if (decision.action === 'cancel') return null;
            result = decision.text.trim();
            break;
        }
        if (!result) return null;

        state.undoText = original;
        setBoxText(result);
        toastr.success(kind === 'enhance' ? 'Draft enhanced' : 'Message written', 'Draft Enhancer', { timeOut: 1800 });
        if (s.autoSend) $('#send_but').trigger('click');
        return result;
    } catch (err) {
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
    const $b = $('#de_button');
    if (!$b.length) return;
    $b.toggleClass('de-busy', state.generating);
    $b.toggleClass('fa-feather-pointed', !state.generating);
    $b.toggleClass('fa-spinner fa-spin', state.generating);
    $b.attr('title', state.generating ? 'Working… click to cancel' : 'Draft Enhancer');
    $b.toggleClass('displayNone', !getSettings().enabled);
}

function closeMenu() {
    $('#de_menu').hide();
}

function toggleMenu() {
    const $menu = $('#de_menu');
    if ($menu.is(':visible')) return closeMenu();

    $menu.find('[data-action="undo"]').toggleClass('de-disabled', state.undoText === null);
    $menu.css({ visibility: 'hidden', display: 'block' });

    const rect = document.getElementById('de_button').getBoundingClientRect();
    const width = $menu.outerWidth();
    const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - width - 8));
    $menu.css({ left: `${left}px`, bottom: `${window.innerHeight - rect.top + 8}px`, top: 'auto', visibility: 'visible' });
}

function buildUI() {
    $('#de_button, #de_menu').remove();

    const host = $('#leftSendForm').length ? $('#leftSendForm') : $('#send_form');
    host.append(
        '<div id="de_button" class="fa-solid fa-feather-pointed interactable" tabindex="0" role="button" title="Draft Enhancer"></div>',
    );

    $('body').append(`
        <div id="de_menu" class="de-menu" style="display:none">
            <div class="de-item" data-action="enhance"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Enhance my draft</span><kbd>Alt+E</kbd></div>
            <div class="de-item" data-action="write"><i class="fa-solid fa-pen-nib"></i><span>Write something for me</span><kbd>Alt+W</kbd></div>
            <div class="de-sep"></div>
            <div class="de-item" data-action="undo"><i class="fa-solid fa-rotate-left"></i><span>Undo last change</span><kbd>Alt+Z</kbd></div>
        </div>
    `);
    updateButton();
}

function bindGlobalEvents() {
    $(document).off('.de');

    $(document).on('click.de', '#de_button', (e) => {
        e.stopPropagation();
        if (state.generating) return cancelGeneration();
        toggleMenu();
    });

    $(document).on('keydown.de', '#de_button', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $('#de_button').trigger('click');
        }
    });

    $(document).on('click.de', '#de_menu .de-item', function () {
        const action = this.dataset.action;
        if (action === 'enhance') runTask('enhance');
        else if (action === 'write') runTask('write');
        else if (action === 'undo') undoLast();
    });

    $(document).on('click.de', (e) => {
        if (!$(e.target).closest('#de_menu, #de_button').length) closeMenu();
    });

    $(document).on('keydown.de', (e) => {
        if (e.key === 'Escape') closeMenu();
    });

    // Keyboard shortcuts (layout independent, works with Arabic keyboards). Only inside the message box.
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
/* UI: preview modal                                                   */
/* ------------------------------------------------------------------ */

function showPreview(original, result, kind) {
    return new Promise((resolve) => {
        closeMenu();
        state.modalOpen = true;

        const $m = $(`
            <div class="de-modal" id="de_modal">
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
            </div>
        `);

        $m.find('.de-modal-title').text(kind === 'write' ? 'Write something for me' : 'Enhance my draft');
        $m.find('summary').text(kind === 'write' ? 'Your direction' : 'Original draft');
        $m.find('.de-original-text').text(original || '(none)');
        $m.find('#de_preview_text').val(result);

        const done = (action) => {
            const text = String($m.find('#de_preview_text').val() ?? '');
            $m.remove();
            $(document).off('keydown.de_modal');
            state.modalOpen = false;
            resolve({ action, text });
        };

        $m.on('click', '[data-act]', function () {
            done(this.dataset.act);
        });
        $m.on('mousedown', (e) => {
            if (e.target === $m[0]) done('cancel');
        });
        $(document).on('keydown.de_modal', (e) => {
            if (e.key === 'Escape') done('cancel');
        });

        $('body').append($m);
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
          <option value="context">Full context (uses your preset, card, lorebook, history)</option>
          <option value="raw">Lightweight (card + persona + last messages only)</option>
        </select>
        <small>Full context follows your model and preset. If a preset makes the model reply as the character instead of rewriting, switch to Lightweight.</small>
      </div>
      <label class="checkbox_label"><input type="checkbox" data-key="preview"><span>Preview before applying (Use / Retry / Cancel)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="autoSend"><span>Send automatically after generating</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="shortcuts"><span>Keyboard shortcuts in the message box (Alt+E enhance, Alt+W write, Alt+Z undo)</span></label>
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
        <label>Target words (0 = match the last character message)</label>
        <input type="number" class="text_pole" data-key="writeWords" min="0" max="1500" step="10">
        <small>Anything you typed in the message box is used as the direction.</small>
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
          <small>Raise this for reasoning models if results come back empty.</small>
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
    });

    $('#de_reset').on('click', () => {
        Object.assign(getSettings(), DEFAULTS);
        saveSettings();
        syncSettingsUI();
        updateButton();
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
                returns: "the generated message (also placed in the message box)",
                unnamedArgumentList: arg("optional direction (defaults to the message box)"),
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
    _internals: { getSettings, computeTarget, buildEnhanceTask, buildWriteTask, buildRawContext, cleanOutput, stripReasoning, detectFormat, state },
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

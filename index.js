/*
 * Draft Enhancer (beta) — SillyTavern extension
 *
 * Janitor AI's "Enhance my draft" and "Write something for me", for SillyTavern.
 *
 * How it works: the request goes through SillyTavern's own generation, so your active preset
 * (main prompt, jailbreak, toggles, impersonation settings), lorebooks, persona and chat history apply.
 *   • Writing as you:            SillyTavern's Impersonate (the same path as the Impersonate button).
 *   • Writing as the character:  a quiet character turn (the path SillyTavern uses for background replies).
 * A short task note (your draft or direction, the length) is added as the last message.
 * The result lands in the message box, where you can edit it before sending.
 */

const MODULE = 'draftEnhancer';
const TAG = '[Draft Enhancer]';
const SETTINGS_VERSION = 3;
const NOTE_KEY = 'draft_enhancer_note';

const DEFAULTS = {
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    length: 'flexible', // 'flexible' | 'short' | 'medium' | 'long'
    speaker: 'user', // 'user' | 'char'
    extra: '',
    preview: false,
    autoSend: false,
    clean: true,
    debug: false,
};

/** Word ranges for the fixed lengths. Flexible is computed from your text (see lengthRange). */
const LENGTHS = { short: [30, 80], medium: [80, 180], long: [180, 350] };

const state = {
    busy: false, // a task is running (including while the preview is open)
    generating: false, // a request is in flight
    cancelled: false,
    undo: null, // message box text before the last change
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

/** 1.x had many more options. Keep what still means something, drop the rest. */
function migrate(s) {
    const old = { ...s };
    for (const k of Object.keys(s)) delete s[k];
    Object.assign(s, DEFAULTS);
    s.enabled = old.enabled ?? true;
    s.length = { polish: 'short', rich: 'long' }[old.length] || 'flexible';
    s.extra = [old.enhanceExtra, old.writeExtra].map((x) => String(x || '').trim()).filter(Boolean).join('\n');
    s.preview = !!old.preview;
    s.autoSend = !!old.autoSend;
    s.clean = old.cleanOutput ?? true;
    s.debug = !!old.debug;
}

const save = () => ctx().saveSettingsDebounced();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const words = (t) => (String(t || '').match(/\S+/g) || []).length;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function names() {
    const c = ctx();
    return { user: c.name1 || 'User', char: c.name2 || 'the character' };
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

/** Average length of the speaker's last few messages, ignoring reasoning and HTML. */
function recentWords(isUser) {
    const msgs = (ctx().chat || []).filter((m) => m && !m.is_system && !!m.is_user === isUser).slice(-4);
    if (!msgs.length) return 0;
    const total = msgs.reduce((n, m) => n + words(clean(m.mes, true)), 0);
    return Math.round(total / msgs.length);
}

function replyIsRunning() {
    const stop = document.getElementById('mes_stop');
    return !!stop && stop.offsetParent !== null && getComputedStyle(stop).display !== 'none';
}

/* ------------------------------------------------------------------ */
/* The task note                                                       */
/* ------------------------------------------------------------------ */

/** Target word range. Flexible scales with your draft (Enhance) or with the speaker's usual length (Write). */
function lengthRange(kind, draftWords, s) {
    let lo, hi;
    if (LENGTHS[s.length]) {
        [lo, hi] = LENGTHS[s.length];
    } else if (kind === 'enhance') {
        const d = draftWords;
        if (d < 15) [lo, hi] = [50, 120]; // a line or two: grow it into a full message
        else if (d < 60) [lo, hi] = [d * 1.6, d * 2.6]; // a short paragraph: about double
        else [lo, hi] = [d * 1.1, d * 1.6]; // already detailed: polish, little padding
    } else {
        const avg = recentWords(s.speaker !== 'char');
        [lo, hi] = avg ? [Math.max(30, avg * 0.8), Math.max(90, avg * 1.6)] : [60, 150];
    }
    if (kind === 'enhance') lo = Math.max(lo, draftWords); // never shorter than the draft
    hi = Math.max(hi, lo * 1.15, lo + 20);
    return [Math.round(lo), Math.round(clamp(hi, 40, 800))];
}

function lengthLine(kind, draftWords, s) {
    const [lo, hi] = lengthRange(kind, draftWords, s);
    if (s.length !== 'flexible') return `Length: about ${lo}-${hi} words.`;
    return kind === 'enhance'
        ? `Length: flexible. As long as the draft's content needs: a short draft becomes a full message, a detailed one is polished without padding (about ${lo}-${hi} words).`
        : `Length: flexible. As long as this moment needs (about ${lo}-${hi} words).`;
}

/**
 * The note added to the preset's own prompt. It only says what the preset cannot know:
 * the task, the draft or direction, the length and your notes. Style, tone and rules come from the preset.
 */
function buildNote(kind, text, s) {
    const { user, char } = names();
    const asChar = s.speaker === 'char';
    const who = asChar ? char : user;
    const other = asChar ? user : char;
    const piece = asChar ? 'reply' : 'message';
    const lines = [];

    if (kind === 'enhance') {
        lines.push(
            `[Enhance my draft: ${who}'s turn]`,
            `The player drafted ${who}'s next ${piece}:`,
            `<draft>\n${text}\n</draft>`,
            `Rewrite it into ${who}'s finished ${piece}, following your instructions and the style of this story.`,
            `- Keep every action, line of dialogue and decision from the draft, in the same order. Enrich how they happen (senses, body language, voice, inner thoughts) and add nothing that changes what happens.`,
            `- If the draft also says what ${other} does or says, keep it as written. Otherwise do not write for ${other}.`,
            `- Keep the draft's language, point of view and tense.`,
        );
    } else {
        lines.push(`[Write something for me: write ${who}'s next ${piece} for the player]`);
        lines.push(text ? `Follow the player's direction closely:\n<direction>\n${text}\n</direction>` : `Continue naturally from the last message.`);
        lines.push(
            `- Write only ${who}. Leave ${other}'s words and actions to ${other}.`,
            `- Follow the point of view, tense and formatting of ${who}'s earlier messages.`,
        );
    }
    lines.push(`- ${lengthLine(kind, words(text), s)}`);
    const extra = String(s.extra || '').trim();
    if (extra) lines.push(`- Player's notes: ${extra}`);
    lines.push(`Output only ${who}'s ${piece}: no scene header, status block, notes or reasoning.`);
    return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Cleaning the result                                                 */
/* ------------------------------------------------------------------ */

const THINK = 'think|thinking|reasoning|thought|thoughts|checklist|cot|analysis|planning|internal_monologue';
const PANELS = 'details|summary|internal_states|internal_state|status|stats|tracker|trackers|style|script|table|ooc';
const reThinkPair = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
const reThinkBefore = new RegExp(`^[\\s\\S]*?<\\/(${THINK})>`, 'i'); // reasoning whose opening tag was a prefill
const reThinkOpen = new RegExp(`<(${THINK})\\b[^>]*>[\\s\\S]*$`, 'i'); // reasoning cut off at the end
const rePanelPair = new RegExp(`<(${PANELS})\\b[^>]*>(?:(?!<(?:${PANELS})\\b)[\\s\\S])*?<\\/\\1\\s*>`, 'gi');
const rePanelOpen = new RegExp(`<(${PANELS})\\b[\\s\\S]*$`, 'i');

/**
 * Removes reasoning and wrapper noise. With `deep`, also removes what presets add to narrator replies:
 * scene headers like "[ 08:15 PM | Day 3 | Tavern ]", status/tracker panels, HTML comments and tags
 * (the text inside inline tags such as <font> is kept).
 */
function clean(raw, deep) {
    let t = String(raw ?? '').replace(reThinkPair, '').replace(reThinkBefore, '').replace(reThinkOpen, '').trim();
    t = t.replace(/^```[\w-]*\n?/, '').replace(/\n?```$/, '');
    if (deep) {
        t = t.replace(/<!--[\s\S]*?-->/g, '');
        for (let i = 0, prev = null; i < 20 && prev !== t; i++) {
            prev = t;
            t = t.replace(rePanelPair, ''); // innermost first, so nested panels go too
        }
        t = t.replace(rePanelOpen, '');
        t = t.replace(/<\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>/gi, '');
        t = t.replace(/^\s*\[[^\]\n]*\|[^\]\n]*\|[^\]\n]*\]\s*$/gm, '');
    }
    t = t.replace(/<\/?(draft|direction)>/gi, '');
    t = t.replace(/^\s*(?:\*\*)?(?:rewritten|enhanced|revised|final)(?: (?:message|draft|reply|version))?(?:\*\*)?\s*:\s*(?:\*\*)?/i, '');
    const { user, char } = names();
    for (const n of [user, char]) t = t.replace(new RegExp(`^\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i'), '');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/** Runs the note through SillyTavern with the active preset. Returns the raw text. */
async function generate(note, s) {
    const c = ctx();
    state.lastPrompt = note;

    if (s.speaker === 'char') {
        // A quiet character turn: the preset's narrator prompts apply, the chat is not changed.
        const quiet = c.generateQuietPrompt;
        return quiet.length >= 2 ? await quiet(note, false, false) : await quiet({ quietPrompt: note, removeReasoning: true });
    }

    // Impersonate: the preset's impersonation prompt, impersonate-only prompts, prefill and
    // user-input regex all apply. The note goes in as the last user message and is removed afterwards.
    setBox('', false); // like /impersonate: start from an empty box (the draft is already saved)
    c.setExtensionPrompt(NOTE_KEY, note, 1 /* in chat */, 0 /* depth */, false, 1 /* user role */);
    try {
        const ret = await c.generate('impersonate');
        const text = box()?.value ?? '';
        return text.trim() ? text : String(ret ?? '');
    } finally {
        c.setExtensionPrompt(NOTE_KEY, '', 1, 0, false, 1);
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

/** Enhance or Write. Returns the text placed in the box, or null. */
async function run(kind, overrideText) {
    const s = settings();
    if (!s.enabled) return null;
    if (state.busy) return cancel(), null;

    const c = ctx();
    if (c.characterId === undefined && !c.groupId) return toastr.warning('Open a chat first.', 'Draft Enhancer'), null;
    if (replyIsRunning()) return toastr.warning('Wait for the current reply to finish.', 'Draft Enhancer'), null;

    const original = box()?.value ?? '';
    const text = String(overrideText ?? original).trim();
    if (kind === 'enhance' && !text) return toastr.warning('Type a draft in the message box first.', 'Draft Enhancer'), null;

    state.busy = true;
    closeMenu();
    try {
        let result;
        for (;;) {
            state.cancelled = false;
            state.generating = true;
            updateButton();
            let raw;
            try {
                raw = await generate(buildNote(kind, text, s), s);
            } catch (err) {
                if (state.cancelled) throw new Cancelled();
                throw err;
            } finally {
                state.generating = false;
                updateButton();
            }
            if (state.cancelled) throw new Cancelled();

            state.lastOutput = String(raw ?? '');
            if (s.debug) console.log(TAG, `${kind} as ${s.speaker}\n--- note ---\n${state.lastPrompt}\n--- output ---\n${state.lastOutput}`);
            result = clean(raw, s.clean);
            if (!result) throw new Error('The model returned nothing usable. Check the connection, or raise the response length if your model uses reasoning.');

            if (!s.preview) break;
            setBox(original, false);
            const choice = await showPreview(text, result, kind);
            if (choice.action === 'cancel') return null;
            if (choice.action === 'use') {
                result = choice.text.trim();
                break;
            }
        }

        state.undo = original;
        setBox(result);
        toastr.success(kind === 'enhance' ? 'Draft enhanced' : 'Message written', 'Draft Enhancer', { timeOut: 1500 });
        if (s.autoSend) document.getElementById('send_but')?.click();
        return result;
    } catch (err) {
        setBox(original, false); // never lose the draft
        if (err instanceof Cancelled) toastr.info('Cancelled', 'Draft Enhancer', { timeOut: 1500 });
        else {
            console.error(TAG, err);
            toastr.error(String(err?.message || err), 'Draft Enhancer');
        }
        return null;
    } finally {
        state.busy = false;
        updateButton();
    }
}

function undo() {
    closeMenu();
    if (state.undo === null) return toastr.info('Nothing to undo.', 'Draft Enhancer', { timeOut: 1500 });
    setBox(state.undo);
    state.undo = null;
}

function toggleSpeaker() {
    const s = settings();
    s.speaker = s.speaker === 'char' ? 'user' : 'char';
    save();
    refreshMenu();
    $('#de_settings [data-key="speaker"]').val(s.speaker);
}

/* ------------------------------------------------------------------ */
/* Button and menu                                                     */
/* ------------------------------------------------------------------ */

const menu = () => document.getElementById('de_menu');
const menuOpen = () => !!menu()?.hasAttribute('open');

/*
 * The menu and the preview are <dialog> elements opened with showModal(). That puts them in the browser's
 * top layer, positioned against the screen, so themes that transform the page cannot push them off-screen.
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

const closeMenu = () => closeDialog(menu());

function updateButton() {
    const on = !!settings().enabled;
    $('#de_button')
        .toggleClass('displayNone', !on)
        .toggleClass('fa-feather-pointed', !state.generating)
        .toggleClass('fa-spinner fa-spin de-busy', state.generating)
        .attr('title', state.generating ? 'Working… tap to cancel' : 'Draft Enhancer');
    $('#de_ext_enhance, #de_ext_write').toggleClass('displayNone', !on);
}

function refreshMenu() {
    const { user, char } = names();
    const asChar = settings().speaker === 'char';
    $('#de_menu .de-speaker').text(`Writing as: ${asChar ? char : user}`);
    $('#de_menu [data-action="undo"]').toggleClass('de-disabled', state.undo === null);
}

/** Small popup above the feather button, kept inside the screen. Same on phone and desktop. */
function toggleMenu() {
    const m = menu();
    if (!m) return;
    if (menuOpen()) return closeMenu();

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
}

function buildUI() {
    closeMenu();
    $('#de_button, #de_menu, #de_ext_enhance, #de_ext_write').remove();

    ($('#leftSendForm').length ? $('#leftSendForm') : $('#send_form')).append(
        '<div id="de_button" class="fa-solid fa-feather-pointed interactable" tabindex="0" role="button" title="Draft Enhancer"></div>',
    );

    $('body').append(`
        <dialog id="de_menu" class="de-menu" aria-label="Draft Enhancer">
            <div class="de-menu-inner">
                <div class="de-item" data-action="enhance"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Enhance my draft</span><kbd>Alt+E</kbd></div>
                <div class="de-item" data-action="write"><i class="fa-solid fa-pen-nib"></i><span>Write something for me</span><kbd>Alt+W</kbd></div>
                <div class="de-sep"></div>
                <div class="de-item" data-action="speaker" title="Switch between writing as you and as the character"><i class="fa-solid fa-masks-theater"></i><span class="de-speaker"></span></div>
                <div class="de-item" data-action="undo"><i class="fa-solid fa-rotate-left"></i><span>Undo last change</span><kbd>Alt+Z</kbd></div>
            </div>
        </dialog>
    `);

    // Also in SillyTavern's Extensions (wand) menu.
    const item = (id, icon, label) =>
        `<div id="${id}" class="list-group-item flex-container flexGap5 interactable" tabindex="0">` +
        `<div class="fa-solid ${icon} extensionsMenuExtensionButton"></div><span>${label}</span></div>`;
    $('#extensionsMenu').append(item('de_ext_enhance', 'fa-wand-magic-sparkles', 'Enhance my draft'), item('de_ext_write', 'fa-pen-nib', 'Write something for me'));
    updateButton();
}

let lastTap = { key: '', at: 0 };
/** Touch screens can deliver the same tap twice; ignore the second one. */
function duplicateTap(key) {
    const now = Date.now();
    if (lastTap.key === key && now - lastTap.at < 300) return true;
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
            if (item.classList.contains('de-disabled') || duplicateTap(action)) return;
            if (action === 'speaker') return toggleSpeaker(); // menu stays open
            if (action === 'undo') return undo();
            return run(action);
        }
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

    $(document).on('keydown.de', '#de_button', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleMenu();
        }
    });
    // Shortcuts inside the message box. Physical key positions, so any keyboard layout works.
    $(document).on('keydown.de', '#send_textarea', (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const fn = { KeyE: () => run('enhance'), KeyW: () => run('write'), KeyZ: undo }[e.code];
        if (fn) {
            e.preventDefault();
            fn();
        }
    });
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

function showPreview(original, result, kind) {
    return new Promise((resolve) => {
        const $d = $(`
            <dialog class="de-modal" id="de_modal" aria-label="Draft Enhancer preview">
                <div class="de-modal-box">
                    <div class="de-modal-title"></div>
                    <details class="de-original"><summary></summary><pre class="de-original-text" dir="auto"></pre></details>
                    <textarea id="de_preview_text" class="text_pole" dir="auto"></textarea>
                    <div class="de-modal-actions">
                        <div class="menu_button" data-act="cancel">Cancel</div>
                        <div class="menu_button" data-act="retry"><i class="fa-solid fa-rotate"></i> Retry</div>
                        <div class="menu_button" data-act="use"><i class="fa-solid fa-check"></i> Use this</div>
                    </div>
                </div>
            </dialog>`);
        $d.find('.de-modal-title').text(kind === 'write' ? 'Write something for me' : 'Enhance my draft');
        $d.find('summary').text(kind === 'write' ? 'Your direction' : 'Your draft');
        $d.find('.de-original-text').text(original || '(none)');
        $d.find('#de_preview_text').val(result);

        let done = false;
        const finish = (action) => {
            if (done) return;
            done = true;
            const text = String($d.find('#de_preview_text').val() ?? '');
            closeDialog($d[0]);
            $d.remove();
            resolve({ action, text });
        };
        $d.on('click', '[data-act]', function () {
            finish(this.dataset.act);
        });
        // Backdrop press = cancel (mousedown, so selecting text and releasing outside does not close it).
        $d.on('mousedown', (e) => e.target === $d[0] && finish('cancel'));
        $d.on('cancel', (e) => (e.preventDefault(), finish('cancel'))); // Escape / back gesture

        $('body').append($d);
        openDialog($d[0]);
        $d.find('#de_preview_text').trigger('focus');
    });
}

/* ------------------------------------------------------------------ */
/* Settings panel                                                      */
/* ------------------------------------------------------------------ */

const SETTINGS_HTML = `
<div id="de_settings" class="extension_container">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>Draft Enhancer <small class="de-beta">beta</small></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <label class="checkbox_label"><input type="checkbox" data-key="enabled"><span>Enabled</span></label>
      <div class="de-grid">
        <div class="de-row">
          <label>Length</label>
          <select class="text_pole" data-key="length">
            <option value="flexible">Flexible (fits your text)</option>
            <option value="short">Short (30-80 words)</option>
            <option value="medium">Medium (80-180 words)</option>
            <option value="long">Long (180-350 words)</option>
          </select>
        </div>
        <div class="de-row">
          <label>Write as</label>
          <select class="text_pole" data-key="speaker">
            <option value="user">You (your persona)</option>
            <option value="char">The character</option>
          </select>
        </div>
      </div>
      <div class="de-row">
        <label>Your notes (added to every request)</label>
        <textarea class="text_pole" data-key="extra" placeholder="e.g. Keep my character guarded and sarcastic."></textarea>
      </div>
      <label class="checkbox_label"><input type="checkbox" data-key="preview"><span>Preview before applying (Use / Retry / Cancel)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="autoSend"><span>Send automatically</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="clean"><span>Remove preset extras from the result (scene headers, status panels, HTML)</span></label>
      <label class="checkbox_label"><input type="checkbox" data-key="debug"><span>Log requests to the browser console</span></label>
      <small>Draft Enhancer follows your active preset. Writing as you uses SillyTavern's Impersonate; writing as the character uses a quiet character turn.</small>
    </div>
  </div>
</div>`;

function buildSettings() {
    $('#de_settings').remove();
    ($('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings')).append(SETTINGS_HTML);
    const s = settings();
    $('#de_settings [data-key]').each((_, el) => {
        if (el.type === 'checkbox') el.checked = !!s[el.dataset.key];
        else el.value = s[el.dataset.key] ?? '';
    });
    $('#de_settings').on('input change', '[data-key]', function () {
        settings()[this.dataset.key] = this.type === 'checkbox' ? this.checked : this.value;
        save();
        updateButton();
    });
}

/* ------------------------------------------------------------------ */
/* Slash commands                                                      */
/* ------------------------------------------------------------------ */

async function registerCommands() {
    try {
        const [{ SlashCommandParser }, { SlashCommand }, { ARGUMENT_TYPE, SlashCommandArgument }] = await Promise.all([
            import('../../../slash-commands/SlashCommandParser.js'),
            import('../../../slash-commands/SlashCommand.js'),
            import('../../../slash-commands/SlashCommandArgument.js'),
        ]);
        const add = (name, alias, kind, help, argHelp) =>
            SlashCommandParser.addCommandObject(
                SlashCommand.fromProps({
                    name,
                    aliases: [alias],
                    callback: async (_args, value) => (await run(kind, String(value || '').trim() || undefined)) ?? '',
                    returns: 'the text placed in the message box',
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
    enhance: (text) => run('enhance', text),
    write: (direction) => run('write', direction),
    undo,
    getLastPrompt: () => state.lastPrompt,
    getLastOutput: () => state.lastOutput,
    _internals: { settings, buildNote, lengthRange, clean, state },
};

jQuery(async () => {
    try {
        settings();
        buildSettings();
        buildUI();
        bindEvents();
        await registerCommands();
        console.log(TAG, 'loaded');
    } catch (err) {
        console.error(TAG, 'failed to load', err);
    }
});

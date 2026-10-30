// Draft Enhancer tests: the note, the clean-up and the helpers, run against a stubbed SillyTavern.
// Run with: node tests/run.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');

const chat = [
    { is_user: false, name: 'Mira', mes: '*Mira looks up.* "Door is open."' },
    { is_user: true, name: 'Sam', mes: '*I sit down at the bar.* "Hey Mira, rough day?"' },
    { is_user: false, name: 'Mira', mes: '*Mira sighs and rubs her temple.* "You have no idea. The cellar flooded again."' },
];
const context = {
    extensionSettings: { draftEnhancer: { settingsVersion: 4, oldKey: 1 } },
    name1: 'Sam',
    name2: 'Mira',
    chat,
    characterId: 0,
    characters: [{ name: 'Mira', avatar: 'mira.png' }, { name: 'Kai', avatar: 'kai.png' }],
    groups: [{ id: 'g1', members: ['mira.png', 'kai.png'] }],
    groupId: undefined,
    substituteParams: (x) => x,
    saveSettingsDebounced: () => {},
};
globalThis.SillyTavern = { getContext: () => context };
globalThis.document = { getElementById: () => null };
globalThis.jQuery = () => {};
globalThis.$ = () => ({ val() {}, text() {}, toggleClass() { return this; } });
await import(`data:text/javascript,${encodeURIComponent(src)}`);

const { settings, buildNote, clean, cleanPartial, trimUnfinished, joinContinuation, assemble, currentSubject, cycleSubject, subjectChoices } = globalThis.DraftEnhancer._internals;
const s = settings();
let fails = 0;
const check = (name, cond) => {
    if (!cond) fails++;
    console.log(cond ? 'ok  ' : 'FAIL', name);
};

check('settings: old keys dropped', !('oldKey' in s) && !('settingsVersion' in s));
check('settings: defaults filled', s.anchor === true && s.retries === 1 && s.liveClean === true && typeof s.subjectByChat === 'object');

// Clean-up
const body = '*I step inside and shake the rain from my coat.* "Evening. Is the fire still going?"';
const dirty = {
    'tag tracker': `${body}\n\n<svt>\n<dy>Day 3</dy>\n<cs>Mira: apron</cs>\n</svt>`,
    'wrapped tracker + reasoning': `<think>plan</think>\n(answer)\n${body}\n\n<tracker>\n<svt>\n<dy>Day 3</dy>\n</svt>\n</tracker>`,
    'details panel': `${body}\n\n<details>\n<summary>Tracker</summary>\nDays: 3\n</details>`,
    'currency line': `${body}\n\n💰 Currency: 12 silver`,
    'unknown trailing block': `${body}\n\n<scene_report>\nMood: tense\n</scene_report>`,
    'cut-off tracker': `${body}\n\n<svt>\n<dy>Day 3</dy>\n<ob>Get w`,
    'chatty lead-in and note': `Sure, here is the message:\n\n${body}\n\nNote: kept it short`,
    'name prefix': `Sam: ${body}`,
};
for (const [name, raw] of Object.entries(dirty)) check(`clean: ${name}`, clean(raw, s) === body);
check('clean: keeps <b> when HTML clean-up is off', clean('<b>Careful</b>, she says.', { ...s, cleanHtml: false }) === '<b>Careful</b>, she says.');
check('cleanPartial: unfinished reasoning hidden', cleanPartial('<think>planning the be', s) === '');
check('cleanPartial: half-written tag hidden', cleanPartial(`${body}\n\n<sv`, s) === body);
check('trim: emoji ending kept', trimUnfinished('see you soon 😊') === 'see you soon 😊');
check('trim: small unfinished tail cut', trimUnfinished('This is a long finished sentence that goes on and on. Then') === 'This is a long finished sentence that goes on and on.');

// Continue and selection
check('continue: glued with a space', joinContinuation('I open the door and', 'step inside.') === 'I open the door and step inside.');
check('continue: punctuation not spaced', joinContinuation('"Wait', ', please."') === '"Wait, please."');
check('continue: repeated draft dropped', joinContinuation('I open the door', 'I open the door and step inside.') === 'I open the door and step inside.');
check('continue: repeated draft with formatting', joinContinuation('I try to stand but my legs', '*I try to stand but my legs* buckle.') === '*I try to stand but my legs* buckle.');
const sel = { before: 'First part. ', after: ' Last part.', lead: '', trail: '', text: 'middle' };
check('selection: put back in place', assemble({ kind: 'enhance', selection: sel }, 'NEW MIDDLE') === 'First part. NEW MIDDLE Last part.');

// The note
const nUser = buildNote('enhance', 'I wave (shy) hello', s);
check('note: header for you', nUser.startsWith("[Enhance my draft: this is Sam's own message"));
check('note: last message anchored', nUser.includes('The cellar flooded again.') && nUser.includes('from Mira:'));
check('note: bracket direction rule', nUser.includes('is a direction to you'));
check('note: your voice sample', nUser.includes('How Sam usually writes'));
check('note: preset guard', nUser.includes('Skip any tracker'));

const nChar = buildNote('write', '', s, { subject: 'char' });
check('char: header', nChar.includes('this turn the player writes Mira'));
check('char: last message is theirs', nChar.includes('That message is already part of the story'));
check('char: their voice sample', nChar.includes('How Mira usually speaks and acts'));
check('char: no redundant continue line', !nChar.includes('Continue naturally from the last message.'));

const nNarr = buildNote('write', 'the storm worsens', s, { subject: 'narrator' });
check('narrator: header', nNarr.includes('the player is the narrator'));
check('narrator: no voice sample', !nNarr.includes('<voice>'));

check('no anchor: continue line instead', buildNote('write', '', { ...s, anchor: false }).includes('Continue naturally from the last message.'));

const nCont = buildNote('continue', 'I open the door and', s);
check('continue note: asks for the rest only', nCont.includes('Write only what comes next') && nCont.includes('Length of the part you add'));
const nSel = buildNote('enhance', 'middle', s, { selection: sel });
check('selection note: shows the text around it', nSel.includes('<before>\nFirst part.\n</before>') && nSel.includes('Output only the rewritten part'));
check('selection note: no "stop where" rule', !nSel.includes('would answer'));
const nRef = buildNote('refine', body, s, { instruction: 'Make it shorter.' });
check('refine note: instruction and message', nRef.includes('Revise it. Make it shorter.') && nRef.includes(`<message>\n${body}\n</message>`));

const nCompact = buildNote('enhance', 'I wave', { ...s, instructionStyle: 'compact' });
check('compact: shorter than full', nCompact.length < nUser.length / 1.5 && nCompact.includes('<draft>') && nCompact.includes('<last_message>'));
check('compact: no stray null/false', !/\b(null|false|undefined)\b/.test(nCompact));
check('compact: refine works', buildNote('refine', body, { ...s, instructionStyle: 'compact' }, { instruction: 'Shorter.' }).includes('Shorter.'));

const nCustom = buildNote('enhance', 'I wave', { ...s, templateEnhance: 'D={{draft}} L={{last}} M={{min}} X={{unknown}}' });
check('custom instruction: macros', nCustom.startsWith('D=I wave L=*Mira sighs') && nCustom.includes('X={{unknown}}'));

// Write as: per character, and group members
check('subject: default is you', currentSubject() === 'user');
cycleSubject();
check('subject: remembered per character', currentSubject() === 'char' && s.subjectByChat['char:mira.png'] === 'char');
context.characterId = 1;
check('subject: other character keeps the default', currentSubject() === 'user');
context.characterId = undefined;
context.groupId = 'g1';
check('group: one choice per member', subjectChoices().join() === 'user,member:mira.png,member:kai.png,narrator');
cycleSubject();
cycleSubject();
check('group: can write as the second member', currentSubject() === 'member:kai.png' && buildNote('write', '', s, { subject: currentSubject() }).includes('this turn the player writes Kai'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

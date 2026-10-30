/**
 * The Captain's log's words and times: which settings it runs with, where the
 * digest window starts, and the three plain lines (landed, waiting on you,
 * under way and next). Pure and dependency-free, so the server entry and the
 * browser element share it, and the tests run it under Node.
 *
 * @typedef {{ title: string; project: string | null; href: string | null; pr: string | null;
 *   at: string | null; exact: boolean }} LandedItem
 * @typedef {{ title: string; project: string | null; href: string | null; pr: string | null;
 *   kind: 'decision' | 'review' | 'merge' }} WaitingItem
 * @typedef {{ title: string; project: string | null; href: string | null; state: string;
 *   who: 'crew' | 'firstmate' | 'reviewers' }} UnderwayItem
 * @typedef {{ title: string; project: string | null; href: string | null; turn: boolean }} NextItem
 * @typedef {{ window: 'last-visit' | 'morning'; morningStart: string; lookbackHours: number }} Settings
 * @typedef {{ schema: 'captains-log.v1'; generatedAt: string; settings: Settings; problems: string[];
 *   landed: LandedItem[]; waiting: WaitingItem[]; underway: UnderwayItem[]; next: NextItem[];
 *   counts: { underway: number; withFirstmate: number; withReviewers: number; queued: number;
 *     waiting: WaitingCounts } }} Digest
 * @typedef {{ decision: number; review: number; merge: number }} WaitingCounts
 */

export const WINDOWS = ['last-visit', 'morning'];
/** @type {Settings} */
export const DEFAULTS = { window: 'last-visit', morningStart: '07:00', lookbackHours: 72 };
/** The longest look back, and how far back the server reads landed work: a week. */
export const MAX_LOOKBACK_HOURS = 168;
/** Away this long, and the next look is a new visit. */
export const VISIT_GAP_MS = 30 * 60 * 1000;
/** A drill-in list shows at most this many items; its sentence counts them all. */
export const MAX_ITEMS = 50;

const HOUR = 3600 * 1000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Titles in a sentence are cut to this length; the drill-in shows them whole. */
const SHORT_TITLE = 48;

/**
 * The plugin's settings from `ctx.settings`, each falling back to its default
 * when missing or unusable, with a plain-words note for each one that was
 * unusable (so the card can say why it is not doing what was asked).
 *
 * @param {unknown} raw
 * @returns {Settings & { problems: string[] }}
 */
export function readSettings(raw) {
	const s = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
	const problems = [];
	let window = DEFAULTS.window;
	if (s.window !== undefined && s.window !== null && s.window !== '') {
		if (WINDOWS.includes(s.window)) window = s.window;
		else
			problems.push(
				'The digest window setting is not one this plugin knows, so it covers since you were last here.'
			);
	}
	let morningStart = DEFAULTS.morningStart;
	if (typeof s.morningStart === 'string' && s.morningStart.trim() !== '') {
		const m = /^(\d{1,2}):(\d{2})$/.exec(s.morningStart.trim());
		const t = m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
		if (TIME.test(t)) morningStart = t;
		else
			problems.push(
				`The morning start “${s.morningStart.trim().slice(0, 20)}” is not a time like 07:00, so 07:00 is used.`
			);
	}
	let lookbackHours = DEFAULTS.lookbackHours;
	if (s.lookbackHours !== undefined && s.lookbackHours !== null && s.lookbackHours !== '') {
		const n = Number(s.lookbackHours);
		if (Number.isFinite(n) && n >= 1) lookbackHours = Math.min(Math.round(n), MAX_LOOKBACK_HOURS);
		else
			problems.push(
				`The look back setting is not a number of hours, so ${DEFAULTS.lookbackHours} hours is used.`
			);
	}
	return { window, morningStart, lookbackHours, problems };
}

/**
 * The latest morning start at or before `now`, in local time: today's if it
 * has passed, else yesterday's.
 *
 * @param {number} now epoch ms
 * @param {string} hhmm a valid `HH:MM`
 */
export function morningBefore(now, hhmm) {
	const [h, m] = hhmm.split(':').map(Number);
	const d = new Date(now);
	d.setHours(h, m, 0, 0);
	if (d.getTime() > now) d.setDate(d.getDate() - 1);
	return d.getTime();
}

/**
 * One look at the log: when the captain was last here, and what to remember
 * now. A look after more than `gap` away is a new visit, whose window starts
 * at the previous look; looks closer together are one visit and keep its
 * start. Nothing remembered yet (or something unreadable) gives no start.
 *
 * @param {unknown} stored what was remembered last time
 * @param {number} now epoch ms
 * @param {number} [gap]
 * @returns {{ anchor: number | null; next: { lastSeen: number; anchor: number | null } }}
 */
export function visit(stored, now, gap = VISIT_GAP_MS) {
	const s = typeof stored === 'object' && stored !== null ? stored : {};
	const lastSeen = Number.isFinite(s.lastSeen) && s.lastSeen <= now ? s.lastSeen : null;
	if (lastSeen === null) return { anchor: null, next: { lastSeen: now, anchor: null } };
	const anchor =
		now - lastSeen > gap
			? lastSeen
			: Number.isFinite(s.anchor) && s.anchor <= now
				? s.anchor
				: null;
	return { anchor, next: { lastSeen: now, anchor } };
}

/**
 * Where the digest window starts, and how to say so: since the last visit,
 * or since the morning start (also used before there is a last visit), never
 * further back than the look-back limit.
 *
 * @param {Settings} settings
 * @param {number} now epoch ms
 * @param {number | null} anchor when the captain was last here, if known
 * @returns {{ start: number; label: string }}
 */
export function windowStart(settings, now, anchor) {
	const floor = now - settings.lookbackHours * HOUR;
	const fromVisit = settings.window === 'last-visit' && anchor !== null;
	const from = fromVisit ? anchor : morningBefore(now, settings.morningStart);
	if (from < floor) return { start: floor, label: `In the last ${hours(settings.lookbackHours)}` };
	if (fromVisit) return { start: from, label: `Since you were last here, ${ago(now - from)}` };
	const today = sameDay(from, now);
	return {
		start: from,
		label: `Since ${settings.morningStart} ${today ? 'this morning' : 'yesterday'}`
	};
}

/**
 * The three lines, each a sentence with the items it opens to: what landed
 * in the window (newest first), what waits on the captain now, and what is
 * under way and next now.
 *
 * @param {Digest} d
 * @param {number} start epoch ms
 */
export function lines(d, start) {
	const landed = d.landed.filter((i) => i.at !== null && Date.parse(i.at) >= start);
	return {
		landed: { sentence: landedSentence(landed), items: landed },
		waiting: { sentence: waitingSentence(d.counts.waiting), items: d.waiting },
		ahead: { sentence: aheadSentence(d), items: [...d.underway, ...d.next] }
	};
}

/** @param {LandedItem[]} items */
export function landedSentence(items) {
	const n = items.length;
	if (n === 0) return 'Nothing has landed.';
	const t = items.map((i) => short(i.title));
	if (n === 1) return `${t[0]} landed.`;
	if (n === 2) return `2 changes landed: ${t[0]} and ${t[1]}.`;
	return `${n} changes landed: ${t[0]}, ${t[1]} and ${n - 2} more.`;
}

/** @param {WaitingCounts} c */
export function waitingSentence(c) {
	const n = c.decision + c.review + c.merge;
	if (n === 0) return 'Nothing is waiting on you.';
	const parts = [
		plural(c.decision, 'a decision', 'decisions'),
		plural(c.review, 'a pull request to review', 'pull requests to review'),
		plural(c.merge, 'a pull request to merge', 'pull requests to merge')
	].filter(Boolean);
	return `${n} ${n === 1 ? 'thing waits' : 'things wait'} on you: ${join(parts)}.`;
}

/** @param {Digest} d */
export function aheadSentence(d) {
	const c = d.counts;
	const extra = [
		c.withFirstmate ? `${c.withFirstmate} with Firstmate` : null,
		c.withReviewers ? `${c.withReviewers} with reviewers` : null
	].filter(Boolean);
	const now = c.underway
		? `${c.underway} under way${extra.length ? `, ${extra.join(', ')}` : ''}.`
		: 'Nothing under way.';
	const next = d.next.find((i) => i.turn);
	if (next) return `${now} Next up: ${short(next.title)}.`;
	if (c.queued) return `${now} ${c.queued} queued behind other work.`;
	return c.underway ? now : 'Nothing under way, and nothing queued.';
}

/**
 * Landed work by local day for the whole-log page, today first, `days` days
 * in all (empty days included, so a quiet day reads as one).
 *
 * @param {LandedItem[]} landed
 * @param {number} now epoch ms
 * @param {number} [days]
 */
export function byDay(landed, now, days = 7) {
	const out = [];
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	for (let i = 0; i < days; i++) {
		const from = d.getTime();
		const to = new Date(from);
		to.setDate(to.getDate() + 1);
		const items = landed.filter((x) => {
			const at = x.at === null ? NaN : Date.parse(x.at);
			return at >= from && at < to.getTime();
		});
		out.push({ day: from, label: dayLabel(from, now), items });
		d.setDate(d.getDate() - 1);
	}
	return out;
}

/** "Today", "Yesterday", else the weekday. */
export function dayLabel(day, now) {
	if (sameDay(day, now)) return 'Today';
	const y = new Date(now);
	y.setDate(y.getDate() - 1);
	if (sameDay(day, y.getTime())) return 'Yesterday';
	return new Date(day).toLocaleDateString(undefined, { weekday: 'long' });
}

/** How long ago, in plain words. */
export function ago(ms) {
	const min = Math.round(ms / 60000);
	if (min < 2) return 'a moment ago';
	if (min < 60) return `${min} minutes ago`;
	const h = Math.round(ms / HOUR);
	if (h < 48) return `${h === 1 ? 'an hour' : `${h} hours`} ago`;
	return `${Math.round(ms / (24 * HOUR))} days ago`;
}

const hours = (h) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : h === 1 ? 'hour' : `${h} hours`);

function sameDay(a, b) {
	const x = new Date(a);
	const y = new Date(b);
	return (
		x.getFullYear() === y.getFullYear() &&
		x.getMonth() === y.getMonth() &&
		x.getDate() === y.getDate()
	);
}

const short = (t) => (t.length > SHORT_TITLE ? `${t.slice(0, SHORT_TITLE - 1).trimEnd()}…` : t);
const plural = (n, one, many) => (n === 0 ? null : n === 1 ? one : `${n} ${many}`);
const join = (parts) =>
	parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

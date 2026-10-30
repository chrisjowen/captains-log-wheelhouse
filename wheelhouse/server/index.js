/**
 * Captain's log: a short digest on the home page's rail of what landed since
 * the captain was last here (or since the morning start), what waits on the
 * captain, and what is under way and next; plus a page with the last week.
 *
 * It reads the fleet Wheelhouse hands every provider (`ctx.tasks`,
 * `ctx.projects`), its own settings and, when a landed task has only the day it
 * was done, Firstmate's fleet ledger with one bounded grep, for when it was
 * done. It writes nothing. Both entries are drawn by the custom elements in
 * ../ui/index.js, which work out the window and the sentences in the browser
 * (the "last here" time is the browser's own), with ../ui/digest.js.
 *
 * Tasks are sorted the way Wheelhouse's own rail sorts them (src/lib/harbour.ts):
 * waiting on the captain when its attention is the captain's, next when
 * queued, landed when landed, and under way otherwise.
 *
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').WheelhousePlugin} WheelhousePlugin
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').ProviderContext} ProviderContext
 * @typedef {import('@chrisjowen/wheelhouse-plugin-sdk').Project} Project
 * @typedef {import('../ui/digest.js').Digest} Digest
 */

import { MAX_ITEMS, MAX_LOOKBACK_HOURS, lines, readSettings, windowStart } from '../ui/digest.js';

const HOUR = 3600 * 1000;
const TROUBLE = new Set(['blocked', 'failed', 'lost', 'unknown']);
const FINISHED = new Set(['landed']);

/** Firstmate's fleet ledger, in the Firstmate home (contract: Firstmate docs/fleet-ledger.md). */
const LEDGER = 'state/fleet-ledger.jsonl';
/** At most this many tasks' done times are read at once, the most recently done first. */
export const MAX_LEDGER_TASKS = 100;

/**
 * The bounded ledger read for these task ids: only their `done` status and
 * clean-up lines, matched as the ledger writes them (compact, `event`, `task`,
 * then `state`), so the output grows with these tasks, not the ledger.
 *
 * @param {string[]} ids
 */
export function ledgerGrep(ids) {
	const patterns = ids.flatMap((id) => {
		const task = `"task":${JSON.stringify(id)}`;
		return ['-e', `${task},"state":"done"`, '-e', `"event":"task.cleaned_up",${task}`];
	});
	return {
		argv: ['grep', '-F', ...patterns, LEDGER],
		cwd: 'home',
		timeoutMs: 3_000,
		maxBytes: 4 * 1024 * 1024
	};
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** An https link, else null: the only kind the digest shows for a pull request. */
export function httpsUrl(v) {
	const s = str(v);
	if (!s) return null;
	try {
		return new URL(s).protocol === 'https:' ? s : null;
	} catch {
		return null;
	}
}

const mergedAt = (t) => (str(t.mergedAt) ? Date.parse(t.mergedAt) : NaN);

/** A landed task with only the day it was done: no merge time to go by. */
const dayOnly = (t) =>
	isRecord(t) && FINISHED.has(t.status) && Number.isNaN(mergedAt(t)) && str(t.completedOn) !== null;

/** The local day of an epoch-ms time, as `YYYY-MM-DD`. */
function localDay(ms) {
	const d = new Date(ms);
	const pad = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * When each task with only a done day was done, as epoch ms, from the fleet
 * ledger's lines: the earliest `done` status or clean-up on that day.
 *
 * @param {string} text the ledger's task.status and task.cleaned_up lines
 * @param {Map<string, string>} days task id to its `completedOn`
 * @returns {Map<string, number>}
 */
export function doneTimes(text, days) {
	const out = new Map();
	for (const line of text.split('\n')) {
		let r;
		try {
			r = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(r) || typeof r.ts !== 'number' || !days.has(r.task)) continue;
		const done = (r.event === 'task.status' && r.state === 'done') || r.event === 'task.cleaned_up';
		const at = r.ts * 1000;
		if (!done || localDay(at) !== days.get(r.task)) continue;
		if (!out.has(r.task) || at < out.get(r.task)) out.set(r.task, at);
	}
	return out;
}

/**
 * Read the done times for the fleet's day-only landed tasks that can still show
 * (done within the week); none to read, or a ledger that is missing or
 * unreadable, gives none.
 *
 * @param {ProviderContext} ctx
 * @param {number} now epoch ms
 */
export async function readDoneTimes(ctx, now) {
	const first = localDay(now - MAX_LOOKBACK_HOURS * HOUR);
	const recent = ctx.tasks
		.filter((t) => dayOnly(t) && str(t.id) && str(t.completedOn) >= first)
		.sort((a, b) => str(b.completedOn).localeCompare(str(a.completedOn)))
		.slice(0, MAX_LEDGER_TASKS);
	const days = new Map(recent.map((t) => [t.id, str(t.completedOn)]));
	if (days.size === 0) return new Map();
	let r;
	try {
		r = await ctx.exec(ledgerGrep([...days.keys()]));
	} catch {
		return new Map();
	}
	// grep exits 1 when nothing matches, which is an answer.
	const ok = r.ok || (r.reason === 'exited with code 1' && !r.stderr);
	return ok ? doneTimes(r.stdout, days) : new Map();
}

/**
 * When a task landed, as epoch ms, and how that is known: the merge time, else
 * when the ledger says it was done, else the start of the day it was done.
 *
 * @param {Map<string, number>} [done] from readDoneTimes
 */
export function landedAt(t, done = new Map()) {
	const merged = mergedAt(t);
	if (!Number.isNaN(merged)) return { at: merged, time: 'merged' };
	if (done.has(t.id)) return { at: done.get(t.id), time: 'done' };
	const day = str(t.completedOn) ? Date.parse(`${t.completedOn}T00:00:00`) : NaN;
	return Number.isNaN(day) ? null : { at: day, time: 'day' };
}

/**
 * What a task waiting on the captain wants: a decision, a review, or (approved
 * on GitHub) a merge. Null when it does not wait on the captain. Wheelhouse
 * passes `attention`; without it, the status alone decides.
 */
export function waitingKind(t) {
	const a = isRecord(t.attention) ? t.attention : null;
	if (a) {
		if (a.owner !== 'captain') return null;
		return a.kind === 'review' ? (a.approved === true ? 'merge' : 'review') : 'decision';
	}
	if (t.status === 'needs-review') return 'review';
	if (t.status === 'needs-decision') return 'decision';
	return null;
}

/**
 * The digest's data from the fleet: plain JSON, with task titles as written in
 * the backlog (the drill-in shows them as text), each task's own page as a
 * same-origin link, and pull requests only as https links. Landed work goes
 * back a week, whole, so the page can show it by day; the card narrows it.
 * The other lists stop at MAX_ITEMS; their counts stay whole.
 *
 * @param {{ tasks: unknown[]; projects: unknown[]; settings: unknown; now: number;
 *   done?: Map<string, number> }} o
 * @returns {Digest}
 */
export function buildDigest({ tasks, projects, settings, now, done = new Map() }) {
	const { problems, ...chosen } = readSettings(settings);
	const names = new Map(projects.filter(isRecord).map((p) => [p.id, str(p.name) ?? null]));
	const since = now - MAX_LOOKBACK_HOURS * HOUR;
	const landed = [];
	const waiting = [];
	const underway = [];
	const next = [];
	const counts = {
		underway: 0,
		withFirstmate: 0,
		withReviewers: 0,
		queued: 0,
		waiting: { decision: 0, review: 0, merge: 0 }
	};
	for (const t of tasks) {
		if (!isRecord(t) || !str(t.id)) continue;
		const base = {
			title: str(t.shortTitle) ?? str(t.title) ?? 'A task with no title',
			project: names.get(t.projectId) ?? null,
			href: `/tasks/${encodeURIComponent(t.id)}`
		};
		const pr = httpsUrl(isRecord(t.pr) ? t.pr.url : null);
		const kind = waitingKind(t);
		if (kind) {
			counts.waiting[kind]++;
			waiting.push({ ...base, pr, kind });
		} else if (t.status === 'queued') {
			counts.queued++;
			const turn = !Array.isArray(t.blockedBy) || t.blockedBy.length === 0;
			next.push({ ...base, turn });
		} else if (FINISHED.has(t.status)) {
			const when = landedAt(t, done);
			if (when && when.at >= since) {
				landed.push({ ...base, pr, at: new Date(when.at).toISOString(), time: when.time });
			}
		} else {
			counts.underway++;
			const who =
				t.status === 'with-firstmate' || TROUBLE.has(t.status)
					? 'firstmate'
					: t.status === 'with-reviewers'
						? 'reviewers'
						: 'crew';
			if (who === 'firstmate') counts.withFirstmate++;
			if (who === 'reviewers') counts.withReviewers++;
			underway.push({ ...base, state: str(t.statusLabel) ?? 'Under way', who });
		}
	}
	landed.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
	const order = { decision: 0, review: 1, merge: 2 };
	waiting.sort((a, b) => order[a.kind] - order[b.kind]);
	// The next task whose turn it is first, then the rest in the backlog's order.
	next.sort((a, b) => Number(b.turn) - Number(a.turn));
	return {
		schema: 'captains-log.v1',
		generatedAt: new Date(now).toISOString(),
		settings: chosen,
		problems,
		landed,
		waiting: waiting.slice(0, MAX_ITEMS),
		underway: underway.slice(0, MAX_ITEMS),
		next: next.slice(0, MAX_ITEMS),
		counts
	};
}

/**
 * The rail tab's count: what the card says landed, when the window is the
 * morning one (from the morning start, no further back than the look-back
 * limit). Since the last visit, only the browser knows the window, so no count.
 *
 * @param {Digest} d
 */
export function badge(d) {
	if (!isRecord(d) || !isRecord(d.settings) || d.settings.window !== 'morning') return null;
	const now = Date.parse(d.generatedAt);
	const n = lines(d, windowStart(d.settings, now, null).start).landed.items.length;
	return n > 0 ? n : null;
}

/** @type {WheelhousePlugin} */
export default {
	providers: [
		{
			id: 'digest',
			scope: 'fleet',
			ttlMs: 30_000,
			/** @param {ProviderContext} ctx */
			async fetch(ctx) {
				const now = Date.now();
				const value = buildDigest({
					tasks: ctx.tasks,
					projects: ctx.projects,
					settings: ctx.settings,
					now,
					done: await readDoneTimes(ctx, now)
				});
				return { available: true, value, source: 'the fleet', observedAt: value.generatedAt };
			}
		}
	],
	contributions: [
		{
			slot: 'home.card',
			id: 'digest',
			title: 'Log',
			provider: 'digest',
			render: { element: 'captains-log-digest' },
			badge
		},
		{
			slot: 'nav.page',
			id: 'log',
			title: "Captain's log",
			provider: 'digest',
			render: { element: 'captains-log-page' }
		}
	]
};

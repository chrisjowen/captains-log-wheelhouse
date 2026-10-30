/**
 * Captain's log: a short digest on the home page's rail of what landed since
 * the captain was last here (or since the morning start), what waits on the
 * captain, and what is under way and next; plus a page with the last week.
 *
 * It reads only the fleet Wheelhouse hands every provider (`ctx.tasks`,
 * `ctx.projects`) and its own settings. It runs nothing, reads no files and
 * writes nothing. Both entries are drawn by the custom elements in
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

import { MAX_LOOKBACK_HOURS, lines, morningBefore, readSettings } from '../ui/digest.js';

const HOUR = 3600 * 1000;
/** At most this many of each kind of item go to the page; the counts stay whole. */
const MAX_ITEMS = 50;
const TROUBLE = new Set(['blocked', 'failed', 'lost', 'unknown']);
const FINISHED = new Set(['landed']);

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

/** When a task landed, as epoch ms: the exact merge time, else the end of the day it was done. */
export function landedAt(t) {
	const merged = str(t.mergedAt) ? Date.parse(t.mergedAt) : NaN;
	if (!Number.isNaN(merged)) return { at: merged, exact: true };
	const day = str(t.completedOn) ? Date.parse(`${t.completedOn}T23:59:59`) : NaN;
	return Number.isNaN(day) ? null : { at: day, exact: false };
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
 * back a week, so the page can show it by day; the card narrows it.
 *
 * @param {{ tasks: unknown[]; projects: unknown[]; settings: unknown; now: number }} o
 * @returns {Digest}
 */
export function buildDigest({ tasks, projects, settings, now }) {
	const { problems, ...chosen } = readSettings(settings);
	const names = new Map(projects.filter(isRecord).map((p) => [p.id, str(p.name) ?? null]));
	const since = now - MAX_LOOKBACK_HOURS * HOUR;
	const landed = [];
	const waiting = [];
	const underway = [];
	const next = [];
	const counts = { underway: 0, withFirstmate: 0, withReviewers: 0, queued: 0 };
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
			waiting.push({ ...base, pr, kind });
		} else if (t.status === 'queued') {
			counts.queued++;
			const turn = !Array.isArray(t.blockedBy) || t.blockedBy.length === 0;
			next.push({ ...base, turn });
		} else if (FINISHED.has(t.status)) {
			const when = landedAt(t);
			if (when && when.at >= since) {
				landed.push({ ...base, pr, at: new Date(when.at).toISOString(), exact: when.exact });
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
		landed: landed.slice(0, MAX_ITEMS),
		waiting: waiting.slice(0, MAX_ITEMS),
		underway: underway.slice(0, MAX_ITEMS),
		next: next.slice(0, MAX_ITEMS),
		counts
	};
}

/**
 * The rail tab's count: what landed since the morning start, when that is the
 * window. Since the last visit, only the browser knows the window, so no count.
 *
 * @param {Digest} d
 */
export function badge(d) {
	if (!isRecord(d) || !isRecord(d.settings) || d.settings.window !== 'morning') return null;
	const now = Date.parse(d.generatedAt);
	const n = lines(d, morningBefore(now, d.settings.morningStart)).landed.items.length;
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
				const value = buildDigest({
					tasks: ctx.tasks,
					projects: ctx.projects,
					settings: ctx.settings,
					now: Date.now()
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

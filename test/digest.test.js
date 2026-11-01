import { describe, expect, it } from 'vitest';
import {
	DEFAULTS,
	VISIT_GAP_MS,
	aheadSentence,
	ago,
	byDay,
	landedSentence,
	lines,
	morningBefore,
	readSettings,
	visit,
	waitingSentence,
	windowStart
} from '../wheelhouse/ui/digest.js';

// The tests run with TZ=UTC (see vitest.config.js), so local times are UTC times.
const at = (iso) => Date.parse(iso);
const HOUR = 3600 * 1000;

describe('readSettings', () => {
	it('uses the defaults when nothing is set', () => {
		expect(readSettings(undefined)).toEqual({ ...DEFAULTS, problems: [] });
		expect(readSettings({})).toEqual({ ...DEFAULTS, problems: [] });
	});

	it('takes good values, padding an hour and capping the look back at a week', () => {
		expect(readSettings({ window: 'morning', morningStart: '6:30', lookbackHours: 500 })).toEqual({
			window: 'morning',
			morningStart: '06:30',
			lookbackHours: 168,
			problems: []
		});
	});

	it('falls back, and says why, for values it cannot use', () => {
		const s = readSettings({ window: 'weekly', morningStart: '7am', lookbackHours: 'lots' });
		expect(s).toMatchObject(DEFAULTS);
		expect(s.problems).toHaveLength(3);
		expect(s.problems[1]).toContain('“7am” is not a time like 07:00');
	});

	it('treats an empty answer as unset, as the settings form saves it', () => {
		expect(readSettings({ window: '', morningStart: '', lookbackHours: null }).problems).toEqual(
			[]
		);
	});
});

describe('morningBefore', () => {
	it("is today's start once it has passed, else yesterday's", () => {
		expect(morningBefore(at('2026-10-31T09:00:00Z'), '07:00')).toBe(at('2026-10-31T07:00:00Z'));
		expect(morningBefore(at('2026-10-31T06:59:00Z'), '07:00')).toBe(at('2026-10-30T07:00:00Z'));
	});
});

describe('visit', () => {
	const now = at('2026-10-31T09:00:00Z');

	it('has no start the first time, and remembers this look', () => {
		expect(visit(null, now)).toEqual({ anchor: null, next: { lastSeen: now, anchor: null } });
		expect(visit({ lastSeen: 'yesterday' }, now).anchor).toBeNull();
	});

	it('starts a new visit at the previous look after a gap', () => {
		const last = now - 9 * HOUR;
		expect(visit({ lastSeen: last, anchor: last - HOUR }, now)).toEqual({
			anchor: last,
			next: { lastSeen: now, anchor: last }
		});
	});

	it('keeps the visit start while looks are close together', () => {
		const start = now - 9 * HOUR;
		const v = visit({ lastSeen: now - VISIT_GAP_MS + 1, anchor: start }, now);
		expect(v.anchor).toBe(start);
	});

	it('ignores a remembered time in the future', () => {
		expect(visit({ lastSeen: now + HOUR, anchor: now }, now).anchor).toBeNull();
	});
});

describe('windowStart', () => {
	const now = at('2026-10-31T09:00:00Z');

	it('starts at the last visit', () => {
		const w = windowStart(DEFAULTS, now, now - 9 * HOUR);
		expect(w).toEqual({ start: now - 9 * HOUR, label: 'Since you were last here, 9 hours ago' });
	});

	it('starts at the morning start without a last visit, or when set to', () => {
		expect(windowStart(DEFAULTS, now, null)).toEqual({
			start: at('2026-10-31T07:00:00Z'),
			label: 'Since 07:00 this morning'
		});
		const morning = { ...DEFAULTS, window: 'morning' };
		expect(windowStart(morning, at('2026-10-31T05:00:00Z'), now - HOUR).label).toBe(
			'Since 07:00 yesterday'
		);
	});

	it('never goes further back than the look back', () => {
		expect(windowStart(DEFAULTS, now, now - 10 * 24 * HOUR)).toEqual({
			start: now - 72 * HOUR,
			label: 'In the last 3 days'
		});
		expect(windowStart({ ...DEFAULTS, lookbackHours: 1 }, now, null).label).toBe(
			'In the last hour'
		);
	});
});

describe('the three sentences', () => {
	const item = (title, extra = {}) => ({ title, project: null, href: null, pr: null, ...extra });

	it('says what landed, naming at most two', () => {
		expect(landedSentence([])).toBe('Nothing has landed.');
		expect(landedSentence([item('A')])).toBe('A landed.');
		expect(landedSentence([item('A'), item('B')])).toBe('2 changes landed: A and B.');
		expect(landedSentence([item('A'), item('B'), item('C')])).toBe(
			'3 changes landed: A, B and 1 more.'
		);
		expect(landedSentence([item('x'.repeat(60))])).toBe(`${'x'.repeat(47)}… landed.`);
	});

	it('says what waits on the captain, by kind', () => {
		const c = (counts) => ({ decision: 0, review: 0, merge: 0, ...counts });
		expect(waitingSentence(c({}))).toBe('Nothing is waiting on you.');
		expect(waitingSentence(c({ decision: 1 }))).toBe('1 thing waits on you: a decision.');
		expect(waitingSentence(c({ decision: 2, review: 1, merge: 1 }))).toBe(
			'4 things wait on you: 2 decisions, a pull request to review and a pull request to merge.'
		);
	});

	it('says what is under way and next', () => {
		const d = (counts, next = []) => ({
			counts: { underway: 0, withFirstmate: 0, withReviewers: 0, queued: 0, ...counts },
			next
		});
		expect(aheadSentence(d({}))).toBe('Nothing under way, and nothing queued.');
		expect(aheadSentence(d({ underway: 3, withFirstmate: 1 }))).toBe(
			'3 under way, 1 with Firstmate.'
		);
		expect(aheadSentence(d({ underway: 2, queued: 1 }, [item('Dark mode', { turn: true })]))).toBe(
			'2 under way. Next up: Dark mode.'
		);
		expect(aheadSentence(d({ queued: 2 }, [item('Later', { turn: false })]))).toBe(
			'Nothing under way. 2 queued behind other work.'
		);
	});

	it('counts landed work only inside the window', () => {
		const d = {
			landed: [
				item('New', { at: '2026-10-31T08:00:00Z' }),
				item('Old', { at: '2026-10-30T08:00:00Z' })
			],
			waiting: [],
			underway: [],
			next: [],
			counts: {
				underway: 0,
				withFirstmate: 0,
				withReviewers: 0,
				queued: 0,
				waiting: { decision: 0, review: 0, merge: 0 }
			}
		};
		const l = lines(d, at('2026-10-31T00:00:00Z'));
		expect(l.landed.items.map((i) => i.title)).toEqual(['New']);
		expect(l.landed.sentence).toBe('New landed.');
	});
});

describe('byDay', () => {
	it('groups landed work by local day, today first, quiet days included', () => {
		const now = at('2026-10-31T09:00:00Z');
		const days = byDay(
			[
				{ title: 'A', at: '2026-10-31T02:00:00Z' },
				{ title: 'B', at: '2026-10-29T23:59:59Z' }
			],
			now,
			3
		);
		expect(days.map((d) => [d.label, d.items.map((i) => i.title)])).toEqual([
			['Today', ['A']],
			['Yesterday', []],
			['Thursday', ['B']]
		]);
	});
});

describe('ago', () => {
	it('reads in plain words', () => {
		expect(ago(30_000)).toBe('a moment ago');
		expect(ago(25 * 60_000)).toBe('25 minutes ago');
		expect(ago(HOUR)).toBe('an hour ago');
		expect(ago(3 * 24 * HOUR)).toBe('3 days ago');
	});
});

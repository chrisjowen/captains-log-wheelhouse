import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import plugin, {
	MAX_LEDGER_TASKS,
	badge,
	buildDigest,
	httpsUrl,
	waitingKind
} from '../wheelhouse/server/index.js';
import { lines, windowStart } from '../wheelhouse/ui/digest.js';
import { NOW as now } from './now.js';
const projects = [
	{ id: 'atlas', name: 'Atlas', description: null, path: null },
	{ id: 'lumen', name: 'Lumen', description: null, path: null }
];

/** A task as Wheelhouse hands it to plugins (the SDK's fields, plus attention). */
function task(id, status, extra = {}) {
	return {
		id,
		title: `${extra.projectId ?? 'atlas'}: Task ${id}`,
		shortTitle: `Task ${id}`,
		projectId: 'atlas',
		kind: 'ship',
		status,
		statusLabel: status[0].toUpperCase() + status.slice(1),
		branch: null,
		pr: null,
		preview: null,
		since: null,
		completedOn: null,
		mergedAt: null,
		...extra
	};
}

const digest = (tasks, settings = {}) => buildDigest({ tasks, projects, settings, now });

describe('buildDigest', () => {
	it('sorts the fleet the way the rail does', () => {
		const d = digest([
			task('decide', 'needs-decision', {
				attention: { kind: 'decision', owner: 'captain', text: 'Pick one', url: null }
			}),
			task('review', 'needs-review', {
				pr: { url: 'https://github.com/o/r/pull/9', number: 9 },
				attention: { kind: 'review', owner: 'captain', text: 'PR 9', url: null }
			}),
			task('approved', 'needs-review', {
				attention: { kind: 'review', owner: 'captain', approved: true, text: '', url: null }
			}),
			task('others', 'with-reviewers', {
				attention: { kind: 'review', owner: 'reviewers', text: '', url: null }
			}),
			task('fm', 'with-firstmate'),
			task('stuck', 'blocked'),
			task('busy', 'working', { projectId: 'lumen' }),
			task('later', 'queued', { blockedBy: ['busy'] }),
			task('soon', 'queued', { blockedBy: [] }),
			task('merged', 'landed', {
				mergedAt: '2026-10-31T02:14:00Z',
				pr: { url: 'https://github.com/o/r/pull/7', number: 7 }
			}),
			task('done', 'landed', { completedOn: '2026-10-30' }),
			task('ancient', 'landed', { mergedAt: '2026-10-01T00:00:00Z' })
		]);
		expect(d.waiting.map((i) => [i.title, i.kind])).toEqual([
			['Task decide', 'decision'],
			['Task review', 'review'],
			['Task approved', 'merge']
		]);
		expect(d.waiting[1].pr).toBe('https://github.com/o/r/pull/9');
		expect(d.underway.map((i) => [i.title, i.who])).toEqual([
			['Task others', 'reviewers'],
			['Task fm', 'firstmate'],
			['Task stuck', 'firstmate'],
			['Task busy', 'crew']
		]);
		expect(d.underway[3].project).toBe('Lumen');
		expect(d.counts).toEqual({
			underway: 4,
			withFirstmate: 2,
			withReviewers: 1,
			queued: 2,
			waiting: { decision: 1, review: 1, merge: 1 }
		});
		expect(d.next.map((i) => [i.title, i.turn])).toEqual([
			['Task soon', true],
			['Task later', false]
		]);
		expect(d.landed.map((i) => [i.title, i.at, i.time])).toEqual([
			['Task merged', '2026-10-31T02:14:00.000Z', 'merged'],
			['Task done', '2026-10-30T00:00:00.000Z', 'day']
		]);
		expect(d.landed[0]).toMatchObject({ project: 'Atlas', href: '/tasks/merged' });
	});

	it('links each task to its own page, escaping its id', () => {
		const d = digest([task('a/b?c', 'working')]);
		expect(d.underway[0].href).toBe('/tasks/a%2Fb%3Fc');
	});

	it('shows pull requests only as https links', () => {
		expect(httpsUrl('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
		expect(httpsUrl('javascript:alert(1)')).toBeNull();
		expect(httpsUrl('http://example.test/pull/1')).toBeNull();
		expect(httpsUrl('not a url')).toBeNull();
		const d = digest([
			task('x', 'landed', { mergedAt: '2026-10-31T01:00:00Z', pr: { url: 'javascript:alert(1)' } })
		]);
		expect(d.landed[0].pr).toBeNull();
	});

	it('falls back on the status when Wheelhouse passes no attention', () => {
		expect(waitingKind({ status: 'needs-review' })).toBe('review');
		expect(waitingKind({ status: 'needs-decision' })).toBe('decision');
		expect(waitingKind({ status: 'working' })).toBeNull();
		expect(waitingKind({ status: 'needs-review', attention: { owner: 'firstmate' } })).toBeNull();
	});

	it('skips rows it cannot read, and names untitled tasks', () => {
		const d = digest([
			null,
			'x',
			{ status: 'working' },
			task('t', 'working', { shortTitle: '', title: '' })
		]);
		expect(d.underway.map((i) => i.title)).toEqual(['A task with no title']);
	});

	it('keeps every landed task of the week and whole waiting counts, capping only the lists', () => {
		const tasks = [];
		for (let i = 0; i < 60; i++) {
			tasks.push(
				task(`pr${i}`, 'needs-review', {
					attention: { kind: 'review', owner: 'captain', text: '', url: null }
				})
			);
			tasks.push(
				task(`l${i}`, 'landed', { mergedAt: new Date(now - (i + 1) * 3600 * 1000).toISOString() })
			);
		}
		const d = digest(tasks);
		expect(d.waiting).toHaveLength(50);
		expect(d.counts.waiting).toEqual({ decision: 0, review: 60, merge: 0 });
		expect(d.landed).toHaveLength(60);
		const l = lines(d, now - 72 * 3600 * 1000);
		expect(l.waiting.sentence).toBe('60 things wait on you: 60 pull requests to review.');
		expect(l.landed.sentence).toMatch(/^60 changes landed:/);
	});

	it('puts work done on a day with no merge time at the start of that day, below its merges', () => {
		const d = digest([
			task('day', 'landed', { completedOn: '2026-10-31' }),
			task('merged', 'landed', { mergedAt: '2026-10-31T01:00:00Z' })
		]);
		expect(d.landed.map((i) => i.title)).toEqual(['Task merged', 'Task day']);
		// Looked at 07:00 this morning: what was done today before then is not new again at 09:00.
		const later = lines(d, Date.parse('2026-10-31T07:00:00Z'));
		expect(later.landed.items).toEqual([]);
		// Last here yesterday evening: it is new once.
		const first = lines(d, Date.parse('2026-10-30T20:00:00Z'));
		expect(first.landed.items.map((i) => i.title)).toEqual(['Task merged', 'Task day']);
	});

	it('carries the settings it used, and any it could not', () => {
		const d = digest([], { window: 'morning', morningStart: 'dawn' });
		expect(d.settings).toEqual({ window: 'morning', morningStart: '07:00', lookbackHours: 72 });
		expect(d.problems).toHaveLength(1);
	});
});

describe('badge', () => {
	const landed = [
		task('a', 'landed', { mergedAt: '2026-10-31T08:00:00Z' }),
		task('b', 'landed', { mergedAt: '2026-10-31T06:00:00Z' })
	];

	it('counts what landed since the morning start, in the morning window', () => {
		expect(badge(digest(landed, { window: 'morning' }))).toBe(1);
		expect(badge(digest([], { window: 'morning' }))).toBeNull();
	});

	it('counts no further back than the look-back setting, as the card does', () => {
		const d = digest(
			[
				task('recent', 'landed', { mergedAt: '2026-10-31T08:30:00Z' }),
				task('early', 'landed', { mergedAt: '2026-10-31T07:30:00Z' })
			],
			{ window: 'morning', morningStart: '07:00', lookbackHours: 1 }
		);
		expect(badge(d)).toBe(1);
	});

	it('counts every landed task, not only those a list shows', () => {
		const tasks = Array.from({ length: 60 }, (_, i) =>
			task(`l${i}`, 'landed', { mergedAt: new Date(now - (i + 1) * 60_000).toISOString() })
		);
		expect(badge(digest(tasks, { window: 'morning' }))).toBe(60);
	});

	it('has no count since the last visit, which only the browser knows', () => {
		expect(badge(digest(landed))).toBeNull();
		expect(badge(null)).toBeNull();
	});
});

describe('the plugin', () => {
	const manifest = JSON.parse(readFileSync('.wheelhouse-plugin/plugin.json', 'utf8'));

	it('contributes exactly what its manifest declares', () => {
		expect(plugin.contributions.map((c) => ({ id: c.id, slot: c.slot }))).toEqual(
			manifest.wheelhouse.contributions.map((c) => ({ id: c.id, slot: c.slot }))
		);
		expect(plugin.services ?? []).toEqual(manifest.wheelhouse.services);
	});

	it('draws each entry with one of its own elements, from its own providers', () => {
		const ids = new Set(plugin.providers.map((p) => p.id));
		for (const c of plugin.contributions) {
			expect(ids.has(c.provider)).toBe(true);
			expect(c.render.element.startsWith(`${manifest.name}-`)).toBe(true);
		}
	});

	it('reads only the fleet and its settings when no landed work lacks a merge time', async () => {
		const { r, calls } = await fetchWith(
			[task('busy', 'working'), task('m', 'landed', { mergedAt: '2026-10-31T08:00:00Z' })],
			forbidden
		);
		expect(calls).toEqual([]);
		expect(r.available).toBe(true);
		expect(r.value.schema).toBe('captains-log.v1');
		expect(r.value.underway).toHaveLength(1);
		expect(JSON.parse(JSON.stringify(r.value))).toEqual(r.value);
	});

	it('reads the ledger once, for just the day-only tasks done this week', async () => {
		const { calls } = await fetchWith(
			[
				task('a', 'landed', { completedOn: '2026-10-31' }),
				task('b', 'landed', { completedOn: '2026-10-30' }),
				task('old', 'landed', { completedOn: '2026-10-20' }),
				task('m', 'landed', { completedOn: '2026-10-31', mergedAt: '2026-10-31T08:00:00Z' })
			],
			ok('')
		);
		expect(calls).toEqual([
			{
				argv: [
					'grep',
					'-F',
					'-e',
					'"task":"a","state":"done"',
					'-e',
					'"event":"task.cleaned_up","task":"a"',
					'-e',
					'"task":"b","state":"done"',
					'-e',
					'"event":"task.cleaned_up","task":"b"',
					'state/fleet-ledger.jsonl'
				],
				cwd: 'home',
				timeoutMs: 3_000,
				maxBytes: 4 * 1024 * 1024
			}
		]);
	});

	it('does not read the ledger for day-only work too old to show', async () => {
		const { calls } = await fetchWith(
			[task('old', 'landed', { completedOn: '2026-10-20' })],
			forbidden
		);
		expect(calls).toEqual([]);
	});

	it('reads at most MAX_LEDGER_TASKS tasks, the most recently done', async () => {
		const tasks = Array.from({ length: MAX_LEDGER_TASKS + 20 }, (_, i) =>
			task(`t${i}`, 'landed', { completedOn: i < 20 ? '2026-10-25' : '2026-10-31' })
		);
		const { calls } = await fetchWith(tasks, ok(''));
		const named = calls[0].argv.filter((a) => a.endsWith(',"state":"done"'));
		expect(named).toHaveLength(MAX_LEDGER_TASKS);
		expect(named.some((a) => /"t1?\d",/.test(a))).toBe(false);
	});
});

const sec = (iso) => Date.parse(iso) / 1000;
const ledger = (...records) =>
	records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n');
const ok = (stdout) => async () => ({ ok: true, stdout });
const forbidden = () => {
	throw new Error('the digest reads nothing else');
};

/** Run the provider as Wheelhouse does, recording each exec it makes. */
async function fetchWith(tasks, exec, settings = {}) {
	const calls = [];
	const ctx = {
		project: null,
		task: null,
		projects,
		tasks,
		settings,
		signal: new AbortController().signal,
		exec: async (c) => {
			calls.push(c);
			return exec(c);
		},
		readFile: forbidden,
		listDir: forbidden,
		changedFiles: forbidden
	};
	return { r: await plugin.providers[0].fetch(ctx), calls };
}

/** Run each read for real: grep in a Firstmate home holding this ledger, capped as asked. */
function realGrep(text) {
	const home = mkdtempSync(join(tmpdir(), 'captains-log-'));
	mkdirSync(join(home, 'state'));
	writeFileSync(join(home, 'state/fleet-ledger.jsonl'), text);
	return (c) =>
		new Promise((resolve) => {
			execFile(
				c.argv[0],
				c.argv.slice(1),
				{ cwd: home, maxBuffer: c.maxBytes },
				(err, stdout, stderr) =>
					resolve(
						err
							? { ok: false, reason: `exited with code ${err.code}`, stdout, stderr }
							: { ok: true, stdout }
					)
			);
		});
}

describe('work done on a day with no merge time', () => {
	const done = task('day', 'landed', { completedOn: '2026-10-31' });
	const records = ledger(
		{ v: 1, ts: sec('2026-10-31T08:00:00Z'), event: 'task.status', task: 'day', state: 'working' },
		{ v: 1, ts: sec('2026-10-30T22:00:00Z'), event: 'task.status', task: 'day', state: 'done' },
		{ v: 1, ts: sec('2026-10-31T08:40:00Z'), event: 'task.cleaned_up', task: 'day' },
		{ v: 1, ts: sec('2026-10-31T08:20:00Z'), event: 'task.status', task: 'day', state: 'done' },
		{ v: 1, ts: sec('2026-10-31T07:00:00Z'), event: 'task.merged', task: 'day' },
		{ v: 1, ts: sec('2026-10-31T07:30:00Z'), event: 'task.status', task: 'other', state: 'done' },
		'{not json',
		''
	);

	it('gets its done time from a ledger far larger than one read may return', async () => {
		const noise = [];
		for (let i = 0; i < 40_000; i++) {
			noise.push({
				v: 1,
				ts: sec('2026-10-31T06:00:00Z') + i,
				event: 'task.status',
				task: i % 2 ? 'busy' : 'day-two',
				state: i % 3 ? 'working' : 'done',
				key: null,
				text: ' ' + 'x'.repeat(150)
			});
		}
		const text = ledger(...noise, {
			v: 1,
			ts: sec('2026-10-31T08:20:00Z'),
			event: 'task.status',
			task: 'day',
			state: 'done',
			key: null,
			text: ' ok'
		});
		expect(text.length).toBeGreaterThan(4 * 1024 * 1024);
		const { r, calls } = await fetchWith([done], realGrep(text));
		expect(calls).toHaveLength(1);
		expect(calls[0].argv.filter((a) => a.includes('"task":'))).toEqual([
			'"task":"day","state":"done"',
			'"event":"task.cleaned_up","task":"day"'
		]);
		expect(r.value.landed.map((i) => [i.at, i.time])).toEqual([
			['2026-10-31T08:20:00.000Z', 'done']
		]);
	});

	it('lands when the ledger first says it was done that day', async () => {
		const { r } = await fetchWith([done], ok(records));
		expect(r.value.landed.map((i) => [i.title, i.at, i.time])).toEqual([
			['Task day', '2026-10-31T08:20:00.000Z', 'done']
		]);
	});

	it('is new once: on the visit after it was done, and not on the next', async () => {
		const { r } = await fetchWith([done], ok(records));
		const before = Date.parse('2026-10-31T08:00:00Z');
		const after = Date.parse('2026-10-31T08:50:00Z');
		expect(lines(r.value, before).landed.items.map((i) => i.title)).toEqual(['Task day']);
		expect(lines(r.value, after).landed.items).toEqual([]);
	});

	it('shows in the morning window, and the badge, when done after the morning start', async () => {
		const { r } = await fetchWith([done], ok(records), {
			window: 'morning',
			morningStart: '08:00'
		});
		const w = windowStart(r.value.settings, now, null);
		expect(lines(r.value, w.start).landed.sentence).toBe('Task day landed.');
		expect(badge(r.value)).toBe(1);
	});

	it('sorts below same-day work with a real time when the ledger has no record', async () => {
		const { r } = await fetchWith(
			[done, task('m', 'landed', { mergedAt: '2026-10-31T00:30:00Z' })],
			ok('')
		);
		expect(r.value.landed.map((i) => [i.title, i.at, i.time])).toEqual([
			['Task m', '2026-10-31T00:30:00.000Z', 'merged'],
			['Task day', '2026-10-31T00:00:00.000Z', 'day']
		]);
	});

	it.each([
		[
			'missing',
			async () => ({ ok: false, reason: 'exited with code 2', stdout: '', stderr: 'No such file' })
		],
		[
			'without matches',
			async () => ({ ok: false, reason: 'exited with code 1', stdout: '', stderr: '' })
		],
		[
			'unreadable',
			async () => {
				throw new Error('refused');
			}
		]
	])('counts from the start of its day when the ledger is %s', async (_, exec) => {
		const { r } = await fetchWith([done], exec);
		expect(r.available).toBe(true);
		expect(r.value.landed.map((i) => [i.at, i.time])).toEqual([
			['2026-10-31T00:00:00.000Z', 'day']
		]);
	});
});

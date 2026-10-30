// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDigest } from '../wheelhouse/server/index.js';

const NOW = Date.parse('2026-10-31T09:00:00Z');
const HOUR = 3600 * 1000;
const projects = [{ id: 'atlas', name: 'Atlas', description: null, path: null }];

function task(id, status, extra = {}) {
	return {
		id,
		title: `Task ${id}`,
		shortTitle: `Task ${id}`,
		projectId: 'atlas',
		status,
		statusLabel: 'Working',
		pr: null,
		completedOn: null,
		mergedAt: null,
		...extra
	};
}

const fleet = (tasks, settings = {}) => buildDigest({ tasks, projects, settings, now: NOW });

let safeHref;

beforeAll(async () => {
	({ safeHref } = await import('../wheelhouse/ui/index.js'));
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	localStorage.clear();
	document.body.replaceChildren();
});

afterEach(() => vi.useRealTimers());

/** Mount an element as Wheelhouse does: create it, add it, set its data. */
function mount(tag, data) {
	const e = document.createElement(tag);
	document.body.append(e);
	e.data = data;
	return e;
}

const text = (e) => e.shadowRoot.textContent.replace(/\s+/g, ' ');
const summaries = (e) =>
	[...e.shadowRoot.querySelectorAll('summary')].map((s) => s.textContent.trim());

describe('<captains-log-digest>', () => {
	it('shows three plain lines, starting at the morning start on a first visit', () => {
		const e = mount(
			'captains-log-digest',
			fleet([
				task('a', 'landed', { mergedAt: '2026-10-31T08:00:00Z' }),
				task('old', 'landed', { mergedAt: '2026-10-31T05:00:00Z' }),
				task('b', 'needs-decision', {
					attention: { kind: 'decision', owner: 'captain', text: '', url: null }
				}),
				task('c', 'working'),
				task('d', 'queued')
			])
		);
		expect(text(e)).toContain("Captain's log");
		expect(text(e)).toContain('Since 07:00 this morning');
		expect(summaries(e)).toEqual([
			'Task a landed.',
			'1 thing waits on you: a decision.',
			'1 under way. Next up: Task d.'
		]);
		const whole = [...e.shadowRoot.querySelectorAll('a')].find(
			(a) => a.textContent === 'Whole log'
		);
		expect(whole.getAttribute('href')).toBe('/plugins/captains-log/log');
	});

	it('starts at the last visit this browser remembers', () => {
		localStorage.setItem(
			'captains-log:visit',
			JSON.stringify({ lastSeen: NOW - 9 * HOUR, anchor: null })
		);
		const e = mount(
			'captains-log-digest',
			fleet([task('old', 'landed', { mergedAt: '2026-10-31T05:00:00Z' })])
		);
		expect(text(e)).toContain('Since you were last here, 9 hours ago');
		expect(summaries(e)[0]).toBe('Task old landed.');
		expect(JSON.parse(localStorage.getItem('captains-log:visit'))).toEqual({
			lastSeen: NOW,
			anchor: NOW - 9 * HOUR
		});
	});

	it('opens a line to its items, linked to their task pages and pull requests', () => {
		const e = mount(
			'captains-log-digest',
			fleet([
				task('a', 'landed', {
					mergedAt: '2026-10-31T08:00:00Z',
					pr: { url: 'https://github.com/o/r/pull/7', number: 7 }
				})
			])
		);
		const first = e.shadowRoot.querySelector('details');
		expect(first.open).toBe(false);
		const links = [...first.querySelectorAll('li a')].map((a) => [
			a.textContent,
			a.getAttribute('href')
		]);
		expect(links).toEqual([
			['Task a', '/tasks/a'],
			['pull request', 'https://github.com/o/r/pull/7']
		]);
		expect(first.querySelector('.meta').textContent).toContain('Atlas');
		expect(first.querySelector('.meta').textContent).toContain('merged 08:00');
	});

	it('keeps a line open when the data refreshes', () => {
		const e = mount('captains-log-digest', fleet([task('c', 'working')]));
		const third = e.shadowRoot.querySelectorAll('details')[2];
		third.open = true;
		third.dispatchEvent(new Event('toggle'));
		e.data = fleet([task('c', 'working'), task('e', 'working')]);
		const again = e.shadowRoot.querySelectorAll('details')[2];
		expect(again.open).toBe(true);
		expect(again.querySelector('summary').textContent).toContain('2 under way');
	});

	it('shows titles as text, never as markup', () => {
		const e = mount(
			'captains-log-digest',
			fleet([task('x', 'working', { shortTitle: '<img src=x onerror=alert(1)>' })])
		);
		expect(e.shadowRoot.querySelector('img')).toBeNull();
		expect(text(e)).toContain('<img src=x onerror=alert(1)>');
	});

	it('says when a setting could not be used', () => {
		const e = mount('captains-log-digest', fleet([], { morningStart: 'dawn' }));
		expect(text(e)).toContain('“dawn” is not a time like 07:00');
	});

	it('counts everything in its lines, while each list shows at most 50', () => {
		const tasks = [];
		for (let i = 0; i < 60; i++) {
			tasks.push(
				task(`pr${i}`, 'needs-review', {
					attention: { kind: 'review', owner: 'captain', text: '', url: null }
				}),
				task(`l${i}`, 'landed', { mergedAt: new Date(NOW - (i + 1) * 60_000).toISOString() })
			);
		}
		const e = mount('captains-log-digest', fleet(tasks));
		expect(summaries(e)[0]).toMatch(/^60 changes landed:/);
		expect(summaries(e)[1]).toBe('60 things wait on you: 60 pull requests to review.');
		const lists = [...e.shadowRoot.querySelectorAll('ul')].map((u) => u.children.length);
		expect(lists.slice(0, 2)).toEqual([50, 50]);
	});

	it('draws nothing for a value it does not know', () => {
		const e = mount('captains-log-digest', { schema: 'something-else' });
		expect(e.shadowRoot.childNodes).toHaveLength(0);
	});
});

describe('<captains-log-page>', () => {
	it('shows the lines for now, then each of the last seven days', () => {
		const e = mount(
			'captains-log-page',
			fleet([
				task('a', 'landed', { mergedAt: '2026-10-31T08:00:00Z' }),
				task('b', 'landed', { completedOn: '2026-10-29' })
			])
		);
		const days = [...e.shadowRoot.querySelectorAll('.day')].map((d) =>
			d.textContent.replace(/\s+/g, ' ').trim()
		);
		expect(days).toHaveLength(7);
		expect(days[0]).toContain('Today');
		expect(days[0]).toContain('Task a landed.');
		expect(days[1]).toContain('A quiet day: nothing landed.');
		expect(days[2]).toContain('Task b landed.');
		expect(days[2]).toContain('landed Thursday');
	});

	it('shows what landed earlier in the week, not only the newest 50 changes', () => {
		const tasks = Array.from({ length: 60 }, (_, i) =>
			task(`l${i}`, 'landed', {
				mergedAt: new Date(NOW - (i < 55 ? i + 1 : 5 * 24) * HOUR).toISOString()
			})
		);
		const e = mount('captains-log-page', fleet(tasks));
		const days = [...e.shadowRoot.querySelectorAll('.day')].map((d) =>
			d.textContent.replace(/\s+/g, ' ').trim()
		);
		expect(days[5]).toContain('5 changes landed');
	});
});

describe('safeHref', () => {
	it('allows same-origin paths and https links only', () => {
		expect(safeHref('/tasks/a')).toBe('/tasks/a');
		expect(safeHref('https://github.com/o/r/pull/1')).toBe('https://github.com/o/r/pull/1');
		expect(safeHref('//evil.test/x')).toBeNull();
		expect(safeHref('javascript:alert(1)')).toBeNull();
		expect(safeHref(null)).toBeNull();
	});
});

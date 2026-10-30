/**
 * Captain's log's custom elements. Wheelhouse imports this bundle, then sets
 * the digest provider's value on the element as `data` each time it changes.
 *
 * <captains-log-digest> is the home rail's Log tab: three plain lines (landed,
 * waiting on you, under way and next), each opening to its list.
 * <captains-log-page> is the Captain's log page: the same lines for now, then
 * what landed on each of the last seven days.
 *
 * "Since you were last here" is this browser's own record, kept in
 * localStorage while the log is on screen. All plugin text goes in with
 * textContent; links are same-origin task pages, or https pull requests.
 * Styles use Wheelhouse's CSS variables, so both themes follow the page.
 *
 * @typedef {import('./digest.js').Digest} Digest
 */

import {
	DEFAULTS,
	MAX_ITEMS,
	VISIT_GAP_MS,
	byDay,
	dayLabel,
	landedSentence,
	lines,
	visit,
	windowStart
} from './digest.js';

const STORE_KEY = 'captains-log:visit';
const PAGE_HREF = '/plugins/captains-log/log';

const STYLE = `
	:host { display: block; font: inherit; color: var(--foreground); }
	a { color: var(--sea); text-decoration: none; }
	a:hover { text-decoration: underline; }
	a:focus-visible, summary:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: 4px; }
	.card { background: var(--card); color: var(--card-foreground, var(--foreground)); border: 1px solid var(--border); border-radius: var(--radius); padding: 0.9rem 1rem 0.75rem; }
	.banner { display: flex; align-items: center; gap: 0.6rem; }
	.banner svg { color: var(--brass); flex: none; }
	.banner .name { font-size: 0.72rem; font-weight: 500; letter-spacing: 0.16em; text-transform: uppercase; color: var(--brass); }
	.banner .rule { flex: 1; border-top: 1px solid var(--hair, var(--border)); }
	.since { margin: 0.15rem 0 0.55rem; font-size: 0.82rem; color: var(--muted-foreground); }
	.note { margin: 0 0 0.5rem; font-size: 0.78rem; color: var(--warning); }
	details { border-top: 1px solid var(--border); }
	details:first-of-type { border-top: 0; }
	summary { list-style: none; display: grid; grid-template-columns: 1.4rem minmax(0, 1fr) 1rem; gap: 0.5rem; align-items: start; padding: 0.6rem 0; cursor: pointer; font-size: 0.925rem; line-height: 1.45; }
	summary::-webkit-details-marker { display: none; }
	summary .icon { margin-top: 0.12rem; }
	summary .chev { margin-top: 0.25rem; color: var(--muted-foreground); transition: transform 0.2s ease-out; }
	details[open] summary .chev { transform: rotate(90deg); }
	.landed { color: var(--success); } .waiting { color: var(--sea); } .ahead { color: var(--brass); }
	ul { list-style: none; margin: 0 0 0.7rem 1.9rem; padding: 0; display: grid; gap: 0.45rem; }
	li { display: grid; gap: 0.05rem; font-size: 0.86rem; min-width: 0; overflow-wrap: anywhere; }
	.meta { display: flex; flex-wrap: wrap; gap: 0.15rem 0.7rem; font-size: 0.78rem; color: var(--muted-foreground); }
	.tag { font-size: 0.66rem; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; border: 1px solid var(--border); border-radius: 3px; padding: 0 0.3rem; }
	.empty { margin: 0 0 0.7rem 1.9rem; font-size: 0.82rem; color: var(--muted-foreground); }
	.foot { display: flex; justify-content: space-between; gap: 1rem; margin-top: 0.3rem; padding-top: 0.55rem; border-top: 1px dashed var(--hair, var(--border)); font-size: 0.8rem; color: var(--muted-foreground); }
	.page { max-width: 46rem; }
	.page h2 { margin: 1.6rem 0 0.2rem; font: 400 1.2rem var(--font-display, serif); }
	.page .lede { margin: 0 0 1rem; font-size: 0.9rem; color: var(--muted-foreground); }
	.day { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: 1rem; padding: 0.85rem 0; border-top: 1px solid var(--border); }
	.day .when { font: italic 400 1.02rem var(--font-display, serif); }
	.day .when small { display: block; font: 400 0.78rem var(--font-sans, inherit); color: var(--muted-foreground); }
	.day p { margin: 0 0 0.3rem; font-size: 0.92rem; }
	.day ul { margin: 0.2rem 0 0; }
	@media (max-width: 40rem) { .day { grid-template-columns: 1fr; gap: 0.3rem; } }
	@media (prefers-reduced-motion: reduce) { summary .chev { transition: none; } }
`;

/** Lucide icons (ISC licence), drawn with the text colour. */
const ICONS = {
	book: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
	check: ['M20 6 9 17l-5-5'],
	hand: [
		'M18 11V6a2 2 0 0 0-4 0v5',
		'M14 10V4a2 2 0 0 0-4 0v6',
		'M10 10.5V6a2 2 0 0 0-4 0v8',
		'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15'
	],
	sail: ['M22 18H2a4 4 0 0 0 4 4h12a4 4 0 0 0 4-4Z', 'M21 14 10 2 3 14h18Z', 'M10 2v16'],
	chevron: ['m9 18 6-6-6-6']
};

function icon(name, size, className) {
	const NS = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(NS, 'svg');
	for (const [k, v] of Object.entries({
		width: size,
		height: size,
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 2,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		'aria-hidden': 'true'
	})) {
		svg.setAttribute(k, String(v));
	}
	if (className) svg.setAttribute('class', className);
	for (const d of ICONS[name]) {
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('d', d);
		svg.append(p);
	}
	return svg;
}

function el(tag, className, text) {
	const e = document.createElement(tag);
	if (className) e.className = className;
	if (text !== undefined) e.textContent = text;
	return e;
}

/** A same-origin path or an https URL, else null: the only links the log makes. */
export function safeHref(href) {
	if (typeof href !== 'string') return null;
	if (/^\/(?!\/)/.test(href)) return href;
	try {
		return new URL(href).protocol === 'https:' ? href : null;
	} catch {
		return null;
	}
}

function link(href, text, external) {
	const safe = safeHref(href);
	if (!safe) return el('span', '', text);
	const a = el('a', '', text);
	a.href = safe;
	if (external) {
		a.target = '_blank';
		a.rel = 'noreferrer';
	}
	return a;
}

const clock = (ms) =>
	new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

/** When an item landed, in a few words: the time today, else the day (and time, when exact). */
function landedWords(item, now) {
	const at = Date.parse(item.at);
	const day = dayLabel(at, now);
	if (!item.exact)
		return `landed ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
	if (day === 'Today') return `merged ${clock(at)}`;
	return `merged ${day === 'Yesterday' ? 'yesterday' : day} ${clock(at)}`;
}

const WAITING_WORDS = {
	decision: 'a decision for you',
	review: 'a pull request to review',
	merge: 'approved, yours to merge'
};

/** One item in a drill-in list: its title (to its task page), project, what it is, its pull request. */
function item(i, words) {
	const li = el('li');
	li.append(link(i.href, i.title, false));
	const meta = el('span', 'meta');
	if (i.project) meta.append(el('span', 'tag', i.project));
	if (words) meta.append(el('span', '', words));
	if (i.pr && safeHref(i.pr)) meta.append(link(i.pr, 'pull request', true));
	li.append(meta);
	return li;
}

function list(items, words, empty) {
	if (!items.length) return el('p', 'empty', empty);
	const ul = el('ul');
	for (const i of items.slice(0, MAX_ITEMS)) ul.append(item(i, words(i)));
	return ul;
}

/** The three lines, as <details> that open to their lists, keeping which are open in `open`. */
function threeLines(d, start, now, open) {
	const l = lines(d, start);
	const rows = [
		{
			key: 'landed',
			icon: 'check',
			sentence: l.landed.sentence,
			body: list(l.landed.items, (i) => landedWords(i, now), 'Nothing landed in this window.')
		},
		{
			key: 'waiting',
			icon: 'hand',
			sentence: l.waiting.sentence,
			body: list(l.waiting.items, (i) => WAITING_WORDS[i.kind], 'Nothing needs you right now.')
		},
		{
			key: 'ahead',
			icon: 'sail',
			sentence: l.ahead.sentence,
			body: list(
				l.ahead.items,
				(i) => ('turn' in i ? (i.turn ? 'next in the backlog' : 'queued') : i.state),
				'The crew has nothing on.'
			)
		}
	];
	return rows.map((r) => {
		const det = el('details');
		det.open = open.has(r.key);
		det.addEventListener('toggle', () => (det.open ? open.add(r.key) : open.delete(r.key)));
		const sum = el('summary');
		sum.append(
			icon(r.icon, 18, `icon ${r.key}`),
			el('span', '', r.sentence),
			icon('chevron', 14, 'chev')
		);
		det.append(sum, r.body);
		return det;
	});
}

function readVisit() {
	try {
		return JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
	} catch {
		return null;
	}
}

function writeVisit(v) {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(v));
	} catch {
		// Without storage the log covers the morning window instead.
	}
}

/** The digest's value, or null when it is not one this version reads. */
function digest(v) {
	return v && typeof v === 'object' && v.schema === 'captains-log.v1' ? v : null;
}

class Base extends HTMLElement {
	/** @type {Digest | null} */
	#data = null;
	/** The current visit's start, fixed while the log stays on screen. */
	anchor = null;
	#onVisible = () => {
		this.look();
		this.render();
	};

	constructor() {
		super();
		this.attachShadow({ mode: 'open' });
	}

	set data(value) {
		this.#data = digest(value);
		// Each refresh while the log is on screen counts as the captain still being here.
		this.look();
		this.render();
	}

	get data() {
		return this.#data;
	}

	connectedCallback() {
		document.addEventListener('visibilitychange', this.#onVisible);
		this.look();
		this.render();
	}

	disconnectedCallback() {
		document.removeEventListener('visibilitychange', this.#onVisible);
	}

	/** Record a look while the page is on screen; a hidden page is not the captain looking. */
	look() {
		if (document.visibilityState === 'hidden') return;
		const v = visit(readVisit(), Date.now(), VISIT_GAP_MS);
		this.anchor = v.anchor;
		writeVisit(v.next);
	}

	frame(...children) {
		const style = el('style');
		style.textContent = STYLE;
		this.shadowRoot.replaceChildren(style, ...children);
	}
}

class CaptainsLogDigest extends Base {
	#open = new Set();

	render() {
		const d = this.data;
		if (!d || !this.shadowRoot) return;
		const now = Date.now();
		const settings = { ...DEFAULTS, ...d.settings };
		const w = windowStart(settings, now, this.anchor);
		const card = el('div', 'card');
		const banner = el('div', 'banner');
		banner.append(icon('book', 16), el('span', 'name', "Captain's log"), el('span', 'rule'));
		card.append(banner, el('p', 'since', w.label));
		for (const p of d.problems ?? []) card.append(el('p', 'note', p));
		card.append(...threeLines(d, w.start, now, this.#open));
		const foot = el('div', 'foot');
		foot.append(el('span', '', `Updated ${clock(Date.parse(d.generatedAt))}`));
		foot.append(link(PAGE_HREF, 'Whole log', false));
		card.append(foot);
		this.frame(card);
	}
}

class CaptainsLogPage extends Base {
	#open = new Set(['waiting', 'ahead']);

	render() {
		const d = this.data;
		if (!d || !this.shadowRoot) return;
		const now = Date.now();
		const settings = { ...DEFAULTS, ...d.settings };
		const w = windowStart(settings, now, this.anchor);
		const page = el('div', 'page');
		const card = el('div', 'card');
		card.append(el('p', 'since', w.label));
		for (const p of d.problems ?? []) card.append(el('p', 'note', p));
		card.append(...threeLines(d, w.start, now, this.#open));
		page.append(card, el('h2', '', 'The last seven days'));
		page.append(el('p', 'lede', 'What landed each day, newest first.'));
		for (const day of byDay(d.landed, now)) {
			const row = el('div', 'day');
			const when = el('div', 'when', day.label);
			when.append(
				el(
					'small',
					'',
					new Date(day.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
				)
			);
			const body = el('div');
			body.append(
				el('p', '', day.items.length ? landedSentence(day.items) : 'A quiet day: nothing landed.')
			);
			if (day.items.length) body.append(list(day.items, (i) => landedWords(i, now), ''));
			row.append(when, body);
			page.append(row);
		}
		this.frame(page);
	}
}

if (!customElements.get('captains-log-digest')) {
	customElements.define('captains-log-digest', CaptainsLogDigest);
}
if (!customElements.get('captains-log-page')) {
	customElements.define('captains-log-page', CaptainsLogPage);
}

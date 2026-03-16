import { describe, test, expect, vi } from 'vitest';

// Mock browser-polyfill before importing pdf-extractor
vi.mock('./browser-polyfill', () => ({
	default: {
		runtime: {
			getURL: (path: string) => `chrome-extension://fake-id/${path}`,
		},
	},
}));

// Mock pdfjs-dist to avoid worker setup side effects
vi.mock('pdfjs-dist', () => ({
	GlobalWorkerOptions: { workerSrc: '' },
}));

import { detectBodyFontSize, getHeadingLevel, TextItemWithFont } from './pdf-extractor';

function makeItem(str: string, fontSize: number, hasEOL = false): TextItemWithFont {
	return { str, fontSize, hasEOL, fontName: '' };
}

describe('getHeadingLevel', () => {
	const bodySize = 10;

	test('returns 0 for body-sized text', () => {
		expect(getHeadingLevel(10, bodySize)).toBe(0);
		expect(getHeadingLevel(10.5, bodySize)).toBe(0);
	});

	test('returns 3 for slightly larger text (ratio >= 1.1)', () => {
		expect(getHeadingLevel(11, bodySize)).toBe(3);
		expect(getHeadingLevel(12, bodySize)).toBe(3);
	});

	test('returns 2 for medium larger text (ratio >= 1.3)', () => {
		expect(getHeadingLevel(13, bodySize)).toBe(2);
		expect(getHeadingLevel(15, bodySize)).toBe(2);
	});

	test('returns 1 for large text (ratio >= 1.6)', () => {
		expect(getHeadingLevel(16, bodySize)).toBe(1);
		expect(getHeadingLevel(20, bodySize)).toBe(1);
	});

	test('returns 0 for text smaller than body', () => {
		expect(getHeadingLevel(8, bodySize)).toBe(0);
	});

	test('handles zero body font size gracefully', () => {
		// fontSize / 0 = Infinity, so ratio >= 1.6
		expect(getHeadingLevel(10, 0)).toBe(1);
		// 0 / 0 = NaN, NaN >= 1.6 is false → returns 0
		expect(getHeadingLevel(0, 0)).toBe(0);
	});
});

describe('detectBodyFontSize', () => {
	test('returns default 10 for empty input', () => {
		expect(detectBodyFontSize([])).toBe(10);
	});

	test('returns the most common font size by character count', () => {
		const items = [
			makeItem('Title', 18),           // 5 chars at 18pt
			makeItem('This is body text that is much longer.', 12), // 38 chars at 12pt
			makeItem('Subtitle', 14),         // 8 chars at 14pt
		];
		expect(detectBodyFontSize(items)).toBe(12);
	});

	test('ignores whitespace-only items', () => {
		const items = [
			makeItem('   ', 50),     // should be ignored
			makeItem('body', 10),
		];
		expect(detectBodyFontSize(items)).toBe(10);
	});

	test('rounds font sizes to one decimal place', () => {
		const items = [
			makeItem('text a', 10.04),  // rounds to 10.0
			makeItem('text b', 10.06),  // rounds to 10.1
			makeItem('text c long enough to win', 10.04), // rounds to 10.0
		];
		expect(detectBodyFontSize(items)).toBe(10);
	});
});

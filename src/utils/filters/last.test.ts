import { describe, test, expect, vi } from 'vitest';
import { last } from './last';

describe('last filter', () => {
	test('returns last element of array', () => {
		expect(last('["a","b","c"]')).toBe('c');
	});

	test('returns input if not array', () => {
		expect(last('hello')).toBe('hello');
	});

	test('handles single element array', () => {
		expect(last('["only"]')).toBe('only');
	});

	test('handles array of numbers', () => {
		expect(last('[1,2,3]')).toBe('3');
	});

	test('handles empty array', () => {
		// Empty array returns the input string as-is
		expect(last('[]')).toBe('[]');
	});

	test('does not log errors for plain (non-JSON) strings', () => {
		// Regression: previously last() called JSON.parse on any non-empty
		// input, which spammed console.error when given a plain string.
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(last('hello')).toBe('hello');
			expect(last('not-an-array')).toBe('not-an-array');
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});
});


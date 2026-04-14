import { describe, test, expect } from 'vitest';
import { createParserState, processCharacter } from './parser-utils';

function runThrough(input: string) {
	const state = createParserState();
	for (const char of input) {
		processCharacter(char, state);
	}
	return state;
}

describe('processCharacter', () => {
	test('tracks matching double-quoted strings', () => {
		const state = runThrough('"hello"');
		expect(state.inQuote).toBe(false);
		expect(state.current).toBe('"hello"');
	});

	test('tracks matching single-quoted strings', () => {
		const state = runThrough("'hello'");
		expect(state.inQuote).toBe(false);
		expect(state.current).toBe("'hello'");
	});

	test('does not close a double quote with a single quote', () => {
		// Regression: previously any quote character toggled the inQuote state
		// regardless of which quote opened it, so embedding a single quote
		// inside a double-quoted string would prematurely exit quote mode.
		// Partial string — leave it unterminated so we can inspect mid-state.
		const state = runThrough('"hello \'');
		expect(state.inQuote).toBe(true);
		expect(state.quoteType).toBe('"');
	});

	test('treats matching quote as closer after embedded mismatched quote', () => {
		// Inside a double-quoted string, a nested single quote is literal and
		// the final double quote still closes the string.
		const state = runThrough(`"he said 'hi'"`);
		expect(state.inQuote).toBe(false);
		expect(state.quoteType).toBe('');
	});

	test('does not close a single quote with a double quote', () => {
		const state = runThrough(`'it"s me`);
		expect(state.inQuote).toBe(true);
		expect(state.quoteType).toBe("'");
	});
});

import * as pdfjsLib from 'pdfjs-dist';
import browser from './browser-polyfill';

// Use the full chrome-extension:// URL for the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.min.mjs');

const MAX_PAGES = 100;

export interface PdfExtractionResult {
	text: string;
	pageCount: number;
	metadata: {
		title: string;
		author: string;
		subject: string;
		creationDate: string;
	};
}

export interface TextItemWithFont {
	str: string;
	hasEOL: boolean;
	fontSize: number;
	fontName: string;
}

// Detect the body font size (most common size in the document)
export function detectBodyFontSize(allItems: TextItemWithFont[]): number {
	const sizeCounts = new Map<number, number>();
	for (const item of allItems) {
		if (item.str.trim().length === 0) continue;
		const rounded = Math.round(item.fontSize * 10) / 10;
		sizeCounts.set(rounded, (sizeCounts.get(rounded) || 0) + item.str.length);
	}

	let bodySize = 10;
	let maxCount = 0;
	for (const [size, count] of sizeCounts) {
		if (count > maxCount) {
			maxCount = count;
			bodySize = size;
		}
	}
	return bodySize;
}

// Determine heading level based on font size relative to body text
export function getHeadingLevel(fontSize: number, bodyFontSize: number): number {
	const ratio = fontSize / bodyFontSize;
	if (ratio >= 1.6) return 1;  // ## (h1 reserved for document title)
	if (ratio >= 1.3) return 2;  // ###
	if (ratio >= 1.1) return 3;  // ####
	return 0; // not a heading
}

export async function extractPdfContent(pdfData: ArrayBuffer): Promise<PdfExtractionResult> {
	const doc = await pdfjsLib.getDocument({
		data: pdfData,
		isEvalSupported: false,
		useSystemFonts: true,
	} as any).promise;

	const pageCount = doc.numPages;
	const pagesToProcess = Math.min(pageCount, MAX_PAGES);

	// First pass: collect all text items with font size info
	const allPageItems: TextItemWithFont[][] = [];

	for (let i = 1; i <= pagesToProcess; i++) {
		const page = await doc.getPage(i);
		const textContent = await page.getTextContent();
		const pageItems: TextItemWithFont[] = [];

		for (const item of textContent.items) {
			if (!('str' in item)) continue;
			const typedItem = item as any;
			// Font size is encoded in the transform matrix: [scaleX, skewX, skewY, scaleY, translateX, translateY]
			// The vertical scale (index 3) gives us the font size in PDF points
			const fontSize = Math.abs(typedItem.transform?.[3] || typedItem.height || 0);
			pageItems.push({
				str: typedItem.str,
				hasEOL: typedItem.hasEOL || false,
				fontSize,
				fontName: typedItem.fontName || '',
			});
		}

		allPageItems.push(pageItems);
	}

	const allItems = allPageItems.flat();
	const bodyFontSize = detectBodyFontSize(allItems);

	// Second pass: build text with markdown heading markers
	const pageTextParts: string[] = [];

	for (const pageItems of allPageItems) {
		const parts: string[] = [];
		let lineBuffer = '';
		let lineCharCount = 0;

		let headingChars = 0;
		let bestHeadingLevel = 0;

		for (const item of pageItems) {
			const text = item.str;
			const headingLevel = text.trim().length > 0
				? getHeadingLevel(item.fontSize, bodyFontSize)
				: 0;

			// Accumulate text for the current line, tracking heading vs body chars
			if (text.trim().length > 0) {
				if (headingLevel > 0) {
					headingChars += text.length;
					// Keep the strongest (smallest number = largest) heading level seen
					if (bestHeadingLevel === 0 || headingLevel < bestHeadingLevel) {
						bestHeadingLevel = headingLevel;
					}
				}
				lineCharCount += text.length;
			}

			lineBuffer += text;

			if (item.hasEOL) {
				const trimmedLine = lineBuffer.trim();
				// Treat as heading if majority of chars are heading-sized
				const isHeading = bestHeadingLevel > 0 && lineCharCount > 0 && (headingChars / lineCharCount) > 0.5;
				if (trimmedLine.length > 0 && isHeading && trimmedLine.length < 200) {
					// Short line with larger font → likely a heading
					parts.push(`${'#'.repeat(bestHeadingLevel + 1)} ${trimmedLine}`);
				} else {
					parts.push(lineBuffer);
				}
				lineBuffer = '';
				lineCharCount = 0;
				headingChars = 0;
				bestHeadingLevel = 0;
			}
		}

		// Flush remaining buffer
		if (lineBuffer.length > 0) {
			const trimmedLine = lineBuffer.trim();
			const isHeading = bestHeadingLevel > 0 && lineCharCount > 0 && (headingChars / lineCharCount) > 0.5;
			if (trimmedLine.length > 0 && isHeading && trimmedLine.length < 200) {
				parts.push(`${'#'.repeat(bestHeadingLevel + 1)} ${trimmedLine}`);
			} else {
				parts.push(lineBuffer);
			}
		}

		pageTextParts.push(parts.join(''));
	}

	const metadataObj = await doc.getMetadata();
	const info = (metadataObj?.info || {}) as Record<string, any>;

	return {
		text: pageTextParts.join('\n\n'),
		pageCount,
		metadata: {
			title: info.Title || '',
			author: info.Author || '',
			subject: info.Subject || '',
			creationDate: info.CreationDate || '',
		},
	};
}

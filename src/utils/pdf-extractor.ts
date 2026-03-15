import * as pdfjsLib from 'pdfjs-dist';
import browser from './browser-polyfill';

// Use the full chrome-extension:// URL for the worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL('pdf.worker.min.mjs');

const MAX_PAGES = 100;
const MAX_IMAGES_PER_PAGE = 10;
const MAX_IMAGE_PIXELS = 2000 * 2000;
const MIN_IMAGE_PIXELS = 30 * 30;

export interface PdfExtractionResult {
	html: string;
	text: string;
	images: string[];
	pageCount: number;
	metadata: {
		title: string;
		author: string;
		subject: string;
		creationDate: string;
	};
}

interface TextItemInfo {
	str: string;
	x: number;
	y: number;
	width: number;
	height: number;
	fontSize: number;
	fontName: string;
	hasEOL: boolean;
}

interface TextLine {
	items: TextItemInfo[];
	y: number;
	fontSize: number;
	text: string;
	x: number;
}

interface FontAnalysis {
	bodySize: number;
	headingSizes: Map<number, number>;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function roundFontSize(size: number): number {
	return Math.round(size * 2) / 2;
}

function analyzeFontSizes(items: TextItemInfo[]): FontAnalysis {
	const sizeFrequency = new Map<number, number>();
	for (const item of items) {
		if (!item.str.trim()) continue;
		const rounded = roundFontSize(item.fontSize);
		sizeFrequency.set(rounded, (sizeFrequency.get(rounded) || 0) + item.str.length);
	}

	// Body size = most frequent font size by character count
	let bodySize = 0;
	let maxFreq = 0;
	for (const [size, freq] of sizeFrequency) {
		if (freq > maxFreq) {
			maxFreq = freq;
			bodySize = size;
		}
	}

	// Heading sizes = sizes significantly larger than body text
	const largerSizes = [...sizeFrequency.keys()]
		.filter(s => s > bodySize * 1.15)
		.sort((a, b) => b - a);

	const headingSizes = new Map<number, number>();
	largerSizes.forEach((size, index) => {
		headingSizes.set(size, Math.min(index + 1, 4));
	});

	return { bodySize, headingSizes };
}

function groupIntoLines(items: TextItemInfo[]): TextLine[] {
	if (items.length === 0) return [];

	// Sort by y descending (PDF y goes bottom-up), then x ascending
	const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

	const lines: TextLine[] = [];
	let currentLineItems: TextItemInfo[] = [sorted[0]];
	let currentY = sorted[0].y;

	for (let i = 1; i < sorted.length; i++) {
		const item = sorted[i];
		const tolerance = Math.max(item.fontSize * 0.3, 2);

		if (Math.abs(item.y - currentY) <= tolerance) {
			currentLineItems.push(item);
		} else {
			lines.push(buildLine(currentLineItems));
			currentLineItems = [item];
			currentY = item.y;
		}
	}
	if (currentLineItems.length > 0) {
		lines.push(buildLine(currentLineItems));
	}

	return lines;
}

function buildLine(items: TextItemInfo[]): TextLine {
	items.sort((a, b) => a.x - b.x);

	// Dominant font size by character count
	const sizeCount = new Map<number, number>();
	for (const item of items) {
		const rounded = roundFontSize(item.fontSize);
		sizeCount.set(rounded, (sizeCount.get(rounded) || 0) + item.str.length);
	}
	let dominantSize = items[0].fontSize;
	let maxCount = 0;
	for (const [size, count] of sizeCount) {
		if (count > maxCount) {
			maxCount = count;
			dominantSize = size;
		}
	}

	// Join text, adding a space between items that aren't adjacent
	let text = '';
	for (let i = 0; i < items.length; i++) {
		if (i > 0) {
			const prev = items[i - 1];
			const gap = items[i].x - (prev.x + prev.width);
			// Add space if there's a gap between items
			if (gap > prev.fontSize * 0.15) {
				text += ' ';
			}
		}
		text += items[i].str;
	}

	return {
		items,
		y: items[0].y,
		fontSize: dominantSize,
		text,
		x: items[0].x,
	};
}

const BULLET_PATTERN = /^[\s]*[•\-\*▪▸►◦‣⁃]\s+/;
const ORDERED_PATTERN = /^[\s]*(\d+[\.\)]\s+|[a-zA-Z][\.\)]\s+)/;

function detectListType(text: string): 'ul' | 'ol' | null {
	if (BULLET_PATTERN.test(text)) return 'ul';
	if (ORDERED_PATTERN.test(text)) return 'ol';
	return null;
}

function stripListMarker(text: string): string {
	return text.replace(BULLET_PATTERN, '').replace(ORDERED_PATTERN, '');
}

function isLargeGap(prevLine: TextLine, currentLine: TextLine): boolean {
	const gap = prevLine.y - currentLine.y;
	const lineHeight = Math.max(prevLine.fontSize, currentLine.fontSize);
	return gap > lineHeight * 1.5;
}

function linesToHtml(lines: TextLine[], fontAnalysis: FontAnalysis): string {
	const html: string[] = [];
	let inList: 'ul' | 'ol' | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const text = line.text.trim();
		if (!text) continue;

		const roundedSize = roundFontSize(line.fontSize);
		const headingLevel = fontAnalysis.headingSizes.get(roundedSize);
		const listType = detectListType(text);

		// Close list if current line isn't a list item
		if (inList && !listType) {
			html.push(`</${inList}>`);
			inList = null;
		}

		if (headingLevel) {
			const tag = `h${headingLevel}`;
			html.push(`<${tag}>${escapeHtml(text)}</${tag}>`);
		} else if (listType) {
			if (inList !== listType) {
				if (inList) html.push(`</${inList}>`);
				html.push(`<${listType}>`);
				inList = listType;
			}
			html.push(`<li>${escapeHtml(stripListMarker(text))}</li>`);
		} else {
			const prevLine = i > 0 ? lines[i - 1] : null;
			const isNewParagraph = !prevLine || isLargeGap(prevLine, line) || headingLevel != null;

			if (isNewParagraph || html.length === 0) {
				html.push(`<p>${escapeHtml(text)}</p>`);
			} else {
				// Append to previous paragraph
				const lastIdx = html.length - 1;
				if (html[lastIdx].endsWith('</p>')) {
					html[lastIdx] = html[lastIdx].slice(0, -4) + ' ' + escapeHtml(text) + '</p>';
				} else {
					html.push(`<p>${escapeHtml(text)}</p>`);
				}
			}
		}
	}

	if (inList) {
		html.push(`</${inList}>`);
	}

	return html.join('\n');
}

function getPageObject(page: any, name: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Image load timeout')), 5000);
		try {
			page.objs.get(name, (data: any) => {
				clearTimeout(timeout);
				resolve(data);
			});
		} catch (e) {
			clearTimeout(timeout);
			reject(e);
		}
	});
}

async function extractPageImages(page: any): Promise<string[]> {
	const ops = await page.getOperatorList();
	const images: string[] = [];
	const seenImages = new Set<string>();

	for (let i = 0; i < ops.fnArray.length && images.length < MAX_IMAGES_PER_PAGE; i++) {
		if (ops.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;

		const imageName = ops.argsArray[i][0];
		if (seenImages.has(imageName)) continue;
		seenImages.add(imageName);

		try {
			const imgData = await getPageObject(page, imageName);
			if (!imgData) continue;

			// Handle ImageBitmap (newer pdfjs versions)
			if (typeof ImageBitmap !== 'undefined' && imgData instanceof ImageBitmap) {
				const { width, height } = imgData;
				if (width * height > MAX_IMAGE_PIXELS || width * height < MIN_IMAGE_PIXELS) continue;

				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(imgData, 0, 0);
				images.push(canvas.toDataURL('image/jpeg', 0.85));
				continue;
			}

			// Handle raw pixel data
			const { width, height, kind, data } = imgData;
			if (!data || !width || !height) continue;
			if (width * height > MAX_IMAGE_PIXELS || width * height < MIN_IMAGE_PIXELS) continue;

			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d')!;
			const imageData = ctx.createImageData(width, height);

			if (kind === 2) {
				// RGB_24BPP
				for (let j = 0; j < width * height; j++) {
					imageData.data[j * 4] = data[j * 3];
					imageData.data[j * 4 + 1] = data[j * 3 + 1];
					imageData.data[j * 4 + 2] = data[j * 3 + 2];
					imageData.data[j * 4 + 3] = 255;
				}
			} else if (kind === 3) {
				// RGBA_32BPP
				imageData.data.set(data);
			} else {
				// Skip unsupported kinds (1BPP masks, etc.)
				continue;
			}

			ctx.putImageData(imageData, 0, 0);
			images.push(canvas.toDataURL('image/jpeg', 0.85));
		} catch (e) {
			console.warn('[PDF Clipper] Failed to extract image:', imageName, e);
		}
	}

	return images;
}

export async function extractPdfContent(pdfData: ArrayBuffer): Promise<PdfExtractionResult> {
	const doc = await pdfjsLib.getDocument({
		data: pdfData,
		isEvalSupported: false,
		useSystemFonts: true,
	} as any).promise;

	const pageCount = doc.numPages;
	const pagesToProcess = Math.min(pageCount, MAX_PAGES);

	// First pass: collect all text items to analyze font sizes across the document
	const allPageItems: TextItemInfo[][] = [];
	const allItems: TextItemInfo[] = [];
	const pages: any[] = [];

	for (let i = 1; i <= pagesToProcess; i++) {
		const page = await doc.getPage(i);
		pages.push(page);
		const textContent = await page.getTextContent();
		const pageItems: TextItemInfo[] = textContent.items
			.filter((item: any) => 'str' in item && item.str)
			.map((item: any) => ({
				str: item.str,
				x: item.transform[4],
				y: item.transform[5],
				width: item.width,
				height: item.height,
				fontSize: Math.abs(item.transform[3]) || Math.abs(item.transform[0]),
				fontName: item.fontName,
				hasEOL: item.hasEOL,
			}));
		allPageItems.push(pageItems);
		allItems.push(...pageItems);
	}

	const fontAnalysis = analyzeFontSizes(allItems);

	// Second pass: build structured HTML and extract images per page
	const pageHtmlParts: string[] = [];
	const pageTextParts: string[] = [];
	const allImages: string[] = [];

	for (let i = 0; i < pagesToProcess; i++) {
		const lines = groupIntoLines(allPageItems[i]);
		const textHtml = linesToHtml(lines, fontAnalysis);
		const plainText = lines.map(l => l.text).join('\n');

		// Extract images separately (not in HTML, since Defuddle strips data URIs)
		try {
			const images = await extractPageImages(pages[i]);
			allImages.push(...images);
		} catch (e) {
			console.warn('[PDF Clipper] Image extraction failed for page', i + 1, e);
		}

		pageHtmlParts.push(textHtml);
		pageTextParts.push(plainText);
	}

	// Extract metadata
	const metadataObj = await doc.getMetadata();
	const info = (metadataObj?.info || {}) as Record<string, any>;

	return {
		html: pageHtmlParts.join('\n<hr />\n'),
		text: pageTextParts.join('\n\n'),
		images: allImages,
		pageCount,
		metadata: {
			title: info.Title || '',
			author: info.Author || '',
			subject: info.Subject || '',
			creationDate: info.CreationDate || '',
		},
	};
}

import * as pdfjsLib from 'pdfjs-dist';

// Point to the bundled worker file in the extension directory
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.mjs';

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

export async function extractPdfContent(pdfData: ArrayBuffer): Promise<PdfExtractionResult> {
	const doc = await pdfjsLib.getDocument({
		data: pdfData,
		isEvalSupported: false,
		useSystemFonts: true,
	} as any).promise;

	const pageCount = doc.numPages;
	const pagesToProcess = Math.min(pageCount, MAX_PAGES);

	// Extract text from all pages
	const pageTexts: string[] = [];
	for (let i = 1; i <= pagesToProcess; i++) {
		const page = await doc.getPage(i);
		const textContent = await page.getTextContent();
		const pageText = textContent.items
			.map((item: any) => {
				if ('str' in item) {
					return item.str;
				}
				return '';
			})
			.join(' ');
		pageTexts.push(pageText);
	}

	const fullText = pageTexts.join('\n\n');

	// Extract metadata
	const metadataObj = await doc.getMetadata();
	const info = (metadataObj?.info || {}) as Record<string, any>;

	return {
		text: fullText,
		pageCount,
		metadata: {
			title: info.Title || '',
			author: info.Author || '',
			subject: info.Subject || '',
			creationDate: info.CreationDate || '',
		},
	};
}

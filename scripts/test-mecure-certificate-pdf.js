/**
 * Generates sample MeCure certificate PDFs locally for visual verification.
 * Usage: node scripts/test-mecure-certificate-pdf.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const SCRIPT_FONT_PATH = path.join(__dirname, '../assets/fonts/GreatVibes-Regular.ttf');

const MECURE_COLORS = {
    green: rgb(0.412, 0.745, 0.157),
    greenDark: rgb(0.337, 0.608, 0.125),
    gold: rgb(0.788, 0.635, 0.153),
    text: rgb(0.2, 0.2, 0.2),
    white: rgb(1, 1, 1),
};

function drawMecureFrame(page, width, height) {
    const cornerSize = 110;
    page.drawSvgPath(`M 0 ${height} L 0 ${height - cornerSize} L ${cornerSize} ${height} Z`, {
        color: MECURE_COLORS.green,
    });
    page.drawSvgPath(
        `M ${width} ${height} L ${width} ${height - cornerSize} L ${width - cornerSize} ${height} Z`,
        { color: MECURE_COLORS.green },
    );
    page.drawRectangle({ x: 0, y: 0, width, height: 22, color: MECURE_COLORS.green });
    page.drawRectangle({ x: 0, y: 22, width, height: 6, color: MECURE_COLORS.greenDark });
}

function drawCenteredText(page, text, y, size, font, color) {
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - textWidth) / 2, y, size, font, color });
}

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const page = pdfDoc.addPage([842, 595]);
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: 0, width, height, color: MECURE_COLORS.white });
    drawMecureFrame(page, width, height);

    const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const scriptFont = await pdfDoc.embedFont(fs.readFileSync(SCRIPT_FONT_PATH));

    drawCenteredText(page, 'CERTIFICATE', height - 88, 46, titleFont, MECURE_COLORS.gold);
    drawCenteredText(page, 'OF COMPLETION', height - 118, 14, titleFont, MECURE_COLORS.text);
    drawCenteredText(page, 'This is to certify that', height - 162, 14, bodyFont, MECURE_COLORS.text);
    drawCenteredText(page, 'Macdara Rashawn', height - 210, 38, scriptFont, MECURE_COLORS.gold);
    drawCenteredText(page, 'Has successfully completed the', height - 248, 14, bodyFont, MECURE_COLORS.text);
    drawCenteredText(page, '2030 ONLINE COURSE DEVELOPER', height - 278, 16, titleFont, MECURE_COLORS.text);
    drawCenteredText(
        page,
        'Monday, 20 April 2030',
        height - 310,
        13,
        bodyFont,
        MECURE_COLORS.text,
    );

    const outputPath = path.join(OUTPUT_DIR, 'mecure-certificate-sample.pdf');
    fs.writeFileSync(outputPath, await pdfDoc.save());
    console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

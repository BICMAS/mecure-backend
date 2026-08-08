import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fontkit from '@pdf-lib/fontkit';
import { StorageService } from '../services/StorageService.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_FONT_PATH = path.join(__dirname, '../../assets/fonts/GreatVibes-Regular.ttf');

const DEFAULT_THEME_CONFIG = {
    theme: 'classic',
    title: 'Certificate of Completion',
    signatory: '',
    signatoryRole: '',
    signatory2: '',
    signatoryRole2: '',
    signatorySignatureBlobUrl: '',
    signatorySignatureMimeType: '',
    signatory2SignatureBlobUrl: '',
    signatory2SignatureMimeType: '',
    showDate: true,
};

const MECURE_COLORS = {
    green: rgb(0.412, 0.745, 0.157), // #69BE28
    greenDark: rgb(0.337, 0.608, 0.125), // #569B20
    gold: rgb(0.788, 0.635, 0.153), // #C9A227
    text: rgb(0.2, 0.2, 0.2), // #333333
    white: rgb(1, 1, 1),
};

const THEME_STYLES = {
    classic: {
        background: rgb(1, 0.98, 0.94),
        primary: rgb(0.31, 0.06, 0.45),
        accent: rgb(0.72, 0.53, 0.04),
        muted: rgb(0.45, 0.45, 0.45),
        titleSize: 34,
        nameSize: 30,
        bodySize: 16,
        titleFont: 'TimesRomanBold',
        bodyFont: 'TimesRoman',
        signatoryFont: 'TimesRomanBoldItalic',
    },
    modern: {
        background: rgb(1, 1, 1),
        primary: rgb(0.31, 0.06, 0.45),
        accent: rgb(0.33, 0.65, 0.15),
        muted: rgb(0.42, 0.45, 0.5),
        titleSize: 30,
        nameSize: 28,
        bodySize: 15,
        titleFont: 'HelveticaBold',
        bodyFont: 'Helvetica',
        signatoryFont: 'HelveticaBold',
    },
    tech: {
        background: rgb(0.96, 0.97, 0.98),
        primary: rgb(0.12, 0.17, 0.24),
        accent: rgb(0.33, 0.65, 0.15),
        muted: rgb(0.35, 0.4, 0.45),
        titleSize: 26,
        nameSize: 24,
        bodySize: 14,
        titleFont: 'CourierBold',
        bodyFont: 'Courier',
        signatoryFont: 'CourierBold',
    },
    mecure: {
        background: MECURE_COLORS.white,
        primary: MECURE_COLORS.text,
        accent: MECURE_COLORS.green,
        muted: MECURE_COLORS.text,
        titleSize: 46,
        nameSize: 38,
        bodySize: 14,
        titleFont: 'HelveticaBold',
        bodyFont: 'Helvetica',
        signatoryFont: 'HelveticaBold',
    },
};

function slugify(value) {
    return String(value || 'certificate')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function formatIssueDate(date) {
    return new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

function formatIssueDateWithWeekday(date) {
    return new Date(date).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

export function parseTemplateMetadata(description) {
    if (!description) {
        return { internalNote: '', themeConfig: { ...DEFAULT_THEME_CONFIG } };
    }

    try {
        const parsed = JSON.parse(description);
        if (parsed?.themeConfig) {
            return {
                internalNote: parsed.internalNote || '',
                themeConfig: { ...DEFAULT_THEME_CONFIG, ...parsed.themeConfig },
            };
        }
    } catch {
        // Fall through — treat description as a plain internal note.
    }

    return { internalNote: description, themeConfig: { ...DEFAULT_THEME_CONFIG } };
}

export function serializeTemplateMetadata(internalNote, themeConfig) {
    return JSON.stringify({
        internalNote: internalNote || '',
        themeConfig: { ...DEFAULT_THEME_CONFIG, ...themeConfig },
    });
}

function getThemeStyle(themeName) {
    return THEME_STYLES[themeName] || THEME_STYLES.classic;
}

async function embedLogo(pdfDoc, logoBytes, mimeType) {
    const normalizedMime = String(mimeType || '').toLowerCase();
    if (normalizedMime.includes('png')) {
        return pdfDoc.embedPng(logoBytes);
    }
    if (normalizedMime.includes('jpeg') || normalizedMime.includes('jpg')) {
        return pdfDoc.embedJpg(logoBytes);
    }

    try {
        return pdfDoc.embedPng(logoBytes);
    } catch {
        return pdfDoc.embedJpg(logoBytes);
    }
}

function drawThemeFrame(page, themeName, width, height, styles) {
    if (themeName === 'classic') {
        page.drawRectangle({
            x: 24,
            y: 24,
            width: width - 48,
            height: height - 48,
            borderColor: styles.accent,
            borderWidth: 3,
        });
        page.drawRectangle({
            x: 36,
            y: 36,
            width: width - 72,
            height: height - 72,
            borderColor: rgb(0.75, 0.75, 0.75),
            borderWidth: 1,
        });
        return;
    }

    if (themeName === 'modern') {
        page.drawRectangle({
            x: 0,
            y: height - 18,
            width,
            height: 18,
            color: styles.primary,
        });
        page.drawRectangle({
            x: 0,
            y: 0,
            width: 8,
            height,
            color: styles.accent,
        });
        return;
    }

    if (themeName === 'mecure') {
        drawMecureFrame(page, width, height);
        return;
    }

    page.drawRectangle({
        x: 0,
        y: height - 56,
        width,
        height: 56,
        color: styles.primary,
    });
    page.drawRectangle({
        x: width - 120,
        y: height - 120,
        width: 120,
        height: 120,
        color: rgb(0.88, 0.91, 0.94),
    });
}

function drawMecureFrame(page, width, height) {
    const cornerSize = 110;

    page.drawSvgPath(`M 0 ${height} L 0 ${height - cornerSize} L ${cornerSize} ${height} Z`, {
        color: MECURE_COLORS.green,
    });
    page.drawSvgPath(
        `M ${width} ${height} L ${width} ${height - cornerSize} L ${width - cornerSize} ${height} Z`,
        { color: MECURE_COLORS.green },
    );

    page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: 22,
        color: MECURE_COLORS.green,
    });
    page.drawRectangle({
        x: 0,
        y: 22,
        width,
        height: 6,
        color: MECURE_COLORS.greenDark,
    });
}

function drawCenteredText(page, text, y, size, font, color) {
    const safeText = String(text || '');
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(safeText, size);
    const x = Math.max(24, (width - textWidth) / 2);
    page.drawText(safeText, { x, y, size, font, color });
}

function wrapText(text, font, size, maxWidth) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return [''];
    }

    const lines = [];
    let currentLine = words[0];

    for (let index = 1; index < words.length; index += 1) {
        const candidate = `${currentLine} ${words[index]}`;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
            currentLine = candidate;
        } else {
            lines.push(currentLine);
            currentLine = words[index];
        }
    }

    lines.push(currentLine);
    return lines;
}

function drawWrappedCenteredText(page, text, startY, size, font, color, maxWidth, lineGap = 6) {
    const lines = wrapText(text, font, size, maxWidth);
    let cursorY = startY;

    for (const line of lines) {
        drawCenteredText(page, line, cursorY, size, font, color);
        cursorY -= size + lineGap;
    }

    return cursorY;
}

async function drawSignatoryBlock(page, pdfDoc, {
    name,
    role,
    anchorX,
    align,
    y,
    bodyFont,
    signatoryFont,
    signatureBlobUrl,
    signatureMimeType,
}) {
    if (!name && !role && !signatureBlobUrl) {
        return y;
    }

    const lineWidth = 150;
    let lineStartX = anchorX - lineWidth / 2;

    if (align === 'left') {
        lineStartX = anchorX;
    } else if (align === 'right') {
        lineStartX = anchorX - lineWidth;
    }

    const lineY = y;

    if (signatureBlobUrl) {
        try {
            const signatureBytes = await StorageService.getObjectBuffer(signatureBlobUrl);
            const signatureImage = await embedLogo(pdfDoc, signatureBytes, signatureMimeType);
            const maxSignatureWidth = 120;
            const maxSignatureHeight = 36;
            const signatureScale = Math.min(
                maxSignatureWidth / signatureImage.width,
                maxSignatureHeight / signatureImage.height,
                1,
            );
            const signatureWidth = signatureImage.width * signatureScale;
            const signatureHeight = signatureImage.height * signatureScale;
            let signatureX = anchorX - signatureWidth / 2;

            if (align === 'left') {
                signatureX = anchorX;
            } else if (align === 'right') {
                signatureX = anchorX - signatureWidth;
            }

            page.drawImage(signatureImage, {
                x: signatureX,
                y: lineY + 8,
                width: signatureWidth,
                height: signatureHeight,
            });
        } catch (error) {
            console.warn('[CertificatePdfService] Failed to embed signatory signature:', error);
        }
    }

    page.drawLine({
        start: { x: lineStartX, y: lineY },
        end: { x: lineStartX + lineWidth, y: lineY },
        thickness: 1,
        color: MECURE_COLORS.text,
    });

    if (name) {
        const nameSize = 13;
        const nameWidth = signatoryFont.widthOfTextAtSize(name, nameSize);
        let nameDrawX = anchorX - nameWidth / 2;
        if (align === 'left') {
            nameDrawX = anchorX;
        } else if (align === 'right') {
            nameDrawX = anchorX - nameWidth;
        }

        page.drawText(name, {
            x: nameDrawX,
            y: lineY - 16,
            size: nameSize,
            font: signatoryFont,
            color: MECURE_COLORS.text,
        });
    }

    if (role) {
        const roleSize = 9;
        const roleWidth = bodyFont.widthOfTextAtSize(role, roleSize);
        let roleX = anchorX - roleWidth / 2;
        if (align === 'left') {
            roleX = anchorX;
        } else if (align === 'right') {
            roleX = anchorX - roleWidth;
        }

        page.drawText(role, {
            x: roleX,
            y: lineY - 30,
            size: roleSize,
            font: bodyFont,
            color: MECURE_COLORS.text,
        });
    }

    return lineY - 36;
}

async function loadScriptFont(pdfDoc, fallbackFont) {
    try {
        pdfDoc.registerFontkit(fontkit);
        const fontBytes = fs.readFileSync(SCRIPT_FONT_PATH);
        return await pdfDoc.embedFont(fontBytes);
    } catch (error) {
        console.warn(
            '[CertificatePdfService] Script font unavailable, using fallback:',
            error?.message || error,
        );
        return fallbackFont;
    }
}

async function drawMecureLogo(page, pdfDoc, template, footerTopY) {
    if (!template?.blobUrl) {
        return footerTopY;
    }

    const logoBytes = await StorageService.getObjectBuffer(template.blobUrl);
    const logoImage = await embedLogo(pdfDoc, logoBytes, template.mimeType);
    const maxLogoWidth = 140;
    const maxLogoHeight = 62;
    const scale = Math.min(
        maxLogoWidth / logoImage.width,
        maxLogoHeight / logoImage.height,
        1,
    );
    const logoWidth = logoImage.width * scale;
    const logoHeight = logoImage.height * scale;
    const { width } = page.getSize();
    const logoY = footerTopY + 8;

    page.drawImage(logoImage, {
        x: (width - logoWidth) / 2,
        y: logoY,
        width: logoWidth,
        height: logoHeight,
    });

    return logoY + logoHeight;
}

async function generateMecureCertificate({
    pdfDoc,
    page,
    template,
    themeConfig,
    traineeName,
    courseTitle,
    issuedAt,
}) {
    const styles = THEME_STYLES.mecure;
    const { width, height } = page.getSize();
    const footerReservedHeight = 28;
    const signatureBandHeight = 72;
    const logoBandHeight = 78;

    page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: styles.background,
    });

    drawMecureFrame(page, width, height);

    const titleFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const bodyFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const signatoryFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const scriptFont = await loadScriptFont(pdfDoc, titleFont);

    const contentBottomLimit =
        footerReservedHeight + logoBandHeight + signatureBandHeight + 12;

    drawCenteredText(page, 'CERTIFICATE', height - 88, styles.titleSize, titleFont, MECURE_COLORS.gold);
    drawCenteredText(page, 'OF COMPLETION', height - 118, 14, titleFont, MECURE_COLORS.text);
    drawCenteredText(
        page,
        'This is to certify that',
        height - 162,
        styles.bodySize,
        bodyFont,
        MECURE_COLORS.text,
    );

    const nameSize = scriptFont === titleFont ? 30 : styles.nameSize;
    drawCenteredText(page, traineeName, height - 210, nameSize, scriptFont, MECURE_COLORS.gold);
    drawCenteredText(
        page,
        'Has successfully completed the',
        height - 248,
        styles.bodySize,
        bodyFont,
        MECURE_COLORS.text,
    );

    const courseTitleY = drawWrappedCenteredText(
        page,
        courseTitle,
        height - 278,
        16,
        titleFont,
        MECURE_COLORS.text,
        width - 160,
        4,
    );

    let cursorY = Math.min(courseTitleY - 8, height - 310);

    if (themeConfig.showDate !== false) {
        drawCenteredText(
            page,
            formatIssueDateWithWeekday(issuedAt),
            cursorY,
            13,
            bodyFont,
            MECURE_COLORS.text,
        );
        cursorY -= 24;
    }

    const signatureBaseY = Math.max(contentBottomLimit + 36, 118);
    const leftAnchor = width * 0.28;
    const rightAnchor = width * 0.72;

    await drawSignatoryBlock(page, pdfDoc, {
        name: themeConfig.signatory,
        role: themeConfig.signatoryRole,
        anchorX: leftAnchor,
        align: 'center',
        y: signatureBaseY,
        bodyFont,
        signatoryFont,
        signatureBlobUrl: themeConfig.signatorySignatureBlobUrl,
        signatureMimeType: themeConfig.signatorySignatureMimeType,
    });

    await drawSignatoryBlock(page, pdfDoc, {
        name: themeConfig.signatory2,
        role: themeConfig.signatoryRole2,
        anchorX: rightAnchor,
        align: 'center',
        y: signatureBaseY,
        bodyFont,
        signatoryFont,
        signatureBlobUrl: themeConfig.signatory2SignatureBlobUrl,
        signatureMimeType: themeConfig.signatory2SignatureMimeType,
    });

    await drawMecureLogo(page, pdfDoc, template, footerReservedHeight);
}

async function generateStandardCertificate({
    pdfDoc,
    page,
    template,
    themeConfig,
    styles,
    traineeName,
    courseTitle,
    issuedAt,
}) {
    const { width, height } = page.getSize();

    page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: styles.background,
    });

    drawThemeFrame(page, themeConfig.theme, width, height, styles);

    const titleFont = await pdfDoc.embedFont(StandardFonts[styles.titleFont]);
    const bodyFont = await pdfDoc.embedFont(StandardFonts[styles.bodyFont]);
    const signatoryFont = await pdfDoc.embedFont(StandardFonts[styles.signatoryFont]);

    let contentTop = height - 72;

    if (template.blobUrl) {
        const logoBytes = await StorageService.getObjectBuffer(template.blobUrl);
        const logoImage = await embedLogo(pdfDoc, logoBytes, template.mimeType);
        const maxLogoWidth = 140;
        const maxLogoHeight = 72;
        const scale = Math.min(
            maxLogoWidth / logoImage.width,
            maxLogoHeight / logoImage.height,
            1,
        );
        const logoWidth = logoImage.width * scale;
        const logoHeight = logoImage.height * scale;

        page.drawImage(logoImage, {
            x: (width - logoWidth) / 2,
            y: contentTop - logoHeight,
            width: logoWidth,
            height: logoHeight,
        });

        contentTop -= logoHeight + 24;
    }

    const headerColor =
        themeConfig.theme === 'tech' ? rgb(1, 1, 1) : styles.muted;
    drawCenteredText(page, 'BICMAS LEARN', contentTop, 11, bodyFont, headerColor);
    drawCenteredText(
        page,
        themeConfig.title || DEFAULT_THEME_CONFIG.title,
        contentTop - 42,
        styles.titleSize,
        titleFont,
        themeConfig.theme === 'tech' ? rgb(1, 1, 1) : styles.primary,
    );

    drawCenteredText(page, 'This certifies that', height * 0.50, styles.bodySize, bodyFont, styles.muted);
    drawCenteredText(page, traineeName, height * 0.42, styles.nameSize, titleFont, styles.primary);
    drawCenteredText(
        page,
        'has successfully completed the course requirements for',
        height * 0.34,
        styles.bodySize,
        bodyFont,
        styles.muted,
    );
    drawCenteredText(page, courseTitle, height * 0.28, styles.bodySize + 2, titleFont, styles.primary);

    const footerBaseY = 52;
    let cursorY = footerBaseY;

    if (themeConfig.signatoryRole) {
        drawCenteredText(
            page,
            themeConfig.signatoryRole,
            cursorY,
            10,
            bodyFont,
            styles.muted,
        );
        cursorY += 16;
    }

    if (themeConfig.signatory) {
        page.drawLine({
            start: { x: width / 2 - 90, y: cursorY + 4 },
            end: { x: width / 2 + 90, y: cursorY + 4 },
            thickness: 1,
            color: styles.muted,
        });
        cursorY += 14;
        drawCenteredText(
            page,
            themeConfig.signatory,
            cursorY,
            16,
            signatoryFont,
            styles.primary,
        );
        cursorY += 28;
    }

    if (themeConfig.showDate !== false) {
        drawCenteredText(
            page,
            `Issued on ${formatIssueDate(issuedAt)}`,
            cursorY,
            13,
            bodyFont,
            styles.muted,
        );
    }
}

export class CertificatePdfService {
    static async generateAndUpload({ template, traineeName, courseTitle, issuedAt }) {
        if (!template) throw new Error('Template required');
        if (!traineeName) throw new Error('Trainee name required');
        if (!courseTitle) throw new Error('Course title required');

        const { themeConfig } = parseTemplateMetadata(template.description);
        const styles = getThemeStyle(themeConfig.theme);
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([842, 595]);

        if (themeConfig.theme === 'mecure') {
            await generateMecureCertificate({
                pdfDoc,
                page,
                template,
                themeConfig,
                traineeName,
                courseTitle,
                issuedAt,
            });
        } else {
            await generateStandardCertificate({
                pdfDoc,
                page,
                template,
                themeConfig,
                styles,
                traineeName,
                courseTitle,
                issuedAt,
            });
        }

        const generatedBytes = await pdfDoc.save();
        const filename = `${slugify(traineeName)}-${slugify(courseTitle)}-${Date.now()}.pdf`;
        const objectKey = StorageService.buildObjectKey('certificates/generated', filename);
        await StorageService.uploadBuffer(objectKey, Buffer.from(generatedBytes), 'application/pdf');

        return {
            filename,
            blobUrl: objectKey,
        };
    }
}

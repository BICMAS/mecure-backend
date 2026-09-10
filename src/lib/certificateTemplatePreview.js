export const SAMPLE_CERTIFICATE_PREVIEW = {
    traineeName: 'Macdara Rashawn',
    courseTitle: '2030 Online Course Developer',
};

export function pickTemplatePreviewUrl(template = {}) {
    const candidates = [template.previewUrl, template.url, template.blobUrl];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            return candidate.trim();
        }
    }
    return null;
}

export function isPublicHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function emptyDisplayFields() {
    return {
        description: null,
        title: null,
        theme: null,
        signatory: null,
        signatoryRole: null,
        signatory2: null,
        signatoryRole2: null,
        signatorySignatureBlobUrl: null,
        signatory2SignatureBlobUrl: null,
    };
}

export function parseTemplateDisplayFields(description) {
    const empty = emptyDisplayFields();

    if (typeof description !== 'string' || !description.trim()) {
        return empty;
    }

    const trimmed = description.trim();

    try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
            const theme = parsed.themeConfig && typeof parsed.themeConfig === 'object'
                ? parsed.themeConfig
                : {};
            const note = typeof parsed.internalNote === 'string' ? parsed.internalNote.trim() : '';
            return {
                description: note || null,
                title: theme.title || null,
                theme: theme.theme || null,
                signatory: theme.signatory || null,
                signatoryRole: theme.signatoryRole || null,
                signatory2: theme.signatory2 || null,
                signatoryRole2: theme.signatoryRole2 || null,
                signatorySignatureBlobUrl: theme.signatorySignatureBlobUrl || null,
                signatory2SignatureBlobUrl: theme.signatory2SignatureBlobUrl || null,
            };
        }
    } catch {
        // Fall through to plain-text handling.
    }

    if (trimmed.startsWith('{') && trimmed.includes('themeConfig')) {
        return empty;
    }

    return {
        ...empty,
        description: trimmed,
    };
}

export function formatAssignedTemplateForClient(
    { orgId, hrManagerId, templateId, template } = {},
    previewUrl = null,
    signatureUrls = {},
) {
    const resolvedPreviewUrl = isPublicHttpUrl(previewUrl)
        ? previewUrl.trim()
        : pickTemplatePreviewUrl({
            previewUrl: template?.previewUrl,
            url: template?.url,
        });
    const display = parseTemplateDisplayFields(template?.description);
    const signatorySignatureUrl = isPublicHttpUrl(signatureUrls.signatorySignatureUrl)
        ? signatureUrls.signatorySignatureUrl.trim()
        : null;
    const signatory2SignatureUrl = isPublicHttpUrl(signatureUrls.signatory2SignatureUrl)
        ? signatureUrls.signatory2SignatureUrl.trim()
        : null;

    return {
        orgId: orgId ?? null,
        hrManagerId: hrManagerId ?? null,
        templateId: templateId ?? template?.id ?? null,
        template: template
            ? {
                id: template.id,
                filename: template.filename,
                description: display.description,
                title: display.title,
                theme: display.theme,
                signatory: display.signatory,
                signatoryRole: display.signatoryRole,
                signatory2: display.signatory2,
                signatoryRole2: display.signatoryRole2,
                signatorySignatureUrl,
                signatory2SignatureUrl,
                mimeType: template.mimeType ?? null,
                createdAt: template.createdAt ?? null,
                previewUrl: isPublicHttpUrl(resolvedPreviewUrl) ? resolvedPreviewUrl : null,
                url: isPublicHttpUrl(resolvedPreviewUrl) ? resolvedPreviewUrl : null,
            }
            : null,
    };
}

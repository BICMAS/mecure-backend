/**
 * Unit checks for HR org certificate template preview payloads (no DB required).
 * Run: node scripts/test-certificate-template-preview.js
 */
import assert from 'node:assert/strict';
import {
    pickTemplatePreviewUrl,
    parseTemplateDisplayFields,
    formatAssignedTemplateForClient,
    SAMPLE_CERTIFICATE_PREVIEW,
} from '../src/lib/certificateTemplatePreview.js';

function testPrefersResolvedPreviewUrl() {
    assert.equal(
        pickTemplatePreviewUrl({
            previewUrl: 'https://cdn.example/preview.png',
            url: 'https://cdn.example/url.png',
            blobUrl: 'certificates/templates/key.png',
        }),
        'https://cdn.example/preview.png',
    );
}

function testFallsBackToUrlThenBlob() {
    assert.equal(
        pickTemplatePreviewUrl({
            url: 'https://cdn.example/url.png',
            blobUrl: 'certificates/templates/key.png',
        }),
        'https://cdn.example/url.png',
    );
    assert.equal(
        pickTemplatePreviewUrl({ blobUrl: 'certificates/templates/key.png' }),
        'certificates/templates/key.png',
    );
}

function testFormatsAssignedTemplateWithoutRawStorageKeyWhenPreviewResolved() {
    const payload = formatAssignedTemplateForClient(
        {
            orgId: 'org-1',
            hrManagerId: 'hr-1',
            templateId: 'tpl-1',
            template: {
                id: 'tpl-1',
                filename: 'mecure-logo.png',
                description: 'Org certificate logo',
                mimeType: 'image/png',
                createdAt: '2026-01-01T00:00:00.000Z',
                blobUrl: 'certificates/templates/key.png',
            },
        },
        'https://signed.example/preview.png',
    );

    assert.equal(payload.templateId, 'tpl-1');
    assert.equal(payload.template.id, 'tpl-1');
    assert.equal(payload.template.filename, 'mecure-logo.png');
    assert.equal(payload.template.description, 'Org certificate logo');
    assert.equal(payload.template.previewUrl, 'https://signed.example/preview.png');
    assert.equal(payload.template.url, 'https://signed.example/preview.png');
    assert.equal(payload.template.blobUrl, undefined);
}

function testDoesNotExposeStorageKeyAsPreview() {
    const payload = formatAssignedTemplateForClient({
        templateId: 'tpl-1',
        template: {
            id: 'tpl-1',
            filename: 'logo.png',
            blobUrl: 'certificates/templates/key.png',
        },
    });

    assert.equal(payload.template.previewUrl, null);
    assert.equal(payload.template.url, null);
}

function testParsesSerializedThemeMetadata() {
    const parsed = parseTemplateDisplayFields(JSON.stringify({
        internalNote: '',
        themeConfig: {
            theme: 'mecure',
            title: 'Certificate of Completion',
            signatory: 'Arjun Udandani',
            signatoryRole: 'CEO',
            signatory2: 'Jeff Mogbolu',
            signatoryRole2: 'Project Director',
            signatorySignatureBlobUrl: 'certificates/signatures/secret.png',
        },
    }));

    assert.equal(parsed.description, null);
    assert.equal(parsed.title, 'Certificate of Completion');
    assert.equal(parsed.theme, 'mecure');
    assert.equal(parsed.signatory, 'Arjun Udandani');
    assert.equal(parsed.signatoryRole, 'CEO');
    assert.equal(parsed.signatory2, 'Jeff Mogbolu');
    assert.equal(parsed.signatoryRole2, 'Project Director');
    assert.equal(parsed.signatorySignatureBlobUrl, 'certificates/signatures/secret.png');
}

function testFormatsAssignedTemplateWithoutRawJsonDescription() {
    const payload = formatAssignedTemplateForClient(
        {
            templateId: 'tpl-1',
            template: {
                id: 'tpl-1',
                filename: 'mecure-industries-logo.png',
                description: JSON.stringify({
                    internalNote: '',
                    themeConfig: {
                        theme: 'mecure',
                        title: 'Certificate of Completion',
                        signatory: 'Arjun Udandani',
                    },
                }),
            },
        },
        'https://signed.example/logo.png',
    );

    assert.equal(payload.template.description, null);
    assert.equal(payload.template.title, 'Certificate of Completion');
    assert.equal(payload.template.theme, 'mecure');
    assert.equal(payload.template.signatory, 'Arjun Udandani');
    assert.equal(payload.template.previewUrl, 'https://signed.example/logo.png');
    assert.equal(payload.template.signatorySignatureUrl, null);
    assert.equal(payload.template.signatorySignatureBlobUrl, undefined);
}

function testFormatsAssignedTemplateWithResolvedSignatureUrls() {
    const payload = formatAssignedTemplateForClient(
        {
            templateId: 'tpl-1',
            template: {
                id: 'tpl-1',
                filename: 'mecure-industries-logo.png',
                description: JSON.stringify({
                    internalNote: '',
                    themeConfig: {
                        theme: 'mecure',
                        title: 'Certificate of Completion',
                        signatory: 'Arjun Udandani',
                        signatorySignatureBlobUrl: 'certificates/signatures/secret.png',
                        signatory2SignatureBlobUrl: 'certificates/signatures/other.png',
                    },
                }),
            },
        },
        'https://signed.example/logo.png',
        {
            signatorySignatureUrl: 'https://signed.example/sig1.png',
            signatory2SignatureUrl: 'https://signed.example/sig2.png',
        },
    );

    assert.equal(payload.template.signatorySignatureUrl, 'https://signed.example/sig1.png');
    assert.equal(payload.template.signatory2SignatureUrl, 'https://signed.example/sig2.png');
    assert.equal(payload.template.signatorySignatureBlobUrl, undefined);
    assert.equal(payload.template.description, null);
}

function testIgnoresRawSignatureStorageKeys() {
    const payload = formatAssignedTemplateForClient(
        {
            templateId: 'tpl-1',
            template: {
                id: 'tpl-1',
                filename: 'logo.png',
                description: JSON.stringify({
                    themeConfig: {
                        signatorySignatureBlobUrl: 'certificates/signatures/secret.png',
                    },
                }),
            },
        },
        'certificates/templates/key.png',
        {
            signatorySignatureUrl: 'certificates/signatures/secret.png',
        },
    );

    assert.equal(payload.template.previewUrl, null);
    assert.equal(payload.template.signatorySignatureUrl, null);
}

function testSamplePreviewUsesSuperAdminCopy() {
    assert.equal(SAMPLE_CERTIFICATE_PREVIEW.traineeName, 'Macdara Rashawn');
    assert.equal(SAMPLE_CERTIFICATE_PREVIEW.courseTitle, '2030 Online Course Developer');
}

const tests = [
    testPrefersResolvedPreviewUrl,
    testFallsBackToUrlThenBlob,
    testFormatsAssignedTemplateWithoutRawStorageKeyWhenPreviewResolved,
    testDoesNotExposeStorageKeyAsPreview,
    testParsesSerializedThemeMetadata,
    testFormatsAssignedTemplateWithoutRawJsonDescription,
    testFormatsAssignedTemplateWithResolvedSignatureUrls,
    testIgnoresRawSignatureStorageKeys,
    testSamplePreviewUsesSuperAdminCopy,
];

for (const test of tests) {
    test();
    console.log(`ok ${test.name}`);
}

console.log(`\n${tests.length} certificate template preview tests passed`);

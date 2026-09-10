export const SEED_COURSE_CATEGORIES = [
    { name: 'Onboarding', slug: 'onboarding', sortOrder: 0 },
    { name: 'Safety', slug: 'safety', sortOrder: 1 },
    { name: 'Compliance', slug: 'compliance', sortOrder: 2 },
    { name: 'Clinical', slug: 'clinical', sortOrder: 3 },
    { name: 'Soft Skills', slug: 'soft-skills', sortOrder: 4 },
    { name: 'IT', slug: 'it', sortOrder: 5 },
];

export function normalizeCategoryName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/\s+/g, ' ');
}

export function slugifyCategoryName(name) {
    return normalizeCategoryName(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function parseCategoryCreateInput(body = {}) {
    const name = normalizeCategoryName(body.name);
    if (!name) {
        throw new Error('Category name is required');
    }
    if (name.length > 80) {
        throw new Error('Category name must be 80 characters or fewer');
    }

    const slug = slugifyCategoryName(name);
    if (!slug) {
        throw new Error('Category name must include letters or numbers');
    }

    return { name, slug };
}

export function categorySelect() {
    return {
        id: true,
        name: true,
        slug: true,
        sortOrder: true,
    };
}

export function courseCategoryPublicFields(category) {
    if (!category) return null;

    if (typeof category === 'string') {
        const name = normalizeCategoryName(category);
        if (!name) return null;
        return {
            id: name,
            name,
            slug: slugifyCategoryName(name),
        };
    }

    if (typeof category === 'object' && category.name) {
        const name = normalizeCategoryName(category.name);
        if (!name) return null;
        return {
            id: category.id ?? category.slug ?? name,
            name,
            slug: category.slug ?? slugifyCategoryName(name),
        };
    }

    return null;
}

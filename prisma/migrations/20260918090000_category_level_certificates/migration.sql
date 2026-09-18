-- Topic (category) certificate template + certificates keyed by category

ALTER TABLE "course_categories"
  ADD COLUMN "certificateTemplateId" VARCHAR(25);

CREATE INDEX "course_categories_certificateTemplateId_idx"
  ON "course_categories"("certificateTemplateId");

ALTER TABLE "course_categories"
  ADD CONSTRAINT "course_categories_certificateTemplateId_fkey"
  FOREIGN KEY ("certificateTemplateId") REFERENCES "certificate_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Prefer a course template already used in the category
UPDATE "course_categories" AS cat
SET "certificateTemplateId" = picked.template_id
FROM (
  SELECT DISTINCT ON (c."categoryId")
    c."categoryId" AS category_id,
    c."certificateTemplateId" AS template_id
  FROM "courses" AS c
  WHERE c."categoryId" IS NOT NULL
    AND c."certificateTemplateId" IS NOT NULL
  ORDER BY c."categoryId", c."updatedAt" DESC
) AS picked
WHERE cat.id = picked.category_id
  AND cat."certificateTemplateId" IS NULL;

-- Certificates: add categoryId, make courseId optional, unique per topic
ALTER TABLE "certificates"
  ADD COLUMN "categoryId" VARCHAR(25);

UPDATE "certificates" AS cert
SET "categoryId" = c."categoryId"
FROM "courses" AS c
WHERE cert."courseId" = c.id
  AND c."categoryId" IS NOT NULL;

-- Drop certificates that cannot map to a topic (no longer valid under topic issuance)
DELETE FROM "certificates"
WHERE "categoryId" IS NULL;

-- Keep newest certificate per (userId, categoryId)
DELETE FROM "certificates" AS cert
USING "certificates" AS newer
WHERE cert."userId" = newer."userId"
  AND cert."categoryId" = newer."categoryId"
  AND cert.id <> newer.id
  AND (
    newer."issuedAt" > cert."issuedAt"
    OR (newer."issuedAt" = cert."issuedAt" AND newer.id > cert.id)
  );

ALTER TABLE "certificates"
  ALTER COLUMN "courseId" DROP NOT NULL;

DROP INDEX IF EXISTS "certificates_userId_courseId_key";

ALTER TABLE "certificates"
  DROP CONSTRAINT IF EXISTS "certificates_courseId_fkey";

ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_courseId_fkey"
  FOREIGN KEY ("courseId") REFERENCES "courses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "certificates"
  ALTER COLUMN "categoryId" SET NOT NULL;

ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "course_categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "certificates_userId_categoryId_key"
  ON "certificates"("userId", "categoryId");

CREATE INDEX "certificates_categoryId_idx" ON "certificates"("categoryId");
CREATE INDEX "certificates_courseId_idx" ON "certificates"("courseId");

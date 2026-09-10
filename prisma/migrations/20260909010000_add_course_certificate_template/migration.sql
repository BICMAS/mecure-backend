-- Store the assigned certificate template on the course itself

ALTER TABLE "courses"
  ADD COLUMN "certificateTemplateId" VARCHAR(25);

CREATE INDEX "courses_certificateTemplateId_idx" ON "courses"("certificateTemplateId");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_certificateTemplateId_fkey"
  FOREIGN KEY ("certificateTemplateId") REFERENCES "certificate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from the latest COURSE_TEMPLATE_ASSIGNED audit log per course
UPDATE "courses" AS c
SET "certificateTemplateId" = mapped.template_id
FROM (
  SELECT DISTINCT ON ("targetId")
    "targetId" AS course_id,
    payload->>'templateId' AS template_id
  FROM "audit_logs"
  WHERE "eventType" = 'COURSE_TEMPLATE_ASSIGNED'
    AND "targetType" = 'COURSE'
    AND payload ? 'templateId'
    AND COALESCE(payload->>'templateId', '') <> ''
  ORDER BY "targetId", "createdAt" DESC
) AS mapped
WHERE c.id = mapped.course_id
  AND EXISTS (
    SELECT 1
    FROM "certificate_templates" AS t
    WHERE t.id = mapped.template_id
  );

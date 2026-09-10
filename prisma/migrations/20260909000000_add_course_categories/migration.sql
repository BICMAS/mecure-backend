-- Topic categories for courses (admin-managed labels)

CREATE TABLE "course_categories" (
  "id" VARCHAR(25) NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "course_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "course_categories_name_key" ON "course_categories"("name");
CREATE UNIQUE INDEX "course_categories_slug_key" ON "course_categories"("slug");

INSERT INTO "course_categories" ("id", "name", "slug", "sortOrder", "createdAt")
VALUES
  ('seedcatonboarding0000001', 'Onboarding', 'onboarding', 0, CURRENT_TIMESTAMP),
  ('seedcatsafety00000000001', 'Safety', 'safety', 1, CURRENT_TIMESTAMP),
  ('seedcatcompliance0000001', 'Compliance', 'compliance', 2, CURRENT_TIMESTAMP),
  ('seedcatclinical000000001', 'Clinical', 'clinical', 3, CURRENT_TIMESTAMP),
  ('seedcatsoftskills0000001', 'Soft Skills', 'soft-skills', 4, CURRENT_TIMESTAMP),
  ('seedcatit000000000000001', 'IT', 'it', 5, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

ALTER TABLE "courses"
  ADD COLUMN "categoryId" VARCHAR(25);

CREATE INDEX "courses_categoryId_idx" ON "courses"("categoryId");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "course_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Remap removed department values to SALES, then rebuild Department enum.

UPDATE "users"
SET "department" = 'SALES'
WHERE "department"::text IN (
  'FIELD_SALES_REF',
  'FIELD_TEAM_MANAGER',
  'MEDICAL_REP',
  'MEDICAL_REP_PHARMACIST'
);

CREATE TYPE "Department_new" AS ENUM (
  'HR',
  'SALES',
  'MARKETING',
  'FINANCE',
  'OPERATIONS',
  'IT',
  'CUSTOMER_SUPPORT',
  'LEGAL',
  'ADMINISTRATION'
);

ALTER TABLE "users"
  ALTER COLUMN "department" DROP DEFAULT,
  ALTER COLUMN "department" TYPE "Department_new"
  USING (
    CASE "department"::text
      WHEN 'HR' THEN 'HR'::"Department_new"
      WHEN 'SALES' THEN 'SALES'::"Department_new"
      WHEN 'MARKETING' THEN 'MARKETING'::"Department_new"
      WHEN 'FINANCE' THEN 'FINANCE'::"Department_new"
      WHEN 'OPERATIONS' THEN 'OPERATIONS'::"Department_new"
      WHEN 'IT' THEN 'IT'::"Department_new"
      WHEN 'CUSTOMER_SUPPORT' THEN 'CUSTOMER_SUPPORT'::"Department_new"
      WHEN 'LEGAL' THEN 'LEGAL'::"Department_new"
      WHEN 'ADMINISTRATION' THEN 'ADMINISTRATION'::"Department_new"
      ELSE 'SALES'::"Department_new"
    END
  );

DROP TYPE "Department";
ALTER TYPE "Department_new" RENAME TO "Department";

-- Course lock/unlock (independent of DRAFT/PUBLISHED and module pacing LOCKED)

ALTER TABLE "courses"
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" VARCHAR(25);

CREATE INDEX "courses_isLocked_idx" ON "courses"("isLocked");

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_lockedBy_fkey"
    FOREIGN KEY ("lockedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

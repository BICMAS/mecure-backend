-- AlterTable
ALTER TABLE "scorm_attempts" ADD COLUMN "firstAccessAt" TIMESTAMP(3),
ADD COLUMN "lastAccessAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "registrationCompletion" TEXT,
ADD COLUMN "registrationSuccess" TEXT;

-- CreateTable
CREATE TABLE "scorm_activity_results" (
    "id" VARCHAR(25) NOT NULL,
    "scormAttemptId" VARCHAR(25) NOT NULL,
    "activityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "completion" TEXT,
    "success" TEXT,
    "scorePercent" DOUBLE PRECISION,
    "timeTrackedSeconds" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scorm_activity_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorm_interaction_results" (
    "id" VARCHAR(25) NOT NULL,
    "scormAttemptId" VARCHAR(25) NOT NULL,
    "activityId" TEXT NOT NULL DEFAULT '',
    "interactionId" TEXT NOT NULL,
    "interactionType" TEXT,
    "description" TEXT,
    "learnerResponse" JSONB,
    "correctResponse" JSONB,
    "result" TEXT,
    "weighting" DOUBLE PRECISION,
    "latency" TEXT,

    CONSTRAINT "scorm_interaction_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorm_objective_results" (
    "id" VARCHAR(25) NOT NULL,
    "scormAttemptId" VARCHAR(25) NOT NULL,
    "activityId" TEXT NOT NULL DEFAULT '',
    "objectiveId" TEXT NOT NULL,
    "success" TEXT,
    "completion" TEXT,
    "scorePercent" DOUBLE PRECISION,

    CONSTRAINT "scorm_objective_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorm_learner_comments" (
    "id" VARCHAR(25) NOT NULL,
    "scormAttemptId" VARCHAR(25) NOT NULL,
    "activityId" TEXT NOT NULL DEFAULT '',
    "commentIndex" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "location" TEXT,
    "commentedAt" TIMESTAMP(3),

    CONSTRAINT "scorm_learner_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorm_launches" (
    "id" VARCHAR(25) NOT NULL,
    "scormAttemptId" VARCHAR(25) NOT NULL,
    "externalId" TEXT NOT NULL,
    "launchedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scorm_launches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scorm_activity_results_scormAttemptId_idx" ON "scorm_activity_results"("scormAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "scorm_activity_results_scormAttemptId_activityId_key" ON "scorm_activity_results"("scormAttemptId", "activityId");

-- CreateIndex
CREATE INDEX "scorm_interaction_results_scormAttemptId_idx" ON "scorm_interaction_results"("scormAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "scorm_interaction_results_scormAttemptId_activityId_interactionId_key" ON "scorm_interaction_results"("scormAttemptId", "activityId", "interactionId");

-- CreateIndex
CREATE INDEX "scorm_objective_results_scormAttemptId_idx" ON "scorm_objective_results"("scormAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "scorm_objective_results_scormAttemptId_activityId_objectiveId_key" ON "scorm_objective_results"("scormAttemptId", "activityId", "objectiveId");

-- CreateIndex
CREATE INDEX "scorm_learner_comments_scormAttemptId_idx" ON "scorm_learner_comments"("scormAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "scorm_learner_comments_scormAttemptId_activityId_commentIndex_key" ON "scorm_learner_comments"("scormAttemptId", "activityId", "commentIndex");

-- CreateIndex
CREATE INDEX "scorm_launches_scormAttemptId_idx" ON "scorm_launches"("scormAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "scorm_launches_scormAttemptId_externalId_key" ON "scorm_launches"("scormAttemptId", "externalId");

-- AddForeignKey
ALTER TABLE "scorm_activity_results" ADD CONSTRAINT "scorm_activity_results_scormAttemptId_fkey" FOREIGN KEY ("scormAttemptId") REFERENCES "scorm_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorm_interaction_results" ADD CONSTRAINT "scorm_interaction_results_scormAttemptId_fkey" FOREIGN KEY ("scormAttemptId") REFERENCES "scorm_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorm_objective_results" ADD CONSTRAINT "scorm_objective_results_scormAttemptId_fkey" FOREIGN KEY ("scormAttemptId") REFERENCES "scorm_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorm_learner_comments" ADD CONSTRAINT "scorm_learner_comments_scormAttemptId_fkey" FOREIGN KEY ("scormAttemptId") REFERENCES "scorm_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorm_launches" ADD CONSTRAINT "scorm_launches_scormAttemptId_fkey" FOREIGN KEY ("scormAttemptId") REFERENCES "scorm_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

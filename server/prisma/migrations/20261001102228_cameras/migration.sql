-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "placement" TEXT,
    "ownerId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expectedEveryMinutes" INTEGER NOT NULL DEFAULT 60,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastImageAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraImage" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileHash" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "review" TEXT NOT NULL DEFAULT 'unreviewed',
    "flagNote" TEXT,
    "flaggedById" TEXT,
    "flaggedAt" TIMESTAMP(3),
    "issueId" TEXT,
    "aiStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "CameraImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Camera_keyHash_key" ON "Camera"("keyHash");

-- CreateIndex
CREATE INDEX "Camera_projectId_idx" ON "Camera"("projectId");

-- CreateIndex
CREATE INDEX "CameraImage_cameraId_capturedAt_idx" ON "CameraImage"("cameraId", "capturedAt");

-- CreateIndex
CREATE INDEX "CameraImage_review_idx" ON "CameraImage"("review");

-- CreateIndex
CREATE UNIQUE INDEX "CameraImage_cameraId_fileHash_key" ON "CameraImage"("cameraId", "fileHash");

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraImage" ADD CONSTRAINT "CameraImage_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;

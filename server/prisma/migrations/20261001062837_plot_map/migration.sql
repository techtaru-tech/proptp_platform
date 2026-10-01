-- CreateTable
CREATE TABLE "ProjectMap" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "imageWidth" INTEGER NOT NULL,
    "imageHeight" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "publicToken" TEXT NOT NULL,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlotShape" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "unitId" TEXT,
    "points" JSONB NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlotShape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMap_projectId_key" ON "ProjectMap"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMap_publicToken_key" ON "ProjectMap"("publicToken");

-- CreateIndex
CREATE INDEX "PlotShape_mapId_idx" ON "PlotShape"("mapId");

-- CreateIndex
CREATE UNIQUE INDEX "PlotShape_mapId_unitId_key" ON "PlotShape"("mapId", "unitId");

-- AddForeignKey
ALTER TABLE "ProjectMap" ADD CONSTRAINT "ProjectMap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotShape" ADD CONSTRAINT "PlotShape_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "ProjectMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlotShape" ADD CONSTRAINT "PlotShape_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "PropertyUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

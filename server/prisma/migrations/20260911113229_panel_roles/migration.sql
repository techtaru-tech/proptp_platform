-- AlterTable
ALTER TABLE "User" ADD COLUMN     "panelRoleId" TEXT;

-- CreateTable
CREATE TABLE "PanelRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isFullAccess" BOOLEAN NOT NULL DEFAULT false,
    "modules" JSONB NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanelRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PanelRole_name_key" ON "PanelRole"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_panelRoleId_fkey" FOREIGN KEY ("panelRoleId") REFERENCES "PanelRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The default Sales Pipeline follows the client's lead journey:
--   New, Contacted, Connected, Qualified, Site Visit Planned, Site Visit Done, Negotiation, Booking, Lost / Closed.
-- Only the default pipeline is touched, and only when it still has the original seeded stages, so a
-- pipeline an admin has already reshaped is left exactly as they made it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Pipeline" WHERE id = 'PPL-SALES')
     AND EXISTS (SELECT 1 FROM "PipelineStage" WHERE id = 'STG-SALES-4' AND name = 'Proposal Sent') THEN

    INSERT INTO "PipelineStage" (id, "pipelineId", name, color, "sortOrder", "isWon", "isLost")
    VALUES
      ('STG-SALES-8',  'PPL-SALES', 'Connected',           '#0ea5e9', 3, false, false),
      ('STG-SALES-9',  'PPL-SALES', 'Site Visit Planned',  '#14b8a6', 5, false, false),
      ('STG-SALES-10', 'PPL-SALES', 'Site Visit Done',     '#8b5cf6', 6, false, false)
    ON CONFLICT (id) DO NOTHING;

    -- "Proposal Sent" has no place in the new journey; its leads are negotiating.
    UPDATE "Lead" SET "pipelineStageId" = 'STG-SALES-5' WHERE "pipelineStageId" = 'STG-SALES-4';
    DELETE FROM "PipelineStage" WHERE id = 'STG-SALES-4';

    UPDATE "PipelineStage" SET name = 'New',          "sortOrder" = 1 WHERE id = 'STG-SALES-1';
    UPDATE "PipelineStage" SET                        "sortOrder" = 2 WHERE id = 'STG-SALES-2';
    UPDATE "PipelineStage" SET                        "sortOrder" = 4 WHERE id = 'STG-SALES-3';
    UPDATE "PipelineStage" SET                        "sortOrder" = 7 WHERE id = 'STG-SALES-5';
    UPDATE "PipelineStage" SET name = 'Booking',      "sortOrder" = 8 WHERE id = 'STG-SALES-6';
    UPDATE "PipelineStage" SET name = 'Lost / Closed', "sortOrder" = 9 WHERE id = 'STG-SALES-7';
  END IF;
END $$;

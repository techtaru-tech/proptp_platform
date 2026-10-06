-- A lead's original source is the channel that first earned it. It is set once, whichever code path
-- created the lead (form, webhook, import, WhatsApp, manual), and can never be overwritten, so a
-- later transfer or "source" edit cannot rewrite attribution.
CREATE OR REPLACE FUNCTION lead_original_source() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."originalSource" IS NULL THEN
      NEW."originalSource" := NEW."source";
    END IF;
  ELSIF OLD."originalSource" IS NOT NULL THEN
    NEW."originalSource" := OLD."originalSource";
  ELSIF NEW."originalSource" IS NULL THEN
    NEW."originalSource" := COALESCE(OLD."source", NEW."source");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_original_source_trg ON "Lead";
CREATE TRIGGER lead_original_source_trg
  BEFORE INSERT OR UPDATE ON "Lead"
  FOR EACH ROW EXECUTE FUNCTION lead_original_source();

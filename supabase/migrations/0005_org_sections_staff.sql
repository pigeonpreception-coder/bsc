-- ============================================================
-- Extend org_positions for Section Supervisors and Individual Staff
-- ============================================================

-- Update position_type to include new levels
ALTER TABLE public.org_positions
DROP CONSTRAINT IF EXISTS org_positions_position_type_check;

ALTER TABLE public.org_positions
ADD CONSTRAINT org_positions_position_type_check
CHECK (position_type IN ('board', 'executive', 'non_executive', 'section_supervisor', 'individual_staff'));

-- Update bsc_level to include 'section' level
ALTER TABLE public.org_positions
DROP CONSTRAINT IF EXISTS org_positions_bsc_level_check;

ALTER TABLE public.org_positions
ADD CONSTRAINT org_positions_bsc_level_check
CHECK (bsc_level IN ('corporate', 'executive', 'departmental', 'section', 'individual'));

-- Add section_name column (sections sit inside departments)
ALTER TABLE public.org_positions
ADD COLUMN IF NOT EXISTS section_name text;

-- 072: device_tokens learns whether its token can actually RENDER.
--
-- Aug 19's defect: a device carried an 'enabled' choice and a registered
-- token while iOS had never shown the authorization dialog - APNs mints
-- tokens for unauthorized apps (permission gates display, not issuance), so
-- every layer above reported success while the phone rendered nothing.
-- The register call now carries the client's VERIFIED checkPermissions
-- result; this column stores it. NULL = registered before this existed -
-- unknown, and the launch re-register path overwrites it with the truth
-- within a day of the fix deploying.

ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS permission text;

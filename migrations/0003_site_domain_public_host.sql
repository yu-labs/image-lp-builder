UPDATE site_meta
SET
  domain = 'lp.' || domain,
  updated_at = datetime('now')
WHERE
  domain IS NOT NULL
  AND domain <> ''
  AND lower(domain) NOT LIKE 'lp.%';

INSERT INTO schema_migrations (version) VALUES ('0003_site_domain_public_host');

-- DOWN:
DELETE FROM schema_migrations WHERE version = '0003_site_domain_public_host';
UPDATE site_meta
SET
  domain = substr(domain, 4),
  updated_at = datetime('now')
WHERE
  domain IS NOT NULL
  AND lower(domain) LIKE 'lp.%';

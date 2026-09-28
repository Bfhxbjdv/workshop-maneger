# Cloudflare release runbook

1. Create a D1 backup/export and verify the R2 bucket contains the current objects.
2. From this directory, apply migrations before the Worker deploy:

   `npx wrangler d1 migrations apply workshop-manager-db --remote`

3. Confirm `SESSION_SECRET` is set as a Worker secret and rotate it if it was
   ever stored in a local `.env` or deployment log.
4. Deploy the Worker:

   `npx wrangler deploy`

5. Run the health check and the authenticated workflow smoke tests. Verify the
   public hostname, `robots.txt`, `sitemap.xml`, favicon, and the four role
   dashboards before changing DNS.
6. Keep the previous deployment available until uploads, inventory deduction,
   design revisions, and delivery have been verified in production.

Migration `0004_inventory_audit_and_security.sql` adds the append-only
`Inventory_Movements` ledger. It does not rewrite existing stock quantities.

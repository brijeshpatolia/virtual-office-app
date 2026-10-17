-- Custom SQL migration file, put your code below! --
-- One membership per user and company. Better Auth checks this itself, but not atomically; the generated
-- schema (src/schema/auth.ts) has no place for this index, so it lives in this hand-written migration.
CREATE UNIQUE INDEX "member_organization_id_user_id_idx" ON "member" USING btree ("organization_id","user_id");

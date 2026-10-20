CREATE TABLE "member_removals" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"removed_by" text,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_removals_pkey" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "member_removals" ADD CONSTRAINT "member_removals_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_removals" ADD CONSTRAINT "member_removals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_removals" ADD CONSTRAINT "member_removals_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
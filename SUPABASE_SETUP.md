# Supabase saved dashboards

Cloud saving is optional. Without Supabase settings, CSV upload, analysis, charts, search, and filtering continue to work locally. Shared dashboards are public to anyone who has their UUID link; only share data that is appropriate for public access.

## 1. Create the database objects

In the Supabase project, open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. The SQL enables RLS, blocks direct client access to the table, and exposes only two bounded RPC operations: create a dashboard and read one by its UUID. There are no update or delete permissions.

The create RPC limits each dataset to 10,000 rows, 100 columns, and 1.5 MB of JSON. The table is not directly selectable by the `anon` role; the read RPC returns only the requested UUID. Dashboard IDs are generated using `crypto.randomUUID()` and act as unguessable share links.

Because this MVP has no authentication, the create RPC is callable by anyone with the public project key. Per-dashboard size limits reduce storage abuse, but they do not rate-limit requests. Add authentication or a rate-limited server-side save endpoint before opening this to unrestricted public traffic. There is currently no delete/manage-dashboards UI.

## 2. Configure the frontend

Copy `.env.example` to `.env.local`, then set:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

For older projects, `VITE_SUPABASE_ANON_KEY` may be used instead of the publishable-key variable. Restart Vite after changing environment variables.

The publishable/anon key is intended for browser use and is constrained by database permissions. **Never put a Supabase service-role or secret key in a `VITE_` variable or frontend file.**

## 3. Save and open links

With the SQL installed and environment configured, upload a CSV and choose **Save & share**. The app stores the dataset rows and headers as JSON in PostgreSQL, copies a URL containing its dashboard UUID, and also displays the URL for manual copying. Opening that URL loads the saved dataset and recomputes its column analysis and charts in the browser.

Datasets over the row, column, or JSON-size limit remain usable locally but cannot be saved. Keep project values in the ignored `.env.local` file; do not commit them. The configured project responded to an RPC probe, but `get_shared_dashboard` was not in its schema cache, so cloud save/share still needs the SQL below to be applied and then tested against that project.

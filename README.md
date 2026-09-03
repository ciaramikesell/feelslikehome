# Feels Like Home — Setup Guide

This guide assumes you are using a **locked-down Windows computer with nothing installed** —
no Node.js, no Git, no VS Code, no command-line tools. Everything below happens inside a
web browser, using four websites:

- **GitHub** (github.com) — stores your code
- **GitHub Codespaces** (opens from inside GitHub) — your development environment, running in
  the browser, instead of anything on your computer
- **Supabase** (supabase.com) — your database and login system
- **Vercel** (vercel.com) — hosts the finished website

You do not need to install anything. Wherever a command needs to be typed, this guide tells
you it goes in the **Terminal inside GitHub Codespaces** — a black text panel inside your
browser tab, not anything on your Windows computer.

Work through this guide **in order**. Each part tells you which website to be on.

---

## Before you start

1. Make sure you have (or create, they're all free to start):
   - A **GitHub** account — [github.com](https://github.com)
   - A **Supabase** account — [supabase.com](https://supabase.com)
   - A **Vercel** account — [vercel.com](https://vercel.com) (you can sign up using your GitHub
     account, which makes Part 5 easier)
2. Unzip the file I gave you. Right-click the downloaded `.zip` file in **Windows File
   Explorer** and choose **Extract All**. This is a built-in Windows feature — it does not
   install anything. You'll end up with a folder called `feels-like-home` containing all the
   project's files. Keep that folder open in a File Explorer window — you'll drag files out of
   it in Part 1.

---

## PART 1 — Get the code onto GitHub

### IN GITHUB:

1. Go to [github.com](https://github.com) and sign in.
2. Click the **+** icon in the top-right corner → **New repository**.
3. Name it `feels-like-home` (or anything you like).
4. Leave it set to **Private** (recommended) or **Public** — your choice.
5. **Do not** check any of the boxes to add a README, .gitignore, or license — leave the
   repository completely empty. Click **Create repository**.
6. On the new (empty) repository's page, click the green **Code** button.
7. In the panel that opens, click the **Codespaces** tab.
8. Click **Create codespace on main**.

This will take a minute or two the first time — GitHub is building a small cloud computer for
you. When it's done, you'll see what looks like VS Code, running inside your browser tab. This
*is* your development environment for the rest of this project — nothing is installed on your
Windows computer.

### IN GITHUB CODESPACES:

9. On the left side, find the **Explorer** panel (usually the top icon in the far-left sidebar
   — looks like two stacked pages).
10. Arrange your windows so you can see both the Codespaces browser tab and your Windows File
    Explorer window (with the extracted `feels-like-home` folder) at the same time.
11. Open the extracted `feels-like-home` folder in File Explorer, select **all the files and
    folders inside it** (not the outer folder itself — the things *inside* it, like `src`,
    `public`, `package.json`, etc.), and **drag them into the Explorer panel** in your
    Codespaces browser tab.
12. Wait for the upload to finish — you'll see the same file structure appear in the Explorer
    panel that you have in Windows.
13. Open the Terminal: click **Terminal** in the top menu bar → **New Terminal**. A black text
    panel opens at the bottom.
14. In that Terminal, type the following and press Enter:

    ```
    npm install
    ```

    This downloads everything the project needs. It can take a minute or two — you'll see text
    scrolling. When it's done, you're back at a plain prompt.
15. Open the **Source Control** panel on the left sidebar (the icon that looks like a branching
    line).
16. You should see a list of all the files you dragged in, ready to be committed. Type a short
    message in the box at the top, like `Initial upload`, then click the **Commit** button (or
    the checkmark icon).
17. Click **Sync Changes** (or **Push**) to send everything up to GitHub.

Your code is now on GitHub. Leave this Codespace open — you'll come back to it in Part 3.

---

## PART 2 — Set up Supabase (your database and login system)

### IN SUPABASE:

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Give it a name (e.g. `feels-like-home`), choose a database password (Supabase will generate
   one for you — save it somewhere, though you won't need it directly for this setup), pick a
   region close to you, and click **Create new project**. This takes a minute or two to
   provision.
4. Once the project is ready, open the **SQL Editor** from the left sidebar.
5. Click **New query**.
6. Open the file `supabase/schema.sql` from the project folder (in Windows File Explorer, or
   inside your Codespace's Explorer panel — either works, you just need to copy its contents).
   Select all the text in that file and copy it.
7. Paste the entire contents into the Supabase SQL Editor.
8. Click **Run** (or press Ctrl+Enter). You should see a success message. This creates your
   tables (`profiles`, `searches`, `homes`), turns on Row Level Security so each user can only
   see their own data, and sets up the automatic "create a profile and a default search when
   someone signs up" behavior.
9. In the left sidebar, go to **Authentication** → **Sign In / Providers** (or **Providers**)
   and confirm **Email** is enabled (it is by default).
10. Still in **Authentication**, decide on **email confirmation**: under **Authentication** →
    **Sign In / Providers** → **Email**, there's a toggle for **Confirm email**. If it's ON, new
    users must click a link in their email before they can sign in. If it's OFF, signup signs
    them in immediately. Either works with this app — I built it to handle both — but toggling
    it OFF is simplest while you're first testing.
11. Now get your API credentials: go to **Project Settings** (gear icon, bottom of the left
    sidebar) → **API Keys**.
    - Copy the **Project URL** (also visible via the **Connect** button on your project's main
      page) — this is your `NEXT_PUBLIC_SUPABASE_URL`.
    - Click the **Publishable and secret API keys** tab. If you see a **Create new API keys**
      button, click it once (safe — it doesn't affect anything). Copy the value under
      **Publishable key** (starts with `sb_publishable_...`) — this is your
      `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
    - You will **not** need the "secret key" anywhere in this project — this app is built to
      only ever use the publishable key, so it never bypasses your Row Level Security rules.

Keep this browser tab open — you'll copy these two values into Codespaces next.

---

## PART 3 — Connect Codespaces to Supabase and test it

### BACK IN GITHUB CODESPACES:

1. In the Explorer panel, right-click in an empty area at the top level of the file list →
   **New File**.
2. Name it exactly `.env.local` (with the leading dot).
3. Open it and paste this in, replacing the placeholder values with the two you copied from
   Supabase:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. Save the file (Ctrl+S). This file is already listed in `.gitignore`, so it will never be
   uploaded to GitHub — that's intentional, since it holds project-specific values.
5. In the Terminal, type:

   ```
   npm run dev
   ```

   A message will appear saying the app is running, and a small popup should appear in the
   bottom-right of the browser saying a port has been forwarded, with an **Open in Browser**
   button. Click it (or open the **Ports** tab next to the Terminal and click the globe icon
   next to port 3000).
6. You should land on the sign-in page, styled like the app. Try **Start your home search** to
   create a test account. If email confirmation is off (Part 2, step 10), you should land
   straight in onboarding. If it's on, check the inbox for the address you used.
7. When you're done testing, click back in the Terminal and press **Ctrl+C** to stop the dev
   server.

If something doesn't work here, this is the moment to send me what you're seeing — a
screenshot of any error is very helpful.

---

## PART 4 — Push the finished setup back to GitHub

### IN GITHUB CODESPACES:

1. Open the **Source Control** panel again.
2. You likely won't see `.env.local` in the list (correctly ignored). If everything else looks
   the same as before, there's nothing new to push — that's fine, it means Part 1 already got
   everything up. If you made any other edits, commit and push them the same way as in Part 1.

---

## PART 5 — Deploy to Vercel

### IN VERCEL:

1. Go to [vercel.com](https://vercel.com) and sign in (using your GitHub account makes the next
   step automatic).
2. Click **Add New...** → **Project** (or **New Project** from the dashboard).
3. Find your `feels-like-home` repository in the list and click **Import**. (If you don't see
   it, click **Adjust GitHub App Permissions** and grant Vercel access to the repository.)
4. Vercel should auto-detect **Next.js** as the framework — leave that as is.
5. Expand **Environment Variables** and add the same two values from Part 2:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. Click **Deploy**. This takes a minute or two.
7. When it finishes, Vercel gives you a live URL (something like
   `feels-like-home-yourname.vercel.app`). Click it to see your real, live site.

---

## PART 6 — One last Supabase setting (important — don't skip)

### IN SUPABASE:

1. Go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to your real Vercel URL from Part 5 (e.g.
   `https://feels-like-home-yourname.vercel.app`).
3. Under **Redirect URLs**, add:
   ```
   https://feels-like-home-yourname.vercel.app/auth/callback
   ```
   (using your actual Vercel URL). This is what lets password-reset and confirmation emails
   correctly send people back to your real site instead of failing.

Without this step, sign-up confirmation links and password reset links will not work correctly
on your live site — only locally. This is the single most common thing people forget when
moving from testing to a real deployment, so it's worth double-checking.

---

## Everyday use after this

- To make future code changes: reopen your Codespace from the repository's **Code → Codespaces**
  tab, edit files, then commit and push from **Source Control** — Vercel automatically redeploys
  every time you push to the `main` branch.
- To check on your database or users: **Supabase → Table Editor** or **Authentication → Users**.
- To check on your live deployments: **Vercel → your project → Deployments**.

## What's in this project, if you're curious

- `src/app/` — every page and route (Next.js App Router)
- `src/components/` — the actual UI, ported from the Feels Like Home design
- `src/lib/constants.js` and `src/lib/matching.js` — all the preference categories and the
  match-scoring logic, unchanged from the original design
- `src/lib/supabase/` — the three files that replace the old Claude Artifact storage with real
  Supabase reads/writes
- `supabase/schema.sql` — your entire database structure and security rules, in one file

## A note on what to expect

I built and syntax-checked every file in this project, and verified every internal import
actually points at a real file with the right exported name — but I don't have the ability to
actually run `npm install` or connect to a live Supabase project from where I'm working. The
first real end-to-end test happens when *you* run Part 3. If anything errors out, that's
expected to be possible on a first pass of a project this size — send me the exact error text
or a screenshot, and I'll fix it.

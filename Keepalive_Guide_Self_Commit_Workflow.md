# Step-by-Step: Add the Keepalive Guide + Self-Commit Workflow

Two files. About 4 minutes total. Follow along exactly.

---

## PART A — Add `KEEPALIVE-GUIDE.md` (the documentation file)

### Step 1
Open your repo on GitHub:

https://github.com/cleefordtayaban6-ctrl/uecfi-area4

### Step 2
Near the top right of the file list, click the **Add file** button → choose **Create new file**.

### Step 3
In the filename box (top of the page), type exactly:

```text
KEEPALIVE-GUIDE.md
```

Just that — no folders, no slashes.

### Step 4
Click into the big content area. **Select all** the placeholder text (if any) and delete it, then **paste the entire guide** you were given previously.

### Step 5
Scroll to the bottom. In the **Commit new file** box, type:

```text
Add keepalive guide
```

### Step 6
Click the green **Commit new file** button.

✅ Done. You should now see `KEEPALIVE-GUIDE.md` in your repo's file list.

---

## PART B — Add `keepalive-self-commit.yml` (auto-fixes the 60-day rule)

### Step 7
On the repo main page, click **Add file** → **Create new file** again.

### Step 8
In the filename box, type exactly:

```text
.github/workflows/keepalive-self-commit.yml
```

Type the slashes — GitHub creates the folders automatically. Since `.github/workflows/` already exists, it'll just drop the new file inside it.

### Step 9
Paste this entire content into the editor:

```yaml
name: Keep workflow active

on:
  schedule:
    - cron: '0 0 1 * *'
  workflow_dispatch:

jobs:
  touch:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
      - name: Create empty commit to reset the 60-day timer
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit --allow-empty -m "chore: keepalive touch $(date -u +%Y-%m-%d)"
          git push
```

### Step 10
Scroll down. Commit message:

```text
Add self-commit workflow to prevent Actions auto-disable
```

### Step 11
Click **Commit new file**.

---

## PART C — Enable write permissions (REQUIRED, once)

The self-commit workflow needs permission to push back to your repo. If you skip this, it may fail with `403`.

### Step 12
Repo → **Settings** tab (top of the page).

### Step 13
Left sidebar → scroll to **Actions** → **General**.

### Step 14
Scroll to the bottom section: **Workflow permissions**.

### Step 15
Select:

```text
◉ Read and write permissions
```

### Step 16
Click **Save**.

---

## PART D — Test it

### Step 17
Go to the **Actions** tab. You should now see **TWO** workflows in the left sidebar:

- **Supabase keepalive** (your original one)
- **Keep workflow active** (the new one)

### Step 18
Click **Keep workflow active** in the sidebar.

### Step 19
On the right, click the **Run workflow** dropdown → click the green **Run workflow** button.

### Step 20
Refresh the page after about 20 seconds. You're looking for:

- A new run appears with a **green checkmark ✅**.
- Click into it → you should see a commit titled something like `chore: keepalive touch 2026-10-05` was pushed.

### Step 21
Verify the commit landed: go back to the **Code** tab of your repo. You should see the latest commit is from **github-actions[bot]**.

---

## What you've now automated

| Timer | What could go wrong | Now handled by |
|---|---|---|
| Supabase 7-day pause | Project stops working | `keepalive.yml` (every 3 days) |
| GitHub 60-day disable | Workflow stops firing | `keepalive-self-commit.yml` (1st of every month) |

You should never have to touch either one again. The keepalive will keep itself alive.

---

## Your final workflow list

Your `.github/workflows/` folder now contains:

```text
.github/workflows/
├── keepalive.yml                ← pings Supabase every 3 days
└── keepalive-self-commit.yml    ← commits every month to prevent auto-disable
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| **Keep workflow active** doesn't appear in Actions sidebar after about 1 minute | The YAML file has a syntax error or is in the wrong folder. Confirm the path is exactly `.github/workflows/keepalive-self-commit.yml`. |
| Self-commit run fails with `403 Forbidden` | You skipped Part C. Go to Settings → Actions → General → Workflow permissions → **Read and write**. |
| Self-commit run fails with `nothing to commit` | Add `--allow-empty` to the git commit command (already included above). |
| Self-commit run fails with `detached HEAD` | Add `git pull --rebase` before commit — but with `actions/checkout@v4` on a normal branch this shouldn't happen. |
| Both workflows run but you still worry | Open Actions once a month. If either shows a yellow **disabled** banner, click **Enable workflow**. |

---

## Final Check

Once Step 20 shows a green check, your setup is working. The workflow will run automatically according to its schedule.

You only need to open Supabase or GitHub again if you want to add features or troubleshoot the setup.

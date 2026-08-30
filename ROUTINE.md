# The daily board refresh

The Scriptable widget reads Supabase directly and is live the moment a scrape
finishes. The **Term Board artifact** cannot be: an Artifact runs under a
content-security policy that blocks every outbound request, so it can't fetch
its own data. It has to be regenerated and republished.

That's what this routine does. It has to be created from the **claude.ai
Routines UI** rather than in code, because a routine needs the Google Drive
connector attached and only the UI can grant that.

## Setting it up

1. Make sure the rclone step in [SETUP-WINDOWS.md](SETUP-WINDOWS.md) §6 is done,
   so `term-board.html` actually lands in Drive each morning.
2. Go to claude.ai → Routines → New.
3. Schedule: **daily at 8:00 AM Mountain** — an hour or two after the scrape, so
   a laptop that woke late still has time.
4. Attach the **Google Drive** connector.
5. Paste the prompt below.

## The prompt

```
Refresh my Term Board artifact from last night's Learning Suite scrape.

BACKGROUND
A scraper runs each morning on my Windows laptop (project: term-board/ in the
iamrichardmaier-sudo/benarabic repo). It scrapes BYU Learning Suite for my eight
Fall 2026 courses, publishes to a private Supabase table, renders the board HTML,
and copies two files into a Google Drive folder named "Term Board":
  - term-board.html — the fully rendered board, ready to publish as-is
  - latest.json — the snapshot it was rendered from

The Term Board is an Artifact at:
  https://claude.ai/code/artifact/5a6e40c4-1795-4f6e-8faf-893ab37117f5
Artifacts cannot fetch their own data, which is why it has to be republished
rather than polling.

WHAT TO DO
1. Search Google Drive for term-board.html in the "Term Board" folder. Check its
   modifiedTime.
2. If it is missing, or older than about 36 hours, STOP. Do not republish. Tell
   me the scrape hasn't landed — most likely the laptop was off, or Duo needs
   re-authorising (I'd have seen a Windows notification; the fix is
   `npm run login` on the Lenovo). Never guess at or fabricate board data.
3. If it is fresh: read the file, then read the current artifact (Artifact action
   "read" with that url — a publish is refused otherwise), then publish the Drive
   version to that same artifact URL. Do not pass a favicon; it keeps the one it
   has. Keep the title "Term Board".
4. Skim latest.json for anything worth a one-line mention: newly posted grades, a
   course that just became published (six of the eight had no syllabus at term
   start), assignments flagged as having no clean extractable text, or entries in
   `warnings`.

REPLY
One short paragraph: what changed since yesterday — grades that moved, new
assignments, newly published courses — and anything flagged. If nothing changed,
say so in one line. Don't restate the whole board.
```

## If you'd rather not schedule it

Nothing breaks. The widget stays current on its own, and you can refresh the
board any time by asking Claude:

> Refresh my Term Board from the term-board.html in my Drive.

The routine only saves you from having to remember.

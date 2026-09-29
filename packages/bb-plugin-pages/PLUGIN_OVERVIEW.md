Write documents together with your agents. Pages is a Notion-style editor
inside BB where you, your agents, and your Bot Teams bots edit the same page
live.

## What you get

- **A block editor.** Type `/` for headings, checklists, tables, images,
  callouts, charts, stat rows, and embeds of links, threads, and other pages.
- **Live collaboration.** Agents' edits stream into the page, with cursors,
  while you keep typing.
- **Comments.** Comment on any text, reply, and resolve threads.
- **Bots that do the work.** @mention a Bot Teams bot in a page or a comment
  and it edits the page and replies. Give a page an owner bot and a schedule,
  and it keeps the page up to date.
- **A page tree.** Pages per project plus global pages, nested to any depth,
  with version history you can restore from.

## How it works

Pages are stored in this plugin's database on the BB server. Bot requests run
in each bot's own Bot Teams thread. Pages works without Bot Teams, but you
need it for the bot features.

## For agents

Agents read pages as Markdown and make small edits by block id, so they never
overwrite what you are typing. They can also create pages and work in comment
threads. The bundled skill documents the tools, the chart and stats formats,
and the `bb pages` command.

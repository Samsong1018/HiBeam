## Inspiration
The age old IT problem. HR asks for a dashboard pulling from 30 different sources, none of which are remotely in the same place. Or it's your own finances and you wish your Excel sheet could just update itself. Whatever it is, everyone's thought "I wish I could have a dashboard for this right now," and that's the problem HiBeam looks to solve.

## What it does
HiBeam lets you build a dashboard by dragging widgets onto a grid and hooking them up to your data. It can read from REST APIs, JSON, MySQL, scraped web pages, server logs, and Excel or CSV uploads. Everything gets fetched server-side, so your credentials never reach the browser.

You don't have to build it yourself either. Generate reads your data and lays out a first draft for you, and the built in MCP server lets you make a whole dashboard from a single prompt to Kiro or other models. The agent connects the sources, builds the board, then looks at it and fixes what reads badly.

You can share boards with a public link or export them as a PNG, PDF, or a JSON layout someone else can import. If a source stops reporting the widget fades out into a little ghost, so a dead server actually looks dead.

We built two apps on top of it without changing the core code, a live homelab status page and a monthly budget report from one spreadsheet. Kiro built both boards, one prompt each.

## How we built it
Express backend with MySQL and a plain html/css/js frontend, no build step. We used Kiro's specs for the bigger features (auth, the dashboard generator, the budget import) and turned each property in a spec into a property-based test.

Most of our hooks came from something breaking. One blocks force-pushes and destructive SQL, one runs a syntax check on save, and one checks the frontend still matches an API route when that route changes. We also set up steering docs and a few custom agents for security and frontend review, and packaged the MCP server as a Kiro power at the end.

## Challenges we ran into
The worst one was the editor loading dashboards wrong, so every saved board opened empty and then autosave wrote over the real one. A single stray quote also took down the whole home page, and no test caught it because nothing loaded that file. We also found out our secret scanning workflow had bad indentation, so it wasn't scanning anything.

Near the end we ran low on Kiro credits, so a lot of the last features got done by hand.

## Accomplishments that we're proud of
This was all of our first hackathon so I think we're all proud to have just worked together and completed something for this challenge. We're also pretty happy that Kiro can build a full board from one prompt.

## What we learned
None of us had done property-based testing before. One of those tests found an input that crashed our error handler, which our normal tests missed. We also learned it's worth setting up steering early, Kiro stopped reaching for frameworks we weren't using once we did.

## What's next for HiBeam
Currently the agent builds a board without ever seeing it. We plan on adding screenshot tools to the MCP server so it can look at what it made and fix it. We also want to publish the HiBeam power so anyone can install it from Kiro.

# usage-meter

A Claude Code mod that puts your usage above the prompt, in the terminal and the desktop app:

```
context ▰▰▰▱▱▱ 42%  5h ▰▰▰▰▰▱ 85% ↻ 2h 5m  7d ▰▰▱▱▱▱ 31%  $1.23
```

- **context**: how full the context window is
- **5h / 7d**: your subscription's rate-limit windows, with time until each resets (only on a subscription, after the first response)
- **cost**: what the session has cost so far

Meters turn amber at 80% and red at 95%. Countdowns update every minute; a window past its reset shows 0%. `/clear` hides the band until the new conversation's first response.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install usage-meter --marketplace jacobyoby/claude-usage-meter
```

Answer `y` to add the marketplace, then pick a scope (user scope makes it load everywhere, including the desktop app's Code tab).

From a shell:

```bash
claude plugin install usage-meter --marketplace jacobyoby/claude-usage-meter
```

In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** with `jacobyoby/claude-usage-meter`, then **Add plugin**.

## Develop

```bash
claude plugin validate .
claude plugin test .
```

Mods are an early-access Claude Code feature; the API may change between releases.

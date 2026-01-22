# @oomfware/cgr

ask questions about any git repository using Claude Code.

```sh
pnpm install -g @oomfware/cgr
```

## usage

```sh
# ask a question about a repository
cgr ask github.com/facebook/react "How do hooks track dependencies to avoid stale closures?"

# specify a model (default: haiku)
cgr ask -m sonnet github.com/shadcn-ui/ui "How does the registry system resolve component dependencies?"

# checkout a specific branch
cgr ask github.com/vercel/next.js#canary "Where is dynamic route resolution handled in the app router?"

# ask about multiple repositories at once
cgr ask github.com/facebook/react -w github.com/vercel/next.js "How does Next.js integrate with React's server components?"

# works with any git host
cgr ask tangled.sh/mary.my.id/atcute "How do I validate AT Protocol lexicon schemas at runtime?"
```

repositories are cached locally at `~/.cache/cgr/repos/<host>/<owner>/<repo>`. use `cgr clean` to
manage the cache:

```sh
# list cached repos with sizes
cgr clean

# remove a specific repo
cgr clean github.com/facebook/react

# remove all cached repos
cgr clean --all
```

## commands

```
cgr ask [-m opus|sonnet|haiku] [-w repo ...] <repo>[#branch] <question>
cgr clean [--all | <repo>]
```

| command | description                                                       |
| ------- | ----------------------------------------------------------------- |
| `ask`   | clone/update a repository and ask Claude Code a question about it |
| `clean` | remove cached repositories                                        |

## configuring CLAUDE.md

add this to your `~/.claude/CLAUDE.md` or project's `CLAUDE.md` to let Claude Code know about cgr:

```markdown
## cgr

Use `npx @oomfware/cgr ask <repo> <question>` to ask questions about external repositories.

- `npx @oomfware/cgr ask github.com/facebook/react "How do hooks track dependencies to avoid stale closures in useEffect?"`
- `npx @oomfware/cgr ask github.com/vercel/next.js#canary "Where is dynamic route resolution handled in the app router?"`
- `npx @oomfware/cgr ask -m sonnet github.com/shadcn-ui/ui "How do I configure path aliases so components install to the right location?"`
- `npx @oomfware/cgr ask github.com/facebook/react -w github.com/vercel/next.js "How does Next.js integrate with React's server components?"`

cgr works best with detailed questions. Include file/folder paths when you know them, and reference
details from previous answers in follow-ups.

Run `npx @oomfware/cgr --help` for more options.
```

alternatively, a more structured prompt:

```markdown
# cgr

You can use `@oomfware/cgr` to ask questions about external repositories.

    npx @oomfware/cgr ask [options] <repo>[#branch] <question>

    options:
      -m, --model <model>   model to use: opus, sonnet, haiku (default: haiku)
      -w, --with <repo>     additional repository to include (can be repeated)

Useful repositories:

- `github.com/facebook/react` for React internals, hooks, reconciler
- `github.com/vercel/next.js` for Next.js app router, server components
- `github.com/shadcn-ui/ui` for shadcn component patterns, registry system
- `github.com/tailwindlabs/tailwindcss` for Tailwind internals, plugin API
- `github.com/bluesky-social/atproto` for AT Protocol, Bluesky API

cgr works best with detailed questions. Include file/folder paths when you know them, and reference
details from previous answers in follow-ups.

Run `npx @oomfware/cgr --help` for more options.
```

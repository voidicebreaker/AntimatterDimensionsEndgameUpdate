# Antimatter Dimensions

The GitHub Pages address for this fork is
[voidicebreaker.github.io/AntimatterDimensionsEndgameUpdate](https://voidicebreaker.github.io/AntimatterDimensionsEndgameUpdate/).

## GitHub Pages deployment

In this repository's **Settings → Pages → Build and deployment**, set **Source**
to **GitHub Actions**. The **Deploy master** workflow builds `master`, uploads
`dist`, and publishes it directly to Pages. It runs on pushes to `master`, or
manually through **Actions → Deploy master → Run workflow → master**.

The workflow succeeds only after the Pages deployment completes; its
`github-pages` environment links to the published site. To check which source
commit is live, open [commit.json](https://voidicebreaker.github.io/AntimatterDimensionsEndgameUpdate/commit.json)
and compare `sha` with the commit used by the workflow.

The old workflow only pushed build output to `gh-pages`. Pushes made using
`GITHUB_TOKEN` do not trigger a separate Pages build, so that workflow could
succeed without publishing the site. The current workflow uses GitHub's Pages
artifact and deployment actions instead.

The upstream site at `supersonic-seven.github.io` is maintained separately and
does not receive this fork's changes.

## Run

To run the game locally, you will need to install
[Node.js](https://nodejs.org/) (LTS suggested).

First, run the following command in your terminal (or command line) while being
inside the checked out repository:

```
npm ci
```

After all the packages are installed, start up the game:

```
npm run serve
```

This will make the game served via your localhost, and the playable link will
be displayed in your terminal. The server **doesn't** need to be restarted
after you've made changes - just reload the page. The server **can**
occasionally crash, so check your terminal from time to time and run `serve`
again if needed.

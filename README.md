# Antimatter Dimensions

This fork is hosted by [Nexus](https://github.com/voidicebreaker/Nexus) at
[mindovermatter.space/antimatter/](https://mindovermatter.space/antimatter/).

## Publish through Nexus

Nexus serves a generated copy of the game from its `antimatter/` directory.
Merging or building this repository does not update that copy automatically.

Keep this checkout beside the Nexus checkout, update this checkout to the
desired source commit, then run from Nexus:

```sh
bash scripts/build-antimatter.sh ../AntimatterDimensionsEndgameUpdate
python3 -m http.server 8081
```

Check `http://localhost:8081/antimatter/`, then commit the generated `antimatter/`
files and push to Nexus's `main` branch. Nexus's existing Pages deployment
publishes the update alongside its other content. The game repository does
not need its own Pages site.

The **Build master** workflow creates a production build artifact on pushes to
`master` or when run manually. Its success confirms the build, not publication
on Nexus. It uses the same production flags as Nexus's build script.

To identify the source revision on the live site, open
[commit.json](https://mindovermatter.space/antimatter/commit.json) and inspect
`sha`. Nexus also records that revision in `antimatter/commit.json`.

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

# Architecture decision records of the web UI

Decisions about the UI itself: how it is built, shipped and talks to the server. Decisions
about the server and the API contract live in
[lajstrom/lajstrom docs/adr](https://github.com/lajstrom/lajstrom/tree/main/docs/adr); the
format is the same (a trimmed-down MADR, see the template there).

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-web-ui-in-its-own-repository.md) | The web UI lives in its own repository and ships as its own images | proposed |
| [0002](0002-stay-on-react.md) | The UI stays a React and TypeScript app built with npm | accepted |
| [0003](0003-changes-realistic-by-default.md) | Changes are realistic by default and optimistic where it is safe | proposed |
| [0004](0004-one-image-profile-at-start.md) | One image for every environment, its profile chosen at start | accepted |

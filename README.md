# Youtopia

Youtopia is a personal fork of YouTube Music Desktop App.

The goal of this fork is to keep YouTube Music's search, explore, library, queue, and playlist workflows intact while adding a more personal desktop-player experience around it.

## Current Direction

- Larger main music workspace.
- Selectable top bar layouts.
- Selectable player layouts.
- Mini-player behavior on close or minimize.
- Native player polish for personal use.

See [the personal player redesign spec](docs/superpowers/specs/2026-06-17-personal-player-redesign-design.md) for the approved direction.

## Developing

This project uses Yarn 4, Electron Forge, Vite, Vue, and TypeScript.

```sh
corepack enable
yarn install
yarn start
```

## Building

```sh
yarn make
```

Linux builds require the usual packaging tools for the target format:

- Debian/Ubuntu packages: `fakeroot` and `dpkg`
- Fedora/RedHat packages: `rpm` or `rpm-build`

## Repository

<https://github.com/ruca-radio/youtopia>

## License

GPL-3.0-only.

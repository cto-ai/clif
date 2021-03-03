# clif

> Command-line Interface Framework

## ⚠️ Status - WIP

This is a release candidate, we do not recommmend using this framework just yet.

## 🗒 About

This is a framework for building multi-level command CLIs in Node.js.

## ✨ Features

* **Flag declaration and parsing** - As standard.
* **Positionals declaration and parsing** - Leaf node commands can define positionals as inputs
* **No compiling** - this is a runtime CLI framework
* **High speed** - Since it's a very small runtime framework the `clif` is low overhead in both production and development scenarios
* **Pattern-based declarative flow** - Commands are implemented with (async) generator functions that yield pattern objects. This allows for rapid initial CLI development while patterns can continually specialize over time.

## 📖 Documentation

* Coming soon

## 🏍 Engines

* Node 12.4+
* Node 14.0+

## 💻 Development

Test:

```sh
npm test
```

Visual coverage report (run after test):

```sh
npm run cov
```

Lint:

```sh
npm run lint
```

Autoformat:

```sh
npm run lint -- --fix
```


## 📜 License

MIT

## 🌶 Acknowledgements

Sponsored by [CTO.ai](https://cto.ai/)
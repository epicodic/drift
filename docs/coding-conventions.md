# Coding Conventions

These conventions apply to Drift, a KDE Plasma 6 / KWin addon.

## TypeScript

Use 4 spaces, semicolons, single quotes, trailing commas where supported, and a 120-character line limit.
Use `PascalCase` for types, classes, and interfaces.
Use `camelCase` for functions, methods, parameters, and variables.
Use `camelCase` with TypeScript's `private` modifier for private members.
Use `UPPER_SNAKE_CASE` for module-level immutable constants.
Use lowercase kebab-case filenames and explicit imports.
Avoid default exports in shared modules.
Enable strict TypeScript checking.
Prefer `type` for unions and composed data shapes, and `interface` for extensible object contracts and class-facing APIs.
Keep KWin API access in adapter modules and keep core logic independent of KWin globals.

## JavaScript

Use 4 spaces, semicolons, single quotes, trailing commas where supported, and a 120-character line limit.
Use `PascalCase` for classes and constructor-like components.
Use `camelCase` for functions, methods, parameters, and local variables.
Use `UPPER_SNAKE_CASE` for module-level immutable constants.
Prefer `const` and use `let` only when reassignment is required.
Use lowercase kebab-case filenames and explicit module boundaries.
Avoid global mutable state.
Keep KWin API access in `kwin/` adapter modules.
Prefer small pure functions for layout and coordinate calculations.
Use ECMAScript syntax supported by the KWin 6 / Plasma 6 runtime.

## QML

Use 4 spaces, same-line braces, one property or handler per line, and a 120-character line limit.
Use `PascalCase` for QML component types and component filenames.
Use `lowerCamelCase` for properties, signals, IDs, and functions.
Use Qt's `onSignalName` form for signal handlers.
Keep embedded JavaScript expressions short.
Put reusable logic in dedicated JavaScript or TypeScript modules.
Prefer declarative bindings and anchors or layouts over imperative geometry changes.
Keep IDs local and descriptive, and avoid mutable global state.
Validate QML with `qmllint`.

## Python

Use `snake_case` for functions, variables, and module names.
Use `UpperCamelCase` for classes and types.
Use a leading underscore for private members.
Fully annotate all function parameters and return values.
Prefer `X | None` over `Optional[X]`.
Prefer builtin generics such as `list` and `dict` over `typing.List` and `typing.Dict`.
Use pytest with `test_*.py` test files.
Use Ruff for formatting and linting, `ty` for type checking, and `uv` for environments and builds.

## Tooling

Use `npm run build` to build the TypeScript, JavaScript, and QML addon package.
Use `npm test` to run the JavaScript and TypeScript test suite.
Use `npm run lint` to run JavaScript, TypeScript, and QML quality checks, including `qmllint`.
Use `uv build` to build Python packages when Python tooling is present.
Use `uv run pytest` to run Python tests.
Use `uv run ruff check .`, `uv run ruff format --check .`, and `uv run ty check .` for Python quality checks.

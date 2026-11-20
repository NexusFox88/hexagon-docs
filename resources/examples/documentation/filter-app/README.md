# Project tutorial: task filtering

Implement `filterItems(items, query, status)` in `filter.mjs`.
Match titles by trimmed, case-insensitive query substring. Status `all` includes
all statuses; other values match that status. Combine both predicates, preserve
input order, do not mutate input, and return an empty array for no matches.

Do not modify acceptance.mjs. Run `node acceptance.mjs` and capture the actual
stdout/stderr and exit status. Export filter.mjs and test-report.txt into the
Run artifact directory provided by Hexagon. Do not fabricate test output.
Start the preview with `python3 serve.py`, then verify HTTP port 3000 responds.
Do not start a second listener if that port is already serving this project.

This tutorial variant needs no external Tool account. The original full product
acceptance fixture under testing/fixtures/filter-app retains its separate
requirements-read and approved-report-write workflow. Passing this tutorial
does not certify those authorization/approval scenarios.

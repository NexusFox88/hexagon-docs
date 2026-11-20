# ACCEPTANCE-001

Implement `filterItems(items, query, status)` in `filter.mjs`:
- Match title by trimmed, case-insensitive query substring.
- Status `all` includes every status; otherwise match the supplied status.
- Combine query and status predicates, preserve input order, and do not mutate input.
- Empty matches return an empty array. The existing page renders results and empty state.

Do not modify `acceptance.mjs`. Run `node acceptance.mjs`. Save its output as `test-report.txt` and the changed module in this Run's artifact directory. Start the Web preview with `python3 serve.py`; it runs on port 3000 and outlives the harness. Read requirements and write the approved report through the bound tools before producing the final assistant response.
